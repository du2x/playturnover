# PRD — Turnover

Version: 1.0 · Status: Draft for gray-box phase · Owner: —
Name: **Turnover** (codename during docs: "Grand Hotel") · Domains reserved: turnover.game, playturnover.com
Companion docs: `roadmap.md` (build plan)

---

## 1. Vision

**Among Us with the meetings deleted and the evidence made physical.**
A 5-minute, browser-based social deduction game for 4–6 friends. Staff prepare hotel
rooms; one hidden saboteur quietly ruins them. No corpses, no meetings, no chat logs —
the hotel itself leaks traces (door cards, mess freshness, elevator panels), and spoken
testimony over Discord turns those traces into accusations. Wrong accusations get you
fired. The results screen exposes every lie after the fact.

## 2. Problem & Opportunity

- Social deduction is proven demand (Among Us et al.) but the market is saturated with
  murder-based clones that died post-hype.
- **Underserved wedge:** non-violent deduction — family/school/streamer-safe property
  crime instead of killing.
- **Cold-start problem** of party games is attacked directly: browser links (no installs),
  5-minute rounds, external voice assumed where players already are (Discord).
- Differentiation must be mechanical, not cosmetic: *physical evidence + testimony*,
  not vote meetings.

## 3. Target Audience & Platform

| | |
|---|---|
| Audience | Friend groups 13+, Discord communities, streamers needing advertiser-safe content |
| Platform MVP | Desktop browser (Chrome/Firefox/Edge), keyboard controls |
| Voice | External (Discord) — load-bearing dependency, testimony is the evidence currency |
| Session | 4–6 players · ~5 min rounds · drop-in lobby via room code |

Minimum-fun lobby is **6 players**; below 5 the attrition math and testimony pool degrade.

## 4. Goals & Non-Goals

### Goals (MVP)
1. A complete, winnable round loop with hidden saboteur in the browser.
2. Evidence layer dense enough that accusations can be *argued*, not guessed.
3. Full telemetry so playtests evaluate themselves against kill criteria.
4. Zero-install access: send a URL, play in seconds.

### Non-Goals (MVP)
- ❌ Art/audio polish (gray-box rectangles; Elevator Action pixel style comes later)
- ❌ Integrated or spatial voice, text-chat systems
- ❌ Matchmaking, accounts, progression, monetization
- ❌ Mobile/touch support
- ❌ Multiple maps, extra roles, saboteur utility tools beyond pure vandalism

## 5. Core Loop

```
Lobby gather-up → secret roles → SHIFT (5:00)
  Staff:   prep rooms (5s) · patrol hallways · read door cards · spot-check
           · testify on voice · accuse
  Saboteur: un-prep (3s) · re-trash · fake prep · decoy elevator calls · lie
→ Buzzer / firing / coverage → Results: winner + traitor reveal + event recap
→ post-round argument (retention engine)
```

Design pillars:
1. **Position is evidence** — linear halls force proximity; being seen matters.
2. **Information has travel cost** — room states only inside rooms; every trace must be walked to.
3. **Diegetic traces only** — the hotel leaks data through objects (cards, cars, noise),
   never through UI oracles (one exception: HUD coverage %).
4. **Two-tier justice** — direct evidence (walk-in) convicts automatically;
   circumstantial evidence goes through risky personal accusation.

## 6. Functional Requirements

### 6.1 Session & Lobby
- FR-1 Create/join room by code, display names, max 6 players.
- FR-2 Host starts round when ≥4 players. Roles assigned secretly at lobby gather-up spawn.

### 6.2 Space & Movement
- FR-3 Building: grand lobby + 3 guest floors × 7–8 rooms (~24 rooms total).
- FR-4 Linear left/right movement only; pass-through bodies (no collision).
- FR-5 Two elevators at opposite ends of each floor. Capacity 2 per car.
      Deterministic cycle: call → car arrives 3s → ride 2s.
- FR-6 Public elevator panels show both cars' current positions (decoy calls emerge naturally).

### 6.3 Work Actions
- FR-7 Staff prep: channel inside room, 5s, clean→prepped.
- FR-8 Saboteur un-prep: channel, 3s, prepped→trashed. Re-trashing allowed.
- FR-9 Fake prep available to saboteur; all work animations identical across roles.
- FR-10 Room state (prepped/trashed/fresh/settled) readable **only while inside the room**.
       Doors auto-open on entry; hallway shows nothing of interiors.

