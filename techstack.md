# Tech Stack Analysis — Grand Hotel prototype

Date: 2026-08 · Method: decision-driver audit + live verification of candidates
(Colyseus, PartyKit, Trystero verified against current sources; others marked accordingly).

---

## 1. Decision drivers (what OUR game demands)

| # | Driver | Consequence |
|---|---|---|
| D1 | **Hidden role = secrets must never live in a client** | Requires a trusted server authority. Kills all P2P-first stacks. This is the hard constraint. |
| D2 | ≤6 players/room, ~10–15 Hz movement sync, zero physics | Any WebSocket approach works; performance is a non-issue. Ergonomics matter more than throughput. |
| D3 | Room codes, lobby lifecycle, mid-round disconnects | Want reconnection handling out of the box. |
| D4 | Browser links, zero install (cold-start strategy) | Pure web client, one deploy target. |
| D5 | Solo dev, TypeScript everywhere, boring tech | One language, small surface, few moving parts. |
| D6 | Server-side JSONL telemetry per round | Needs easy persistent file/log writes from the authority. |

Pragmatic authority note: avatar *positions* may be client-reported and relayed as untrusted
presence data (a cheater only spoofs their own dot among friends), while ALL rule-bearing state
(roles, room states, channels, timers, elevators, accusations) stays server-side. Documented
exception, keeps netcode simple without breaking D1.

## 2. Client layer

| Option | Take |
|---|---|
| **Phaser 3/4** ✅ | Pixel-perfect pipeline, scenes/camera/input/audio managers, tilemap support, huge community. Heaviest bundle of the lot (~1 MB) — irrelevant here. Stays. |
| PixiJS v8 | Rendering-only; we'd hand-roll scenes/UI. Our hallway UI (panels, cards, HUD) favors Phaser's structure. Keep as fallback if bundle ever matters. |
| Excalibur.js | TS-native, clean DX, smaller ecosystem. Fine choice, no advantage over Phaser for us. |
| KAPLAY (Kaboom successor) | Tiny and fun; fewer guarantees for a networked project. No. |
| Vanilla Canvas + DOM overlay | Honest option given how simple the gray-box is — but camera, screen modes and future pixel art tilt it to Phaser. No. |

## 3. Netcode layer (the actual decision)

