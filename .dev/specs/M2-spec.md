# M2 Spec — Evidence Layer

## Goal

A tester discovers sabotage through a hallway card rather than entering rooms blind. M2 adds persistent physical evidence and preserves every M1 rule and server-authoritative boundary.

## Scope

**In:** permanent door status cards; fresh/settled trash freshness; always-visible coverage HUD; public panels for both elevator shafts; independent decoy calls; short WebAudio rustle within the shared range; and the M1 ruling that voluntary walk-out during un-prep cancels cleanly.

**Out:** M3 justice, accusations, walk-in firing, spectator camera, recap timeline, and KPI/JSONL telemetry. Art polish, voice/chat, accounts, mobile, extra maps, and extra roles remain out of scope. Cards remain permanent in M2. `PUBLIC_URL` deployment and live two-browser checks remain operator carry-over and are non-blocking for local verification.

All prior M1 requirements remain operative. All tuning values are imported from `@grandhotel/shared`; no physics or client-side rule authority is introduced.

## Requirements

- **R-1:** The server MUST create a permanent door card when a room completes `clean→prepped`, expose it to hallway observers, and update its text to `TRASHED` after sabotage without exposing a card-removal or hide action.
- **R-2:** The server MUST record sabotage time. Interior observers MUST see fresh trash for ages below `FRESHNESS_WINDOW_MS`, then settled trash at or after that boundary, including the required sprite/timer state change.
- **R-3:** The server MUST calculate coverage from prepped rooms and broadcast an integer percentage at least once per second. The client MUST render that value in an always-visible HUD meter through results.
- **R-4:** The server MUST expose current position/floor state for both elevator shafts to every client. The client MUST render two readable public panels from hallway locations and update them from deltas.
- **R-5:** Elevator `call` and `ride` MUST be independent server actions. A caller may abandon a call before boarding; the elevator still completes its call and other players can board according to capacity and queue rules.
- **R-6:** On completed saboteur un-prep, the server MUST emit one sabotage event with room, source position, and timestamp. A client MUST play a short native WebAudio rustle only for same-floor avatars within `RUSTLE_RANGE_TILES`, with gain falloff and left/right panning based on source direction.
- **R-7:** Voluntary walk-out, floor change, elevator ride, or explicit cancellation during prep, un-prep, or fake-prep MUST clear the channel, leave room state unchanged, emit no rustle, and cause no firing or win side effect.
- **R-8:** Door card, freshness, coverage, elevator position, event, and channel completion state MUST remain server-authoritative. Client code may render received projections but cannot forge evidence or rule state.
- **R-9:** All M2 tuning values, including `FRESHNESS_WINDOW_MS` and `RUSTLE_RANGE_TILES`, MUST be defined in and imported from `@grandhotel/shared`; consumers MUST not hardcode the tuning literals.
- **R-10:** M2 MUST preserve M1 movement, elevator, role, work-channel, visibility, win, results, authority, and shared-constant behavior; the existing M1 verification gate MUST remain green.

## Verification Criteria

- **V-1 (covers R-1):** `pnpm --filter @grandhotel/server test -- -t "door card state"` proves cards appear on prep, change to trashed, remain present, and cannot be removed. `pnpm --filter @grandhotel/tooling test:integration -- -t "m2 door cards hallway"` proves an outside client reads the card.
- **V-2 (covers R-2):** `pnpm --filter @grandhotel/server test -- -t "trash freshness transition"` with fake timers proves the recorded timestamp, fresh state before `FRESHNESS_WINDOW_MS`, and settled state at the boundary. A focused client test proves the sprite/timer swap; a 30-second manual glance may supplement visual sprite identity.
- **V-3 (covers R-3):** `pnpm --filter @grandhotel/server test -- -t "coverage broadcast"` proves the server percentage calculation and 1 Hz update. `pnpm --filter @grandhotel/tooling test:integration -- -t "m2 hud coverage live"` proves every client receives and renders live HUD coverage through results.
- **V-4 (covers R-4):** `pnpm --filter @grandhotel/server test -- -t "elevator position broadcast"` proves both shafts have current position state. `pnpm --filter @grandhotel/tooling test:integration -- -t "m2 elevator panels"` proves hallway clients render both panels and observe updates.
- **V-5 (covers R-5):** `pnpm --filter @grandhotel/server test -- -t "elevator call without ride"` proves abandoned calls still arrive and do not board the caller. `pnpm --filter @grandhotel/tooling test:integration -- -t "m2 decoy calls"` proves another client can ride and capacity remains valid.
- **V-6 (covers R-6):** `pnpm --filter @grandhotel/server test -- -t "rustle event emission"` proves completion emits the event and cancellation does not. A focused audio/range test proves same-floor distance and panning/gain calculations, while a 60-second local manual check confirms native WebAudio playback.
- **V-7 (covers R-7):** `pnpm --filter @grandhotel/server test -- -t "channel cancel no rustle"` and `-t "channel cancel comprehensive"` prove all cancellation routes preserve state and side effects. The M1 `-t "channel cancel cleanly"` regression must remain green.
- **V-8 (covers R-8):** `pnpm --filter @grandhotel/server test -- -t "server authority evidence"` rejects spoofed card, freshness, coverage, elevator, and rustle state. `pnpm -r typecheck` passes and `grep -R "from ['\"]colyseus" apps/client/src/game apps/client/src/ui` returns empty.
- **V-9 (covers R-9):** `pnpm --filter @grandhotel/shared test -- -t "tuning constants m2"` asserts the PRD values. A `grep` literal sweep over `apps/server/src` and `apps/client/src` finds no hardcoded freshness/range tuning values outside comments/imports.
- **V-10 (covers R-10):** `bash scripts/verify-m1.sh` exits 0, including M1 tests, builds, Docker single-origin checks, and local smoke. This is the backward-compatibility gate for M2.

## Assumptions & Open Questions

- Gray-box cards and trash sprites may be text labels or simple bundled sprites; tests must distinguish fresh and settled states, while exact art and layout are planner choices.
- Freshness uses server time and `age >= FRESHNESS_WINDOW_MS` as the settled boundary. Rustle range is same-floor Chebyshev distance in tiles; other floors cannot hear it.
- Coverage is the documented HUD exception to diegetic evidence and may freeze at results. Elevator panels may be text, icons, or gray-box art but must show both shaft states.
- Native WebAudio may use a bundled sample or procedural noise; full 3D spatialization is deferred.
- No blocking questions remain. Live `PUBLIC_URL` and deployed two-browser evidence are operator tasks, not an M2 build blocker.
