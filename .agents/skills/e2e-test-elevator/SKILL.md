---
name: e2e-test-elevator
description: Deterministic end-to-end verification of the Grand Hotel elevator (call, board, travel, offboard) through a real browser with Playwright. Use when changing elevator logic, movement/floor sync, the hall scene, or when an elevator visual bug is reported.
---

# E2E test: elevator flow (Grand Hotel)

Drive one real browser against the live dev stack and assert on the
`__ghDebug` hook — never pixel-hunt the Phaser canvas.

## 0. Preconditions

- **Single source of truth for timing/constants** (`packages/shared/src/constants.ts`):
  `ELEVATOR_ARRIVE_MS = 3000`, `ELEVATOR_RIDE_MS = 2000`,
  `ELEVATOR_INTERACT_RADIUS = 18`, `ELEVATOR_A_X = 118`, `ELEVATOR_B_X = 842`,
  `LOBBY_CENTER.x = 480`, `HALLWAY_MIN/MAX_X = 96/864`.
- **State machine** (`ElevatorStatus`): `idle → arriving → boarding → traveling →`
  (`idle` if no queue, else back to `arriving` at the origin floor for queued riders).
  `traveling` is a broadcast-only state set by `tryDepartElevator`; it departs on the
  **first confirmed seat**, and players drop exactly `ELEVATOR_RIDE_MS` later
  (`handleElevatorDrop`). The boarding window close timer (`handleBoardingClosed`)
  is the fallback that un-sticks cars nobody boarded — if it is missing or wrong,
  cars wedge in `boarding` forever.

## 1. Boot the stack

```bash
pnpm dev:server &   # port 2567 (tsx watch — hot-reloads server code)
pnpm dev:client &   # vite, port 5173 (5174/5175 if taken)
```

- Check ports first (`ss -tlnp | grep -E '2567|517'`): a tsx-watch server already
  running IS current code — do not start a second one (EADDRINUSE kills it anyway).
- After server hot-reload, open client tabs can spam
  `"WebSocket is already in CLOSING or CLOSED state"` from a dead room connection.
  Hard-reload the page before testing; don't chase the spam.
- HMR full-reload resets the app to the name screen — re-run the whole join flow
  after any client edit.
- Beware parallel sessions joining your room (roster shows surprise players);
  they can drive "your" elevators mid-test.

## 2. Join + instrument

```js
const dbg = () => page.evaluate(() => window.__ghDebug());
```

Flow: fill `Display name` → Enter → click `Create room` → poll `dbg()` until
`phase === "waiting"`. `__ghDebug()` returns `{ screen, phase, myFloor, localX,
sceneFloor, elevatorsView: { A:{floor,state}, B:{...} }, players }` (dev builds only).

## 3. Movement quirks (each of these will waste 10 minutes if forgotten)

- **Client/server x diverge at the walls.** Holding a key down to the clamp keeps
  applying dx server-side after the client visually stops: client shows ~116,
  server may sit at 96 (`HALLWAY_MIN_X`). All gates (call radius, boarding) read
  the SERVER x. Position via `dbg().players[me].x`, not `localX`. To
  reach shaft A (x=118, radius 18 → valid zone [100,136]) approach from open
  hallway and stop deliberately; if server `x < 104`, nudge right and re-check.
- Walk uses **ArrowLeft / ArrowRight / WASD**, hold-and-poll until positioned.
  Shaft **A is LEFT (x=118)**; walking RIGHT from lobby center hits x=864 (shaft B).
- All keyboard actions are silent no-ops outside their gates:
  - SPACE call: rejected by the server unless within radius of the nearest shaft
    (still works pre-round in `waiting`).
  - digits `0-3` board; they gate on phase `waiting`/`playing`, not fired/spectator,
    AND locally require being within interact radius, else nothing is sent.
- Everything server-authoritative; client assertions lag ~1 network tick (~100ms).

## 4. Golden-path assertion sequence (shaft A, lobby → floor 2)

Run as one `run_code_unsafe` block (single browser action keeps key-holds atomic):

1. Hold ArrowLeft until `localX ≈ 118` (±14). Record `x`.
2. Press `Space`; poll HUD/debug every ~100ms:
   - expect `A:{floor:0, state:"arriving"}` almost immediately,
   - then `A:{floor:0, state:"boarding"}` after ≈3000ms (allow ±1 poll tick).
3. Press `2` while in `boarding`; immediately after:
   - expect `A:{floor:2, state:"traveling"}`,
   - `myFloor` stays `0` during travel (authoritative origin),
   - take a screenshot mid-travel — car rect should sit between floor strips.
4. Poll ≈2000ms more:
   - `A:{floor:2, state:"idle"}` and **stays** idle (regression: car snapping
     back to origin means the drop handler failed to settle
     `runtime.floor = destFloor`),
   - `myFloor === 2` and `localX ≈ 118` at shaft A — NOT hallway center (regression:
     offboard-in-middle bug lives in `applyLocalFloor`'s `xOverride` path).

## 5. Cover these regressions explicitly

- **Decoy call**: press Space, never press a digit → after arrive(3s) +
  window close, car returns to `A:F0 idle`. It must NEVER stay `boarding`.
- **Queued rider cycle**: two clients near the same shaft, both call, both ride
  to floor 2, third client calls+rides → third gets `traveling→arriving→boarding`
  again at the origin floor, then drops at floor 2. Schema `queue` isn't visible to
  clients — assert via the eventual floors only.
- **Spectator/fired gates**: not reachable in a waiting-phase-only test; covered by
  unit suites (`apps/server/test/elevator.spec.ts`) instead of E2E.
- **Rejoin race**: reload the page right after a second player joins (triggers
  addRemote-before-scene-create). There must be no console `TypeError …
  reading 'rectangle'` and subsequent HUD updates keep flowing.

## 6. When the numbers don't line up

Symptom map (all seen historically):

| Symptom | Cause to check |
|---|---|
| Car animates but rider pops out early | `main.ts syncLocalState` applying floors without the scene's pending-floor deferral |
| Car moves 2s *late* | departure triggered by timer instead of first confirmed seat |
| Riders stuck authoritative at origin | drop handler skipped / `pendingDrops` cleared twice |
| No reaction at all to keys | Phaser lost focus OR out-of-radius gating silently swallowed it (walk closer) |
| Whole UI frozen mid-test | an exception inside an `onState` handler aborts every later update — check console for the FIRST TypeError, not the last |

## 7. Fast fallbacks

- Unit-level truth lives in `apps/server/test/elevator.spec.ts` (14 deterministic
  clock-driven tests) — run them before E2E when debugging server logic.
- Client scene logic: `apps/client/test/hall-scene.test.ts`.
- Integration harness (no browser): `pnpm --filter @grandhotel/tooling
  test:integration -- --grep elevator`.
