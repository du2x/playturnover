# M2 Verification Report

Verdict: PASS
Date: 2026-08-27
Verifier: orchestrator builder/verifier pass

## Evidence

| V-id | Criterion             | Result | Evidence                                                                                                                                                                                                                                 |
| ---- | --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Door cards            | PASS   | `apps/server/src/rooms/HotelRoom.ts:1` and `apps/server/test/evidence.spec.ts:1` prove card creation, PREPPED/TRASHED transitions, and permanence; `tooling/src/integration/m2Evidence.spec.ts:1` observes the replicated card contract. |
| V-2  | Freshness tiers       | PASS   | `packages/shared/src/constants.ts:1` defines the shared window; `apps/server/src/rooms/HotelRoom.ts:1` updates freshness; `apps/server/test/evidence.spec.ts:1` proves the exact boundary.                                               |
| V-3  | Coverage HUD data     | PASS   | `apps/server/src/rooms/HotelRoom.ts:1` computes `coveragePercent`; `apps/client/src/main.ts:1` renders it in the HUD; full client and server suites pass.                                                                                |
| V-4  | Elevator panels/state | PASS   | `packages/shared/src/state.ts:1` carries both elevator states; `apps/server/test/elevator.spec.ts:1` passes all 14 elevator tests; `tooling/src/integration/m2Evidence.spec.ts:1` observes both shafts from real clients.                |
| V-5  | Decoy calls           | PASS   | `apps/server/src/elevator.ts:1` keeps call and ride independent; `apps/server/test/elevator.spec.ts:1` proves queue/capacity behavior; M1 integration regression passes.                                                                 |
| V-6  | Rustle event/audio    | PASS   | `apps/server/src/rooms/HotelRoom.ts:1` emits completion-only sabotage events; `apps/server/test/evidence.spec.ts:1` proves cancellation emits none; `apps/client/src/main.ts:1` applies range, gain, and stereo panning.                 |
| V-7  | Clean cancellation    | PASS   | `apps/server/src/rooms/HotelRoom.ts:1` and `apps/server/test/channels.spec.ts:1` preserve M1 cancellation behavior; focused M2 cancellation tests pass.                                                                                  |
| V-8  | Server authority      | PASS   | `packages/shared/src/state.ts:1`, `apps/server/src/rooms/HotelRoom.ts:1`, and client boundary grep show evidence remains server-sourced; all four workspace typechecks pass.                                                             |
| V-9  | Shared tuning         | PASS   | `packages/shared/src/constants.ts:1` exports freshness/range values; shared `tuning constants m2` test passes and the M2 literal audit is clean.                                                                                         |
| V-10 | M1 compatibility      | PASS   | `scripts/verify-m2.sh:1` runs the complete M1 regression suite and M2 gate; 13 integration files and 14 tests pass, with all workspace builds/typechecks green.                                                                          |

## Gate Result

`corepack pnpm verify:m2` exited 0 and printed `M2 evidence layer: PASS`.
The gate covered shared/server/client/tooling builds and tests, M2 real-client integration, client transport boundary, and tuning literal audit. Colyseus deprecation and unregistered-message output was non-blocking warning noise. Live `PUBLIC_URL` deployment remains operator-pending and is not required for the local M2 gate.
