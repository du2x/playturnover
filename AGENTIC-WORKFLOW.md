# Agentic Development Workflow — Turnover

This repo is built by an **agentic pipeline**: one orchestrator coordinates four
specialist subagents per roadmap milestone. Humans talk to the orchestrator; the
orchestrator talks to everyone else. `opencode.json` sets `orchestrator` as the
default agent, so starting OpenCode in this repo drops you into the coordinator.

This file is the reference for *how the process works*. The repo's technical
ramp-up (commands, architecture, conventions) lives in `AGENTS.md`.

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
(`pending → specifying → planning → building → verifying → done | blocked | hotfixing`),
appending a dated log line per event and recording blockers verbatim.

### Hotfix workflow (out-of-band repair)

Use when `BUILD` or `VERIFY` is blocked by an infrastructure / dependency / scaffolding
breakage that is not a spec or plan error (e.g. registry unpublishes a pinned version,
`pnpm install` fails, container base image deprecated). A hotfix does not re-spec or
re-plan the milestone — it repairs the tree so the current phase can resume.

```
  building ─┐
            ├─► hotfixing ─► building (resume) ─► verifying ─► done
  verifying ┘        ▲               │
  blocked   ─────────┘               └─► blocked (if hotfix fails twice → escalate)
```

Rules:
- Trigger: orchestrator sets milestone `Status=hotfix`, `Phase=HOTFIX`, records blocker
  and `HOTFIX started → <reason>` in `STATE.md` Log (immediate, not batched).
- Scope: minimal repair only — dependency pins, scaffold gaps, tooling scripts,
  `Dockerfile`/CI shims. No spec/plan edits, no feature scope change.
- Execution: orchestrator (or a single `builder` with task id `HOTFIX-<M#>`) applies the
  fix and runs the phase's original verify step (`pnpm install && pnpm -r typecheck/build/test`
  for a BUILD hotfix). One retry allowed.
- Exit: `PASS` → set `Status=building` (or `verifying` if the hotfix was during verify),
  append `HOTFIX done → resume <phase>` to Log and continue the normal pipeline.
  `FAIL` twice → `Status=blocked`, record failing criteria, escalate to human.
- Audit: hotfix reason, files touched, and verification evidence are appended to
  `STATE.md` Decisions and Log; no new spec/plan artifact is created.

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

- Start OpenCode in this repo; the orchestrator is the default agent.
- Say `run M0` / `continue`, or name a milestone. Track progress in `STATE.md`.
- Artifacts accumulate under `.dev/{specs,plans,reports}/` — commit them alongside code;
  they are the audit trail of how every feature came to be.
- Operator-only steps (e.g. provisioning the Fly.io deploy account and recording the
  public URL) are outside builder scope and are flagged in `STATE.md` as blockers until
  a human does them.
