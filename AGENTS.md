# AGENTS.md — Turnover (prototype, codename "Grand Hotel")

Browser-based social-deduction game (5-min rounds, hidden saboteur). TypeScript
monorepo: Phaser 3 client + Colyseus authoritative server + shared package, deployed
as one container. **Built via an agentic pipeline — see [`AGENTIC-WORKFLOW.md`](./AGENTIC-WORKFLOW.md)**
(`opencode.json` sets the orchestrator as the default agent). This file is the
technical ramp-up; it does not describe the pipeline.

## Read these first (in this order)

- `STATE.md` — source of truth for progress. Read it on every session start.
- `prd.md` — requirements + §7 tuning values (the only place numbers are defined).
- `roadmap.md` — milestones M0–M3, each with an exit criterion.
- `techstack.md` — architectural law; the rules below are non-negotiable.

## Monorepo & commands

pnpm workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, `tooling`).
`deploy/` is config only — not a workspace.

| Workspace | Name | Role |
|---|---|---|
| `packages/shared` | `@grandhotel/shared` | **Single source of truth** for PRD §7 tuning constants, Colyseus schemas, Zod message schemas |
| `apps/server` | `@grandhotel/server` | Node + Colyseus authoritative room logic (dev port 2567, `tsx watch`) |
| `apps/client` | `@grandhotel/client` | Vite + Phaser 3 client (dev port 5173) |
| `tooling` | `@grandhotel/tooling` | Integration harness, smoke script, per-milestone `verify:m0` gate |

Root scripts (the canonical entrypoints):
- `pnpm install` — if pnpm missing: `corepack enable` (it's pinned via `packageManager`).
- `pnpm typecheck` / `pnpm build` / `pnpm test` → recurse every workspace (`pnpm -r`).
- `pnpm dev:server` / `pnpm dev:client` — run one side locally.
- `pnpm smoke:local` / `pnpm smoke:remote` — two-client transport smoke check.
- `pnpm verify:m0` — M0 final gate (chains install→typecheck→build→test→smoke→docker).
- Per-package: `pnpm --filter @grandhotel/<client|server|shared|tooling> <script>`.

## Architecture constraints an agent would miss

- **Server-authoritative.** All rule-bearing state (roles, room states, channels,
  timers, elevators, accusations) lives server-side in Colyseus Schema. The only
  documented exception: avatar *positions* are client-reported presence, sanity-clamped
  server-side. Never put game rules in the client.
- **No physics engine.** Phaser Arcade Physics stays **disabled**. Movement is
  `clamp(x, bounds)` + discrete elevator teleports; pass-through bodies. Distance checks
  are `|dx|` on the same floor. Do not add collision bodies.
- **`tsconfig.base.json` is strict about imports:** `verbatimModuleSyntax: true` and
  `isolatedModules: true` → use `import type` / `export type` for all type-only imports
  or it will not compile.
- **Tuning constants live only in `@grandhotel/shared`** (`src/constants.ts`, sourced
  from PRD §7). Import them (e.g. `MAX_PLAYERS`) — never hardcode literals. The M0 verify
  step greps for stray `6` in the cap context; keep the shared constant as the only source.
- **Client transport is behind the `GameClient` interface** (escape hatch, techstack §7).
  Gameplay/UI must not import Colyseus types directly — use the `RoomStateView`
  projection. Client endpoint comes from `import.meta.env.VITE_GAME_URL` (defaults to
  same origin) — keep that wiring for the single-origin deploy.

## Testing

Vitest (`vitest run`). Server tests use Colyseus test utilities / direct `Room`
simulation. Tooling integration tests spawn a real server on an ephemeral port and
connect two `colyseus.js` clients — **no browser required** for automated checks.
`pnpm verify:m0` (or the milestone's `verify:mx`) is the gate; a few V-criteria stay
manual (visual/two-browser) and are marked SKIP-MANUAL.

## Deploy (operator step, not a builder task)

Single container, server + static client same origin, Fly.io via `fly.toml`.
`fly launch --no-deploy` then `fly deploy`. Requires a human-provisioned Fly account;
the resulting `PUBLIC_URL` must be recorded in `STATE.md` Decisions and `deploy/README.md`
before V-8 (live smoke) and V-9b (two-browser) can run.

## Context7 / library docs

`opencode.json` registers the Context7 MCP server (`context7`). Use it for every
question about third-party APIs in this monorepo — especially **Colyseus
(`0.15.x`), Phaser (`3.80.x`), Zod, Express, Vite, Vitest, TypeScript, and
`@colyseus/schema`** — instead of relying on training data.

How to use it:

- **Include `use context7` in the prompt** when asking for implementation details,
  migration help, or API examples. Good: `“How do I filter room state callbacks in
  Colyseus? use context7.”`
- **Or invoke the tools directly** when you are unsure of an API:
  1. `context7_resolve-library-id` with the package name (e.g., `colyseus`).
  2. `context7_query-docs` with the resolved ID and a focused topic.
- **Be specific about the installed version.** The monorepo pins exact versions in
  `package.json`; ask for docs matching those versions rather than “latest”.
- **Do not use Context7** for project-specific rules (PRD, architecture, state
  machine) — those are already in `prd.md`, `techstack.md`, and this file.

## Environment quirks

- `.npmrc` sets `shamefully-hoist=false` → strict module isolation; do not rely on
  hoisted transitive deps.
- Node `>=18` (engines); devcontainer image is Node 20 with pnpm 9.15.9.
- Devcontainer forwards ports: 2567 (Colyseus WS), 5173 (Vite), 8080 (container deploy).
