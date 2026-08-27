# M4 Spec — Visual pass + join code fix

## Goal

A second player can join a room by typing exactly the code the HUD/menu displays
(the critical multiplayer defect is fixed), and the client presents a coherent,
readable visual pass: styled name/menu screens, non-clipping HUD bar, viewport
scaling instead of silent clipping, and a world where players can tell floors
and avatars apart.

## Scope

**In:** server-assigned joinable short room code with end-to-end resolution;
name/menu screen card styling; HUD bar overflow fixes; proportional viewport
scaling of stage + DOM overlay down to a 700px width floor; world readability
(floor tints, elevator/door markers, avatar size/color/name-initial). All
tuning and layout constants stay sourced from `@grandhotel/shared`.

**Out (per PRD §4 / approved M4 scope):** animations/particles, audio work or
audio visualizers, art assets/spritesheets/themes, responsive layouts below
700px, any gameplay-rule changes beyond the R-1 join resolution, mobile/touch
support, and any M1–M3 tuning or win-condition changes. Deployment-dependent
live checks remain operator tasks and are non-blocking locally.

All prior M0–M3 requirements remain operative. Rule-bearing state stays on the
server; positions remain client-reported presence; no physics engine and no
collision bodies may be introduced by the visual work.

## Requirements

- **R-1:** The server MUST generate a short room code at room creation from
  `ROOM_CODE_ALPHABET` × `ROOM_CODE_LENGTH` (`@grandhotel/shared`), unique among
  all live rooms for the lifetime of each room, freed on room disposal, such
  that joining with exactly that code string resolves to that one room.
  (source: FR-1, PRD §7 session shape; orchestrator-approved M4 scope)
- **R-2:** The client MUST display the server-assigned short code consistently
  in the menu and HUD via the `RoomStateView`/`GameClient` projection boundary —
  not the raw Colyseus `roomId` — and join-by-code MUST resolve a well-formed
  displayed code to its room while rejecting unknown codes with a classified
  "not found" rejection rather than an unhandled error. (source: FR-1; techstack §7 escape hatch)
- **R-3:** The name screen and menu screen MUST render inside a coherent card
  layout carrying the game title, with consistent spacing and visible keyboard
  focus states, as pure DOM UI without art assets. (source: approved M4 scope R-2)
- **R-4:** The HUD bar MUST fit within the canvas width at common window sizes:
  chip content must be capped/truncated (ellipsis) so chips never clip off the
  left/right edges, the roster list MUST respect `MAX_PLAYERS` sizing, and NO
  rule-bearing information may be lost — presentation only. (source: FR-14, PRD §7 Players cap)
- **R-5:** The stage and DOM overlay MUST scale proportionally to fit the
  viewport width down to a ≥700px floor, showing a visible message below that
  floor, without changing movement math, physics absence, or pointer-input
  accuracy over the game canvas. (source: approved M4 scope R-4)
- **R-6:** The hall scene MUST be visually distinguishable per floor (distinct
  floor tints), have clearer elevator/door markers preserving existing state
  colors, and render larger avatars identifiable by player color plus name
  initial — client presentation only, positions still client-reported presence.
  (source: approved M4 scope R-5; techstack §6)
- **R-7:** All new tuning/layout constants introduced for R-1..R-6 MUST live in
  `@grandhotel/shared` and no rule-bearing M4 state may be client-authoritative.
  (source: techstack law; PRD §7)

## Verification Criteria

