# Grand Hotel — Prototype Roadmap

Gray-box prototype: TypeScript + Phaser 3 client, Node.js + Colyseus authoritative server,
deployed to a public URL from day one. Voice via Discord. Solo dev, ~3–4 weeks to test-ready.

**Goal:** reach 10 recorded playtest sessions and evaluate kill criteria.
Reference spec: v1.1 (evidence layer included).

---

## M0 — Walking Skeleton (~4 days)

> Exit criterion: two browsers see each other move in real time.

- Monorepo scaffold: Vite + Phaser client, Colyseus server, shared types
- Deploy pipeline to public URL (client static + WebSocket container)
- Lobby flow: display name → create room / join by code (max 6 players)
- One floor: hallway strip, left/right movement, pass-through bodies
- Server-authoritative position sync (interpolation client-side)
- Round lifecycle stubs: waiting → playing → results (empty results for now)

## M1 — Full Round Loop (~5 days)

> Exit criterion: strangers complete a full round start→finish, someone wins.

- All 3 floors × 7–8 rooms (~24 rooms), hall layout locked
- Elevators as teleport buttons first (no car animation), fixed cycle timing
  - Call button → car arrives in 3s → ride takes 2s (deterministic, arguable)
- Role assignment: 1 secret saboteur, rest staff, lobby gather-up spawn
- Prep action: hold in room, 5s channel, room state clean→prepped
- Unprep action: saboteur only, 3s channel, prepped→trashed, re-trash allowed
- Fake prep animation available to saboteur (identical visuals)
- Win checks: ≥80% coverage at 5:00 buzzer · staff down to 1 attrition loss
- Results screen v1: winner banner + traitor reveal

## M2 — Evidence Layer (~4 days)

> Exit criterion: a tester discovers sabotage via a hallway card, not by entering blind.

- Door status cards: auto-hang on prep completion, permanent
- Trash freshness: two tiers, fresh ≤75s → settled (sprite swap + timer)
- Coverage % meter, always visible on HUD
- Public elevator position panels (both shafts readable)
- Decoy calls emerge naturally (call button works without boarding)
- Rustle audio during sabotage, ~3 tile range (WebAudio)
- Ruling pinned: voluntary walk-out mid-unprep cancels cleanly, no trace, no fire

## M3 — Justice + Recap (~4 days)

> Exit criterion: a round gets decided by testimony leading to a correct accusation.

- Walk-in detection: entering a room mid-unprep-channel = saboteur instantly fired
- Accusation UX: within ~2 tiles, same floor, hold E → confirm menu
- Grace-period rule: accusing saboteur before his first unprep fires the accuser
- Wrong accusation = accuser fired; correct = saboteur fired
- Fired players → spectator cam (full-building overview)
- Event log recap screen: full timeline of crimes, rides, catches, accusations

---

## Telemetry & KPIs (build during M1–M3, complete before testing)

- Server-side JSONL event log per round: room transitions, elevator calls/rides,
  catches, accusations (`wasTargetSaboteur`, `crimeOccurred` flags), coverage sampled 1/s
- Post-round KPI script: saboteur win rate · correct-accusation rate ·
  catches/hour · time-to-first-discovery · decoy-call usage
- Auto-generated recap page so sessions review themselves

## Playtest Protocol (10 sessions)

- 10 sessions × 5–6 players, rotating friend groups, Discord voice
- Post-session questions: who did you suspect & why · what confused you ·
  would you play tomorrow
- Direct question to saboteur-assigned players: fun, or felt hunted?
- Log results next to KPI output per session

## Kill Criteria / Reserve Dials

Evaluate after 10 sessions. Spend dials one at a time, retest between:

- Saboteur win rate <35% → dial 1: unprep 3s→2s
- Still <35% → dial 2: card readability range limited
- Still <35% → dial 3: revisit permanent cards (pullable upgrade)
- Correct accusations in <4/10 rounds despite kit → instrument which conviction
  chain link fails before touching anything
- Staff never reference elevator panels in voice → filtering link not landing
