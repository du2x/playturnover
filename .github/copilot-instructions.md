# Copilot instructions for Turnover

This repository follows the milestone pipeline defined in `AGENTIC-WORKFLOW.md`. The OpenCode harness in `.opencode/agent/` has been mirrored into Copilot chat modes so the same workflow can run in VS Code without changing the repo's product rules.

## First read

Before making changes, read `STATE.md` first. Resume from the recorded milestone state instead of redoing finished work. If the user does not specify a milestone, work the first `pending` milestone.

## Product rules

- `prd.md` is the source of truth for requirements and §7 tuning values.
- `roadmap.md` owns milestone scope and exit criteria.
- `techstack.md` is authoritative for architecture and tool constraints.
- `STATE.md` is the single source of truth for progress; only the orchestrator updates it.
- Keep server-authoritative game state on the server; do not move rule-bearing logic into the client.
- All tuning constants live in `packages/shared` and must be imported rather than hardcoded.
- Do not add physics or collision bodies beyond the project rules.
- Follow strict TypeScript rules: use `import type` / `export type` for type-only imports when required.

## Write access boundaries

- The orchestrator owns `STATE.md`.
- Spec files live under `.dev/specs/` and are written by the spec-creator role.
- Plan files live under `.dev/plans/` and are written by the planner role.
- Product code is the only area builders may change.
- Verifiers do not edit code; they record evidence and pass/fail findings.
- Never edit `.dev/specs/*`, `.dev/plans/*`, `STATE.md`, `AGENTS.md`, or anything under `.opencode/` unless the role explicitly says so.

## Pipeline

Per milestone, work in this order:

1. `spec-creator`: produce `.dev/specs/<M#>-spec.md` with verifiable requirements.
2. `planner`: produce `.dev/plans/<M#>-plan.md` with atomic tasks, dependencies, and verify steps.
3. `builder`: implement exactly one assigned task and verify it.
4. `verifier`: run the milestone's evidence checks and report pass/fail.

Use the matching Copilot chat modes in `.github/chatmodes/` when working through the process in VS Code.

## Hotfix workflow

If the build or verify phase is blocked by an infra or scaffolding issue, switch to a hotfix-only repair: fix the root cause, rerun the original verification, and resume the current phase without re-specing or re-planning the milestone.

## Validation

Before accepting spec or plan outputs, run the repo validation gates when relevant:

- `python3 scripts/validate-spec.py .dev/specs/<M#>-spec.md`
- `python3 scripts/validate-plan.py .dev/plans/<M#>-plan.md --spec .dev/specs/<M#>-spec.md`
- `python3 scripts/validate-state.py <M#>` when the milestone is being closed

No milestone is complete without evidence that the verification criteria passed.
