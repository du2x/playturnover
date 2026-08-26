# M0 Spec — Walking Skeleton

## Goal

Restated exit criterion (roadmap M0): **two browsers, connected to a publicly deployed
build, see each other's avatars move in real time.** Success is measurable when
(a) an automated two-client integration test over the real transport demonstrates
mutual position visibility within a latency bound, and (b) a human opening the public
URL in two browsers observes both dots moving together. Everything else in M0 exists
only to make that pipe real: monorepo scaffold, deploy pipeline, lobby, one-floor
hallway, synced movement, lifecycle stubs.

## Scope

**In:**
- Monorepo scaffold per techstack §5: `apps/client` (TypeScript + Vite + Phaser 3,
  pixelArt mode), `apps/server` (Node.js + Colyseus), `packages/shared`
  (types + tuning constants + message schemas), Vitest as the test runner,
  pnpm workspaces throughout.
- Deploy pipeline to one public URL from a single container: static client +
  WebSocket endpoint on the same origin (techstack §5 deploy line; Fly.io or Railway
  per techstack — exact host is planner's choice).
- Lobby flow: enter display name → create room (receive shareable room code) or join
  existing room by code; joined players' names visible to everyone in the room.
- Player cap enforcement (max 6, server-side).
- One floor: a horizontal hallway strip; keyboard left/right movement only;
  pass-through bodies (avatars never collide or block); movement clamped to hall bounds.
- Position sync: all movement traffic flows through the server, which applies a
  max-speed sanity clamp before rebroadcasting (~10–15 Hz); clients interpolate
  remote avatars between updates. (Client-reported presence relayed by the server is
  the documented exception in techstack §1 — positions are untrusted presence, not
  rule-bearing state.)
- Round lifecycle stub: server-side phases `waiting → playing → results`,
  advanced by an explicit host control; `results` carries an empty/placeholder
  payload (no winner, no reveal). No gameplay attaches to phases in M0.

**Out (explicit non-goals, deferred):**
- Roles, saboteur, prep/un-prep/fake-prep actions, round timer, win checks,
  ≥4-player start rule (FR-2, FR-7…FR-9, §6.6 → M1).
- Floors 2–3, individual rooms, elevators, elevator panels (FR-3, FR-5, FR-6 → M1/M2).
- Entire evidence layer: door cards, trash freshness, coverage % HUD, rustle audio (M2).
- Justice system: walk-in conviction, accusations, firing, spectator cam, recap (M3).
- Telemetry JSONL event log and KPI scripts (roadmap: build during M1–M3).
- Reconnection/session-resume UX (Colyseus tokens exist; wiring deferred to M1 when
  mid-round disconnects matter).
- Art/audio polish, integrated or spatial voice, text chat, matchmaking, accounts,
  mobile/touch (prd §4 Non-Goals).

## Requirements

- **R-1:** The repo is a pnpm-workspace monorepo containing a Vite+Phaser 3 TypeScript
  client, a Node.js+Colyseus TypeScript server, and a shared TypeScript package, such
  that install, typecheck, and build succeed across all workspaces from a clean clone.
  (source: roadmap M0 bullet 1; techstack §5)
- **R-2:** The shared package exports the PRD §7 tuning values as named constants
  (including `MAX_PLAYERS = 6`), and the server enforces the lobby cap using that
  constant rather than a local literal. (source: techstack §5; prd §7)
- **R-3:** A client can enter a display name, create a room receiving a shareable
  room code, or join an existing room by code, and every participant sees the current
  roster of display names. (source: FR-1; roadmap M0 bullet 3)
- **R-4:** Joining a room that already has 6 players is rejected server-side with an
  error observable by the rejected client, and the roster remains unchanged.
  (source: FR-1; prd §7 "Players 4–6")
- **R-5:** On the single floor scene, keyboard input moves the local avatar strictly
  horizontally along the hallway strip, movement is clamped to fixed hallway bounds,
  avatars overlap freely (pass-through, no collision), and vertical position never
  changes. (source: FR-4; roadmap M0 bullet 4; techstack §6)
- **R-6:** Avatar positions reach all peers only via the server at a rebroadcast
  cadence in the 10–15 Hz range; the server corrects injected movements exceeding its
  max-speed constant; clients render remote avatars interpolated between successive
  position updates. (source: roadmap M0 bullet 5; techstack §1 exception, §6)
- **R-7:** Every room exposes a server-owned lifecycle phase progressing
  `waiting → playing → results`; the host can advance it stepwise; all clients observe
  each transition; the `results` phase carries no winner or reveal data.
  (source: roadmap M0 bullet 6)
- **R-8:** The game is reachable at one public HTTPS URL, zero-install: the same
  origin serves the built client over HTTPS and accepts game WebSocket connections
  over WSS, verified by an automated smoke check against the live deployment.
  (source: roadmap M0 bullet 2; prd Goal 4)
- **R-9:** Two independent clients on the deployed build see each other move in real
  time: when one streams movement, the other's world-state reflects the mover's
  changing position within ≤250 ms (local/prod build) or ≤1 s (public internet).
  (source: roadmap M0 exit criterion)

## Verification Criteria

- **V-1 (covers R-1):** From a fresh `git clone`: `pnpm install && pnpm -r typecheck &&
  pnpm -r build` all exit 0, and `pnpm -r test` executes Vitest in every workspace
  (suites may be minimal but must resolve and run). Workspaces `apps/client`,
  `apps/server`, `packages/shared` exist per techstack §5.
- **V-2 (covers R-2):** `pnpm --filter @grandhotel/shared test` (or equivalent shared
  package filter) runs a test asserting each exported §7 constant equals the PRD §7
  table value (spot-set: `MAX_PLAYERS=6`, shift 5:00, prep 5s / un-prep 3s, coverage
  80%, freshness 75s, elevator 3s/2s/cap 2, accusation ~2 tiles, rustle ~3 tiles);
  the server lobby cap test passes the cap through the shared constant (verified by
  V-4 exercising the limit).
- **V-3 (covers R-3):** Automated integration test (Vitest + Colyseus test clients
  against a spawned server): client A creates a room → receives a non-empty room code;
  client B joins by that code with a display name; both clients' roster state then
  contains both names. Manual supplement: launching the client shows the
  name-entry screen before any room interaction (justified: DOM/screen flow glance,
  ~30 s).
- **V-4 (covers R-4):** Same harness: six clients join successfully; a seventh join
  attempt is rejected with an error surfaced to that client (Colyseus error/onLeave
  reason); roster size stays 6. Test asserts both facts.
- **V-5 (covers R-5):** Unit test on the movement/clamp logic: simulated held-right
  input converges exactly to the upper hallway bound, held-left to the lower bound,
  y is invariant throughout, and two co-located movers proceed independently (no
  displacement caused by overlap). Manual supplement: two browsers parked at the same
  x visibly overlap and neither blocks the other (justified: collision-free rendering
  is a visual fact).
- **V-6 (covers R-6):** Integration test: client A streams movement for 3 s; client B
  receives A-position updates averaging ≥8 Hz over that window; injecting a movement
  message claiming a jump larger than the shared max-speed constant × dt results in
  the rebroadcast position being clamped (B never sees the illegal jump). Manual
  supplement: remote dot motion looks smooth, not teleport-y, at the sync rate
  (justified: interpolation quality is perceptual; transport correctness is already
  automated here and in V-9).
- **V-7 (covers R-7):** Room-sim test: initial phase is `waiting`; host advance →
  `playing`; second advance → `results` whose payload contains no winner/traitor
  fields; every connected client is notified of each transition (assert on all
  clients' observed phase sequence).
- **V-8 (covers R-8):** Committed smoke script (e.g. `pnpm smoke:remote`) run against
  the deployed public URL exits 0 having verified: `GET /` returns 200 with the client
  HTML, and two WSS connections to the same origin complete a create/join handshake
  with position exchange. The public URL is recorded in the repo (deploy notes or
  STATE decision log) so anyone can rerun the check. Zero-install is implied: no auth,
  no download step in the smoke path.
- **V-9 (covers R-9, exit criterion):**
  (a) Automated: two-client integration test over the production build (server booted
  from built output): A streams movement; B's observed x for A changes monotonically
  with final-sample staleness ≤250 ms. (b) Manual: two browsers — ideally two devices
  on different networks — open the public URL, join one room, and each sees the other
  dot move contemporaneously. The manual half is irreducible: the exit criterion is
  literally perceptual ("see each other move"); everything mechanically checkable
  about it is covered by (a), V-6, and V-8.

Automated vs manual split: V-1…V-4, V-7, V-8 fully automated; V-5, V-6 automated with
small justified visual supplements; V-9 automated core + the roadmap's literal
two-browser observation.

## Assumptions & Open Questions

Assumptions (resolved from docs, listed for audit):
1. **"Server-authoritative position sync" vs client-reported positions:** reconciled
   via techstack §1's documented exception — positions are untrusted presence relayed
   and sanity-clamped by the server; all rule-bearing state stays server-only. M0 has
   no rule-bearing state beyond roster/phase, so the exception applies cleanly.
2. **Lifecycle trigger in M0:** host = room creator, advancing phases via an explicit
   host control. Real rules (≥4 players, timer, auto-transitions) arrive in M1; the
   host concept lands now because FR-2 will need it anyway.
3. **Room code format:** unspecified anywhere; assumed short uppercase alphanumeric
   (≈4 chars, ambiguity-prone glyphs excluded). Planner may finalize; not blocking.
4. **Display names:** trimmed non-empty strings; uniqueness not enforced in M0
   (roster disambiguation is irrelevant to the skeleton).
5. **Controls:** arrow keys at minimum; supporting WASD too is allowed and harmless.
6. **Movement speed & hallway bounds:** concrete numbers are free variables in M0
   (PRD §7 fixes none); they must exist as shared constants so V-6's clamp check and
   V-5's bounds check are deterministic.

Open questions for the orchestrator (none change the meaning of prd.md):
- **Deploy credentials/platform sign-off:** actually executing V-8 requires a hosting
  account (Fly.io or Railway per techstack §5) and DNS/domain choice. Not blocking the
  spec; will block the BUILD→VERIFY handoff unless the orchestrator provisions access.
- None else. **No BLOCKING questions.**