### Colyseus — current pick, **confirmed healthy**
Verified: active repo (7.2k★), MIT, v1.0 public roadmap, TS SDK, `npm create colyseus-app`.
- Authoritative room model matches D1 exactly; roles sent as private messages, truth stays server-side.
- Delta-compressed binary state sync + room codes + **built-in reconnection tokens** (D2/D3).
- Self-hosted Node container = plain file writes for JSONL telemetry (D6).
- Gaps: small core team (bus factor), v1.0 still pending; matchmaking beyond room codes is thin (we don't need it).

### PartyKit — strongest alternative
Verified: joined Cloudflare (2024), deploys to Durable Objects on the edge, generous free tier,
`partykit dev/deploy`, Socket.IO backend available, web-standards APIs.
- Rooms-as-parties, server class holds all secret state (D1 ✓), edge latency worldwide, near-zero ops (D5 ✓).
- Gaps: no state-sync primitives — we hand-roll 10–15 Hz JSON messaging (fine at our scale);
  free-tier storage is ephemeral (24h) → telemetry must ship off-platform or pay pennies;
  Cloudflare coupling (softened by standards-based APIs and deploy-to-your-CF-account option).

### Playroom (joinplayroom) — fastest first-playtest, unverified details
Sites blocked automated checks today; description from prior knowledge, **verify before adopting**.
- Jackbox-style kit: link + room code join, interstitials, player states — purpose-built for exactly
  our session shape, runs atop PartyKit.
- Gaps: optimized for casual party cadence, not continuous 10–15 Hz positional play;
  hidden/private state guarantees unclear — D1 makes this a blocking question, not a detail.

### Trystero — verified active, rejected for D1
Elegant serverless P2P over Nostr/BitTorrent/MQTT relays, auto chunking, E2E encryption,
runs 2026-current. But peers hold the state → hidden roles inspectable in any client's memory;
plus WebRTC/TURN friction on restrictive networks. Right tool for toy demos, wrong trust model for us.

### DIY (ws / Socket.IO / uWebSockets.js)
Full control, zero magic, everything hand-built: rooms, reconnect, serialization. At 6 players any of
them performs. Choose only if frameworks feel heavy — we'd rebuild Colyseus's 20% that we use.

### Excluded outright
Nakama (excluded per request) · Agones (K8s fleet orchestration, absurdly oversized) ·
Hathora/Rivet (game-server platforms, heavier than needed, status unverified) ·
Geckos.io (WebRTC UDP focus, maintenance questionable, we need none of it) ·
PeerJS (thin WebRTC wrapper, same D1 failure) · Firebase RTDB / Supabase Realtime
(presence/broadcast yes, game authority no, message-priced).

## 4. Scorecard vs drivers

| Option | D1 authority | D2 sync ergonomics | D3 codes/reconnect | D5 solo-TS fit | D6 telemetry | Net verdict |
|---|---|---|---|---|---|---|
| **Colyseus** | ✅ native | ✅ schema deltas | ✅ built-in | ✅ | ✅ trivial | **9/10 — primary** |
| PartyKit | ✅ | ⚠️ hand-rolled | ⚠️ partial | ✅ | ⚠️ ephemeral storage | 7.5/10 — fallback |
| Playroom | ❓ verify | ⚠️ party cadence | ✅ | ✅ | ❓ | spike-only |
| Trystero | ❌ fatal | ✅ | ✅ | ✅ | ❌ | reject |
| DIY ws | ✅ (you build it) | ❌ build it | ❌ build it | ✅ | ✅ | 6/10 — last resort |

## 5. Final stack

```
apps/
  client/     TypeScript + Vite + Phaser 3   (pixelArt mode, DOM overlay for HUD/panels)
  server/     Node.js + Colyseus             (authoritative rooms, 10 Hz tick, JSONL logs)
packages/
  shared/     types + constants (tuning values §PRD 7) + message schemas
tooling/      Vitest headless room-sim tests · KPI script over JSONL
deploy/       single container (server + static client, same origin) → Fly.io or Railway
```

Supporting cast: **Zod** (RPC message validation; Colyseus schema handles synced state) ·
**Howler.js** or native WebAudio (rustle = panned gain node, ~3-tile falloff) ·
**pnpm** workspaces · **pino** structured logging feeding the JSONL event store ·
**Vitest** running deterministic round simulations (rules are pure server logic — testable
without browsers, which is half the reason for the strict authority split).

## 6. Spatial model & collision (there is none — deliberately)

No physics engine is used; Phaser Arcade Physics stays disabled. Pass-through bodies +
linear rails remove all collision resolution, which is what keeps the client-reported
presence exception (§1) viable — colliding bodies would force server-side simulation and
reconciliation. What gameplay actually needs are queries:

| Gameplay rule | Implementation |
|---|---|
| Zone membership (room/floor) | Per-floor 1D interval lookup: hallway bounds, room x-ranges, door anchors |
| Accusation range (~2 tiles), rustle (~3 tiles) | `\|dx\|` comparison on same floor |
| Walk-in fire check | Threshold-crossing event at door anchor → evaluate un-prep channel state |
| Elevator capacity 2 | Server-side seat reservation (queue rule), not physical blocking |

Movement is `clamp(x, hallwayBounds)` plus discrete elevator teleports. Because positions
are client-reported, the server applies sanity checks only: max-speed clamp per tick and
floor changes accepted solely through elevator events — teleport hacks rejected without
ever simulating bodies.

## 7. Escape hatches

- Wrap the client transport behind one `GameClient` interface (connect/send/onState) —
  a PartyKit or DIY swap stays a two-day job, forever.
- Revisit triggers: Colyseus hosting pain in practice → PartyKit spike (≤2 days, budgeted);
  Playroom proves verifiable private state + real-time cadence → allowed into a spike, never
  straight into production.

## 8. Sources checked (2026-08)

PartyKit site/blog (Cloudflare acquisition confirmed) · Colyseus GitHub (activity, roadmap, SDKs) ·
Trystero GitHub (active maintenance, feature set) · Playroom/npm — bot-blocked, flagged unverified.
