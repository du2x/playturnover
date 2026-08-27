# Turnover (codename "Grand Hotel")

> **Among Us with the meetings deleted and the evidence made physical.**

A 5-minute, browser-based social-deduction game for 4–6 friends. Staff prepare hotel
rooms; one hidden saboteur quietly ruins them. No corpses, no meetings, no chat logs —
the hotel itself leaks traces (door cards, mess freshness, elevator panels), and spoken
testimony over Discord turns those traces into accusations. Wrong accusations get you
fired. The results screen exposes every lie after the fact.

Zero installs: send a URL, play in seconds. Voice lives in Discord (external, load-bearing).

## Status

Milestone-driven prototype built by an agentic pipeline. See `STATE.md` (source of
truth for progress), `prd.md` (requirements + tuning values), `roadmap.md` (milestones),
`techstack.md` (architecture law).

| Milestone | Description | Status |
|---|---|---|
| M0 | Walking skeleton (two browsers move together, lobby, one floor) | ✅ done |
| M1 | Full round loop (3 floors, elevators, roles, prep/unprep, win checks) | ✅ done |
| M2 | Evidence layer (door cards, freshness, coverage HUD, panels) | ✅ done |
| M3 | Justice + recap (walk-ins, accusations, spectator cam, event log) | 🔄 building (S2) |

> M3 is in BUILD S2 — `M3.2.1` walk-in & accusation justice ∥ `M3.2.2` spectator & event state (shared contracts `M3.1.1` done). Next: client accusation/spectator UX and integration gates. See `STATE.md` for the live pipeline log.

## The core loop

```
Lobby gather-up → secret roles → SHIFT (5:00)
  Staff:    prep rooms (5s) · patrol hallways · read door cards · spot-check
            · testify on voice · accuse
  Saboteur: un-prep (3s) · re-trash · fake prep · decoy elevator calls · lie
→ Buzzer / firing / coverage → Results: winner + traitor reveal + event recap
→ post-round argument (retention engine)
```

Design pillars: **position is evidence** (linear halls, proximity matters) ·
**information has travel cost** (room states only visible inside rooms) ·
**diegetic traces only** (no UI oracles, one exception: HUD coverage %) ·
**two-tier justice** (walk-in auto-convicts; circumstantial goes through risky accusation).

## Repo layout

pnpm workspaces (`pnpm-workspace.yaml`):

| Workspace | Name | Role |
|---|---|---|
| `packages/shared` | `@grandhotel/shared` | **Single source of truth** for tuning constants, Colyseus schemas, Zod message schemas |
| `apps/server` | `@grandhotel/server` | Node + Colyseus authoritative room logic (dev port 2567) |
| `apps/client` | `@grandhotel/client` | Vite + Phaser 3 client (dev port 5173) |
| `tooling` | `@grandhotel/tooling` | Integration harness + smoke script (two real `colyseus.js` clients, no browser) |
| `deploy/` | — | Fly.io config (not a workspace) |

## Getting started

Requires Node ≥18 and `pnpm` (9.15.9 pinned; run `corepack enable` if missing).

```bash
pnpm install --frozen-lockfile

pnpm typecheck        # type-check every workspace
pnpm build            # build every workspace
pnpm test             # run unit tests (skips tooling integration suites)

pnpm dev:server       # Colyseus server on :2567 (tsx watch)
pnpm dev:client       # Vite client on :5173

pnpm smoke:local      # two-client transport smoke (no browser)
pnpm smoke:remote     # remote smoke — needs a deployed PUBLIC_URL

pnpm verify:m0        # milestone final gates (install → typecheck/build → tests
pnpm verify:m1        #   → integration → literal sweep → docker → smoke)
pnpm verify:m2        #   M3 gate pending (scripts/verify-m3.sh) — run verify:m2 for full M2 regression
```

Per-package: `pnpm --filter @grandhotel/<client|server|shared|tooling> <script>`.
Tooling integration suites run behind `pnpm --filter @grandhotel/tooling test:integration` (needs `--testTimeout=20000`, spawns real server on ephemeral port).

## Architecture (non-negotiable — see `techstack.md`)

- **Server-authoritative.** All rule-bearing state lives server-side in Colyseus Schema.
  The only exception: avatar *positions* are client-reported, sanity-clamped server-side.
  Never put game rules in the client.
- **No physics engine.** Phaser Arcade Physics stays disabled. Movement is
  `clamp(x, bounds)` + discrete elevator teleports; pass-through bodies.
- **Tuning constants live only in `@grandhotel/shared`** (`src/constants.ts`, from PRD §7).
  Import them — never hardcode literals.
- **Strict TypeScript imports**: `verbatimModuleSyntax` + `isolatedModules` → use
  `import type` / `export type` for type-only imports or it will not compile.
- **Client transport behind the `GameClient` interface** — gameplay/UI never import
  Colyseus types directly; they use the `RoomStateView` projection.

## Testing & gates

- Vitest (`vitest run`). Server tests use Colyseus test utilities / direct `Room` simulation.
  Tooling integration tests spawn a real server on an ephemeral port and connect two
  `colyseus.js` clients — no browser needed.
- `pnpm -r test` skips tooling's integration suites; run those via
  `pnpm --filter @grandhotel/tooling test:integration`.
- `pnpm verify:m0` / `verify:m1` / `verify:m2` are the milestone gates (bash wrappers chain
  install → typecheck/build → tests → integration → literal sweep → docker → smoke). `verify:m3`
  lands with M3 close-out.
- Deterministic pipeline gates: `pnpm validate:spec` / `validate:plan` / `validate:state` + `check:commit`
  (`python3 scripts/validate-*.py`).
- No CI — every gate runs locally via `scripts/` (`verify-m*.sh`, `validate-*.py`,
  `check-commit.py`).
- The git `commit-msg` hook enforces **Conventional Commits**
  (`type(scope): description`).

## Deployment

Single container (server + static client, same origin) on Fly.io via `fly.toml`.
`fly launch --no-deploy` then `fly deploy`. Requires a human-provisioned Fly account;
the resulting `PUBLIC_URL` must be recorded in `STATE.md` before live two-browser
verification can run.

## Docs

- `prd.md` — product requirements; §7 holds the tuning values (the only place numbers are defined)
- `roadmap.md` — milestones M0–M3, each with an exit criterion
- `techstack.md` — architectural law
- `STATE.md` — source of truth for pipeline progress
- `AGENTS.md` / `AGENTIC-WORKFLOW.md` — technical ramp-up and the agentic pipeline
- `.dev/specs/` / `.dev/plans/` / `.dev/reports/` — pipeline artifacts per milestone (spec → plan → verification)