- **V-1 (covers R-1):** `pnpm --filter @grandhotel/tooling test:integration -- -t "join code"` proves the end-to-end path with two real `colyseus.js` clients: client 1 creates a room, reads the published short code (matching `ROOM_CODE_LENGTH` over `ROOM_CODE_ALPHABET`), client 2 joins by exactly that code string and both see the same room with 2 players.
- **V-2 (covers R-1, R-2):** `pnpm --filter @grandhotel/server test -- -t "room code"` proves codes are alphabet-valid, length-exact, unique across concurrently created rooms, and released after disposal; a focused client test proves `joinByCode` rejects a well-formed but nonexistent code with a classified not-found rejection.
- **V-3 (covers R-2):** A focused client UI test (`pnpm --filter @grandhotel/client test -- -t "code display"`) proves the menu/HUD render the projected short code, not the raw Colyseus `roomId`, and that the transport boundary holds (`grep -R "from ['\"]colyseus" apps/client/src/game apps/client/src/ui` finds nothing).
- **V-4 (covers R-3):** `pnpm --filter @grandhotel/client test -- -t "menu styling"` proves the name/menu screens expose the card/title structure and focus-visible styles exist in `style.css`; overall visual coherence is covered manually in V-11 (SKIP-MANUAL).
- **V-5 (covers R-4):** `pnpm --filter @grandhotel/client test -- -t "hud caps"` proves truncation/cap logic handles `MAX_PLAYERS` roster entries and long strings via ellipsis without dropping rule-bearing fields, and CSS allows the bar to fit (wrap/shrink) rather than overflow; actual pixel-level clipping at real window sizes is verified manually in V-11 (SKIP-MANUAL).
- **V-6 (covers R-5):** `pnpm --filter @grandhotel/client test -- -t "viewport scale"` proves a pure scale-computation helper yields full-size at ≥960px, proportional down-scaling between 960px and the 700px floor, the below-floor message flag under 700px, and that movement math files are untouched (`pnpm --filter @grandhotel/shared test` stays green).
- **V-7 (covers R-6):** `pnpm --filter @grandhotel/client test -- -t "world readability"` proves the floor-tint palette has `FLOOR_COUNT + 1` distinct values, elevator/door markers keep their state colors, and the avatar identity derivation produces color + name initial per player; readability quality itself is verified manually in V-11 (SKIP-MANUAL).
- **V-8 (covers R-1 through R-7):** The regression chain stays green: `pnpm -r typecheck && pnpm -r build && pnpm -r test`, then `pnpm --filter @grandhotel/tooling test:integration` (full suite), then a literal sweep audit confirming no hardcoded room-code constants outside shared.
- **V-9 (covers R-7):** A literal sweep greps `apps/server/src` and `apps/client/src` for stray new tuning literals (code length/alphabet duplicates) and confirms all sources import from `@grandhotel/shared`.
- **V-10 (covers R-1 through R-7):** A new milestone gate script `bash scripts/verify-m4.sh` (exposed as `pnpm verify:m4`) exits 0, chaining install→typecheck→build→tests→integration→literal sweeps→prior-milestone regression steps (M0–M3 suites, transport-boundary check).
- **V-11 (covers R-3, R-4, R-5, R-6) — SKIP-MANUAL:** A manual browser walkthrough records evidence: name/menu cards look coherent, HUD fits with nothing clipped at ~1024px and ~720px window widths, stage scales proportionally without mis-mapped clicks, floors/avatars are distinguishable, and two-browser join works using only the displayed code. Justified manual because pixel rendering and pointer mapping cannot be asserted headlessly.

## Assumptions & Open Questions

- **Decision (recorded unilaterally):** Join resolution uses the documented
  Colyseus 0.15.x matchmaking idiom — the room publishes its short code via
  room metadata at creation and the client's join path resolves the typed code
  against those server-published listings before joining the resolved room id.
  Uniqueness among live rooms is enforced server-side (collision-safe registry
  with disposal cleanup) so resolution is unambiguous. No custom HTTP endpoint
  is added. This keeps the code → room mapping server-sourced (never guessed
  client-side) and the `GameClient` escape-hatch boundary intact. The planner
  may implement the equivalent mapping differently (e.g., `onAuth`/join-options
  handling) provided V-1/V-2 behavior — uniqueness, exact-string resolution,
  classified rejection — is preserved.
- Room creation (`createRoom`) continues to return a value to the caller, but it
  must now surface the short code rather than the raw `roomId` wherever callers
  display it; internal transport needs for the raw id remain allowed.
- The 700px viewport floor is the approved minimum from the orchestrator scope;
  exact scale strategy (CSS transform vs Phaser Scale Manager FIT) is a planner
  choice, provided pointer-input mapping stays accurate (V-11 checks this).
- Existing M0–M3 test names and gates must continue passing unchanged except
  where join-by-code tests previously encoded the broken behavior (if any such
  tests exist, they are updated alongside V-1/V-2, not deleted).
- `verbatimModuleSyntax`/`isolatedModules` constraints apply to all new modules
  (type-only imports use `import type`); no spec content depends otherwise.
- No open questions remain; no blocking questions were identified.
