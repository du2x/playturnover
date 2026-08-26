# STATE — agentic dev pipeline

> Single source of truth for progress. Written ONLY by the orchestrator,
> immediately after every phase transition. Read this first on every session.

Status legend: `pending · specifying · planning · building · verifying · done · blocked`

## Milestones

| ID | Title | Status | Phase | Spec | Plan | Verification |
|----|---------------------|--------|-------|------|------|--------------|
| M0 | Walking skeleton | building | BUILD | .dev/specs/M0-spec.md | .dev/plans/M0-plan.md | — |
| M1 | Full round loop | pending | — | — | — | — |
| M2 | Evidence layer | pending | — | — | — | — |
| M3 | Justice + recap | pending | — | — | — | — |

**Next up:** M0 in progress (BUILD phase — S1: M0.1.1).
**User action pending:** deploy account (Fly.io) + URL needed before M0 VERIFY V-8/V-9 live.

## Blockers

(none)

## Decisions

(none)

## Log

| When | Milestone | Event |
|------------|-----------|------------------------------------------------|
| 2026-08-26 | — | Pipeline initialized; agents created; nothing built yet |
| 2026-08-26 | M0 | SPEC started → spec-creator spawned |
| 2026-08-26 | M0 | SPEC done → .dev/specs/M0-spec.md accepted (V-1…V-9, no blockers); flagged: deploy account needed before verify |
| 2026-08-26 | M0 | PLAN started → planner spawned |
| 2026-08-26 | M0 | PLAN done → .dev/plans/M0-plan.md accepted (9 tasks, 6 stages, 2 parallel groups; all R-1…R-9 covered) |
| 2026-08-26 | M0 | BUILD started → S1: M0.1.1 spawned |
