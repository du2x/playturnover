# M3 Spec — Justice + Recap

## Goal

A round can be decided by testimony leading to a correct accusation: a player can
make a constrained accusation, the correct saboteur is fired, and the results view
recaps the events that supported the decision.

## Scope

**In:** walk-in conviction during an active un-prep channel; staff accusations with
range, floor, role, and grace-period rules; firing and spectator state; a complete
round event timeline in results; server-authoritative justice and recap data; and
the telemetry needed to compute M3 deduction KPIs.

**Out:** integrated voice or chat, mobile/touch controls, new roles or maps, pullable
door cards, art polish, and changes to M1/M2 tuning or win conditions. Deployment and
live two-browser checks remain operator tasks and are non-blocking locally.

All prior M1 and M2 requirements remain operative. Rule-bearing state remains on the
server, and all tuning constants remain defined in `@grandhotel/shared`.

## Requirements

- **R-1:** The server MUST immediately fire the saboteur when a player enters a room
  containing an active un-prep channel, mark the catch, and resolve the round for
  staff; voluntary walk-out MUST continue to cancel without firing.
  (source: roadmap walk-in and cancellation rules)
- **R-2:** A staff player MUST be able to hold the accusation control while within
  `ACCUSATION_RANGE_TILES` on the same floor as another active player, see a
  confirmation choice, and submit the confirmed target to the server. (source: roadmap accusation UX)
- **R-3:** The server MUST reject accusations from saboteurs, spectators, players on
  another floor, players outside range, self-targets, and already-fired targets.
  (source: roadmap accusation constraints)
- **R-4:** The server MUST treat an accusation targeting the saboteur before the
  saboteur's first completed un-prep as wrong and fire the accuser; after that first
  crime, a valid accusation MUST fire the saboteur. A wrong accusation MUST fire its
  accuser.
  (source: roadmap accusation outcomes)
- **R-5:** A fired player MUST become a read-only spectator until results, with a
  full-building overview of players, rooms, elevators, and evidence, and MUST be
  unable to move, channel, accuse, call, ride, or alter rule state. (source: roadmap spectator rule)
- **R-6:** Results MUST expose a chronological event timeline containing room work
  and sabotage timestamps, elevator rides, walk-in catches, and accusations with
  actor, target or room, timestamp, and validity fields where applicable. (source: roadmap recap timeline)
- **R-7:** The server MUST record justice and recap events authoritatively for each
  round, including room transitions, elevator calls/rides, sabotage crimes, catches,
  accusations with `wasTargetSaboteur` and `crimeOccurred`, and one coverage sample
  per second; clients MUST only render the received projection. (source: PRD telemetry requirement)
- **R-8:** The telemetry output MUST support post-round computation of saboteur win
  rate, correct-accusation rate, catches per hour, time to first crime discovery,
  and decoy-call usage. (source: PRD KPI requirement)
- **R-9:** The accusation range and any new M3 tuning values MUST be defined once in
  `@grandhotel/shared` and imported by server and client consumers; no rule-bearing
  M3 state or outcome may be client-authoritative. (source: techstack, PRD §7)
- **R-10:** M3 MUST preserve M1/M2 movement, roles, work channels, cancellation,
  elevators, evidence, coverage, win, results, and server-authority behavior.
  (source: roadmap M3 exit criterion)

## Verification Criteria

- **V-1 (covers R-1):** `pnpm --filter @grandhotel/server test -- -t "walk-in fire"` proves entry during an active un-prep fires the saboteur and records a catch, while the existing channel-cancel test remains green. `pnpm --filter @grandhotel/tooling test:integration -- -t "walk-in catch"` proves the real-client path.
- **V-2 (covers R-2, R-3):** `pnpm --filter @grandhotel/server test -- -t "accusation constraints"` proves staff-only, same-floor, range, self-target, fired-target, and confirmation submission rules. A focused client test proves hold-to-confirm and cancel behavior.
- **V-3 (covers R-4):** `pnpm --filter @grandhotel/server test -- -t "accusation grace period"` proves the pre-first-un-prep wrong outcome and post-first-un-prep correct outcome, including accuser/target firing. `pnpm --filter @grandhotel/tooling test:integration -- -t "grace period boundary"` covers the real-client boundary.
- **V-4 (covers R-5):** `pnpm --filter @grandhotel/server test -- -t "spectator mode transition"` proves fired players become spectators and cannot perform round actions. `pnpm --filter @grandhotel/tooling test:integration -- -t "spectator observability"` proves the spectator receives the full-building projection.
- **V-5 (covers R-6):** `pnpm --filter @grandhotel/server test -- -t "event timeline structure"` proves chronological crimes, rides, catches, and accusations with required fields. `pnpm --filter @grandhotel/tooling test:integration -- -t "recap payload"` proves the results projection reaches a real client.
- **V-6 (covers R-7, R-8):** `pnpm --filter @grandhotel/server test -- -t "event log emission"` proves authoritative JSONL records and required flags; `pnpm --filter @grandhotel/tooling test:integration -- -t "m3 telemetry"` proves a full round produces KPI-computable events, including decoy calls and discovery timing.
- **V-7 (covers R-9):** `pnpm --filter @grandhotel/shared test -- -t "tuning constants m3"` proves the accusation range value. A literal sweep finds no hardcoded M3 tuning values in `apps/server/src` or `apps/client/src`, and `pnpm -r typecheck` passes.
- **V-8 (covers R-10):** `bash scripts/verify-m2.sh` exits 0, preserving the complete M2 and M1 regression gates. Client game/UI code continues to contain no direct Colyseus imports.
- **V-9 (covers R-1 through R-10):** `pnpm --filter @grandhotel/tooling test:integration -- -t "m3"` exits 0 for the justice and recap integration suites, and a focused client test proves spectator rendering, accusation confirmation, and recap timeline rendering.
- **V-10 (covers R-1 through R-10):** A manual 5–6 player round verifies that testimony can lead to a correct accusation deciding the round; deployment-dependent live checks are recorded separately as operator evidence.

## Assumptions & Open Questions

- `ACCUSATION_RANGE_TILES` uses the existing same-floor 1D distance model and is set
  to the PRD value of approximately 2 tiles; the planner may choose the exact name and
  schema representation without changing behavior.
- “First un-prep” means the first completed sabotage crime, matching the grace-period
  wording and existing channel completion semantics; starting and voluntarily canceling
  an un-prep does not end the grace period.
- The recap may use a server-projected schema collection or a private results message,
  but clients must not infer missing justice outcomes locally.
- JSONL persistence and KPI computation are server/tooling concerns; exact file paths
  and presentation are planner choices.
- No blocking product questions remain. `PUBLIC_URL` is still an operator prerequisite
  for live deployment evidence only.