### 6.4 Evidence Layer
- FR-11 Door status cards: auto-hung on prep completion, **permanent** (saboteur cannot remove).
- FR-12 Trash freshness: two visual tiers — fresh ≤75s since sabotage, then settled.
- FR-13 Sabotage rustle audio audible within ~3 tiles only.
- FR-14 Coverage % meter always visible on HUD.

### 6.5 Justice System
- FR-15 Walk-in conviction: entering a room during an active un-prep channel instantly
       fires the saboteur.
- FR-16 Voluntary walk-out mid-channel cancels cleanly: room unchanged, no trace, no fire.
- FR-17 Accusation: staff-only, within ~2 tiles on same floor, hold E → confirm menu.
- FR-18 Wrong accusation = accuser fired. Accusing the saboteur **before his first
       un-prep** (grace period) counts as wrong and fires the accuser.
- FR-19 Correct accusation fires the saboteur.
- FR-20 Fired players become spectators with full-building overview camera until round end.

### 6.6 Win Conditions
| Side | Wins when |
|---|---|
| Staff | Saboteur fired (walk-in or correct accusation) **or** ≥80% rooms prepped at 5:00 buzzer |
| Saboteur | <80% coverage at buzzer **or** staff reduced to 1 player |

### 6.7 Results & Recap
- FR-21 Winner banner + traitor identity reveal.
- FR-22 Event recap timeline: crimes (with freshness timestamps), rides, catches,
       accusations and their validity.

### 6.8 Telemetry (internal)
- FR-23 Server-authoritative JSONL log per round: every room transition (actor+time),
      elevator calls/rides, walk-in catches, accusations (`wasTargetSaboteur`,
      `crimeOccurred` flags), coverage sampled once per second.
- FR-24 Post-round KPI computation: saboteur win rate · correct-accusation rate ·
      catches/hour · time-to-first-crime-discovery · decoy-call usage.

## 7. Tuning Values (single source of truth)

| Parameter | Value | Reserve dial order |
|---|---|---|
| Players | 4–6 (target 5–6) | — |
| Shift length | 5:00 | — |
| Rooms | ~24 (3 floors × 7–8) | — |
| Prep / un-prep | 5s / 3s | un-prep → 2s if saboteur weak |
| Re-trash | Unlimited | — |
| Coverage target | 80% | — |
| Attrition loss | Staff down to 1 | scale by lobby size later |
| Freshness window | 75s | — |
| Rustle range | ~3 tiles | — |
| Elevator | arrive 3s / ride 2s / cap 2 | — |
| Accusation range | ~2 tiles, same floor | card-read range later |

## 8. Success Metrics & Kill Criteria

Ten recorded playtest sessions (5–6 players, Discord voice, rotating groups) decide:

| Metric | Healthy | Action if missed |
|---|---|---|
| Saboteur win rate | 35–65% | <35% → spend dials in §7 order, retest each |
| Correct accusations | ≥4 per 10 rounds | instrument which conviction-chain link fails first |
| Walk-in catches | ~0.3–0.7 per round | frequent → shrink un-prep window value; never → acceptable, testimony carries |
| Saboteur-reported fun | majority "fun" not "hunted" | power-budget problem even at healthy win rate |
| Panels referenced in voice | organically by staff | never → filtering link not landing |

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Saboteur power budget vs 5 info systems | High | Reserve dials §7, watch saboteur fun metric |
| Onboarding weight (5 readable systems) | Medium | Time-to-first-correct-deduction tracked; add tutorial scenario before adding UI |
| Voice dependency caps audience (PC/Discord only) | Medium | Accepted for MVP; spatial voice is retention expansion |
| Cold-start liquidity (<6 players) | High | Browser zero-install distribution; community seeding via Discord |
| Tone drift (cozy → procedural hunt) | Low | Deliberate marketing decision post-playtest |
| Buzzer-ending anticlimax | Medium | Live coverage % + dramatic results screen |

## 10. Post-MVP Backlog (parking lot, unprioritized)

Pullable door cards (saboteur counterplay) · timestamped personal notebook ·
front-desk physical annotation board · integrated/spatial voice · second map ·
extra roles & saboteur tools (DND signs, floor blackout) · mobile/touch ·
tutorial scenario · cosmetics (uniforms, room themes) · attrition scaling by lobby size.

## 11. Tech Stack

TypeScript + Phaser 3 client · Node.js + Colyseus authoritative server ·
shared types monorepo · single container deploy (client static + WebSocket) ·
no auth, no DB for MVP (JSONL files suffice).
