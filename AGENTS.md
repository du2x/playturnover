# AGENTS.md — Turnover (prototype, codename "Grand Hotel")

Product docs: `prd.md` (requirements) · `roadmap.md` (milestones M0–M3) ·
`techstack.md` (stack law). Progress lives in `STATE.md` — read it before doing anything.

This repo is developed through an **agentic pipeline**: one orchestrator coordinates four
specialist subagents per milestone. Humans talk to the orchestrator; the orchestrator talks
to everyone else.

## Agents

| Agent | Definition | Mode | Reads | Writes |
|---|---|---|---|---|
| **orchestrator** | `.opencode/agent/orchestrator.md` | primary | everything | `STATE.md` only |
| **spec-creator** | `.opencode/agent/spec-creator.md` | subagent | prd / roadmap / techstack / code | `.dev/specs/<M#>-spec.md` |
| **planner** | `.opencode/agent/planner.md` | subagent | spec / code | `.dev/plans/<M#>-plan.md` |
| **builder** | `.opencode/agent/builder.md` | subagent | task / spec / plan / code | product code only |
| **verifier** | `.opencode/agent/verifier.md` | subagent, edit denied | spec / plan / code | `.dev/reports/<M#>-verification.md` |

## Pipeline (per milestone)

```
                    ┌─────────────────────────────────────────────┐
                    │                 ORCHESTRATOR                │
                    │        owns STATE.md · spawns everyone      │
                    └─────────────────────────────────────────────┘
  1 SPEC    ──► spec-creator   ⇒ .dev/specs/<M#>-spec.md       WHAT + how to verify
  2 PLAN    ──► planner        ⇒ .dev/plans/<M#>-plan.md       atomic tasks → stages →
                                                                parallel groups + deps
  3 BUILD   ──► builder ×N     ⇒ product code                  stage order respected;
                   ▲                                            parallel groups run as
                   └─ 1 retry w/ failure report                 concurrent builders
  4 VERIFY  ──► verifier       ⇒ .dev/reports/<M#>-verification.md
      │ PASS ⇒ milestone done in STATE.md → next milestone
      └ FAIL ⇒ failed items back to builders (step 3) → re-verify
               2 failed loops ⇒ status blocked, escalate to human
```

The orchestrator updates `STATE.md` after every phase transition
(`pending → specifying → planning → building → verifying → done | blocked`),
appending a dated log line per event and recording blockers verbatim.

## Rules

1. Write access is role-scoped: only the orchestrator writes `STATE.md`; specs come only
   from spec-creator; plans only from planner; builders touch product code; the verifier
   edits nothing (by permission, not by promise).
2. Specs are verification-first: every requirement carries an executable or concretely
   checkable criterion (`V-n`). No criterion, no requirement.
3. Plans are atomic: one task = one reviewable unit with its own verify step.
   Independent tasks in a stage are file-disjoint and get spawned as concurrent builders.
4. Nothing counts as done without a verifier PASS against the spec's criteria.
5. On session start: read `STATE.md` first and resume from recorded state — never redo
   completed phases.

## Running it

- Start opencode in this repo; the orchestrator is the default agent.
- Say `run M0` / `continue`, or name a milestone. Track progress in `STATE.md`.
- Artifacts accumulate under `.dev/{specs,plans,reports}/` — commit them alongside code;
  they are the audit trail of how every feature came to be.
