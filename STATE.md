# STATE — agentic dev pipeline

> Single source of truth for progress. Written ONLY by the orchestrator,
> immediately after every phase transition. Read this first on every session.

Status legend: `pending · specifying · planning · building · verifying · done · blocked`

## Milestones

| ID | Title | Status | Phase | Spec | Plan | Verification |
|----|---------------------|--------|-------|------|------|--------------|
| M0 | Walking skeleton | planning | PLAN | .dev/specs/M0-spec.md | — | — |
| M1 | Full round loop | pending | — | — | — | — |
| M2 | Evidence layer | pending | — | — | — | — |
| M3 | Justice + recap | pending | — | — | — | — |

**Next up:** M0 in progress (PLAN phase). Spec accepted with no blocking questions.
**User action pending:** deploy target needs an account (Fly.io or Railway) + URL decision
before M0 VERIFY runs V-8/V-9 against a live deployment.

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
