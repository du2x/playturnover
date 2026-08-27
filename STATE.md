# STATE — agentic dev pipeline

> Single source of truth for progress. Written ONLY by the orchestrator,
> immediately after every phase transition. Read this first on every session.

Status legend: `pending · specifying · planning · building · verifying · done · blocked · hotfixing`

## Milestones

| ID | Title | Status | Phase | Spec | Plan | Verification |
|----|---------------------|--------|-------|------|------|--------------|
| M0 | Walking skeleton | done | done | .dev/specs/M0-spec.md | .dev/plans/M0-plan.md | .dev/reports/M0-verification.md |
| M1 | Full round loop | done | done | .dev/specs/M1-spec.md | .dev/plans/M1-plan.md | .dev/reports/M1-verification.md |
| M2 | Evidence layer | pending | — | — | — | — |
| M3 | Justice + recap | pending | — | — | — | — |

**Next up:** M2 SPEC (pending user go-ahead) — spawn `spec-creator`; carry over V-2 selector fix (spec/plan `-t "horizontal clamp"`/`"position clamp"` are vacuous) and the operator-pending `PUBLIC_URL` (needed for live two-browser V-9b, not blocking).
**User action pending:** `fly deploy` app `turnover-grandhotel` → record `PUBLIC_URL` in STATE.md Decisions + deploy/README.md to enable `smoke:remote` + two-browser V-9b (M0 carry-over, not blocking M1).

## Blockers

(none) — HOTFIX cleared 2026-08-26: `colyseus ^0.15.57` + `@colyseus/schema ^2.0.37` now install; `tooling` workspace restored. Note: M1.5.x test teardown emitted non-blocking `onDispose error: Cannot read properties of undefined (reading 'remove')`; **resolved in M1.7.1** via `listing` stub in `HotelRoom.onCreate` + `colyseus-compat` type.

## Decisions

| When | Decision |
|------|----------|
| 2026-08-26 | Hotfix workflow added (`AGENTIC-WORKFLOW.md` § Hotfix workflow); transition `building → hotfixing → building` authorized for infra/scaffold breakage. |
| 2026-08-26 | M0 moved to `hotfix` to repair dependency pins + scaffold before resuming S1→S2. Scope: minimal repair, no spec/plan change. |
| 2026-08-26 | HOTFIX-M0 PASS: bumped `@colyseus/schema ^0.5.70 → ^2.0.37`, `colyseus ^0.15.26 → ^0.15.57`; created `tooling/package.json` + `src/smoke.ts` + `tsconfig.json`; `pnpm install && pnpm -r typecheck/build/test` now PASS (4 workspaces). |
| 2026-08-26 | M0 VERIFY PASS: all automated V-1…V-9 PASS, 4 SKIP-MANUAL justified; root verify:m0 should forward to `bash scripts/verify-m0.sh` (non-blocking). |
| 2026-08-26 | Operator pending: PUBLIC_URL not yet set — requires `fly deploy` of turnover-grandhotel then update STATE.md + deploy/README.md for live V-8/V-9b. |
| 2026-08-26 | TLC-spec-driven graft (Option A): installed `.opencode/skills/tlc-spec-driven` (SKILL.md + 5 scripts, CC-BY-4.0), adapted 4 gates to Turnover shape: `scripts/validate-spec.py`, `scripts/validate-plan.py`, `scripts/validate-state.py`, `scripts/check-commit.py`; wired into spec-creator/planner/verifier/builder + orchestrator gates; `package.json` scripts `validate:*` + `check:commit`; git `commit-msg` hook enforcing Conventional Commits; `verify:m0` now → `bash scripts/verify-m0.sh`. |
| 2026-08-26 | **HOTFIX-RECOVER** (post-reset): `git reset --hard HEAD~1` during first M1.6.1 spawn dropped `2683e9f` and reverted uncommitted files. Recovered from `ec32b33` (stash: shared pkg entry points + barrel + tsconfig + server index), dangling blob `ce67cd3` (M1.5.1 HotelRoom 700 lines), `2683e9f` (client M1.4.2+M1.5.2 files), blob `f5ec3e03` (dom.ts with createSelect); staged M1.6.1 WIP preserved. `pnpm -r typecheck` + `pnpm -r test` green again. Rule: no `git reset --hard` / `git amend` in this repo without orchestrator go-ahead. |
| 2026-08-26 | M1 | Parallel-session commits reconciled: `d25c908` (GameClient transport contract M1.4.2), `34f0d1b` (HotelRoom/elevator + remove roomCode; added MIN_PLAYERS/MAX_NAME_LENGTH/MAX_MOVE_DT_S constants; constants.spec reworked), `c50fc2c` (Docker dist flatten), `ddfc234` (STATE.md committed as-is incl. my edits), `38e81a4` + `67cbdb9` (post-verify refactors: drop dom shims, fix elevator defects, remove advancePhase bypass, gate round actions to playing). All landed under repo author identity; reconciled and verified below. |
| 2026-08-26 | M1 | VERIFY PASS (verifier, `.dev/reports/M1-verification.md`): V-1…V-15 all PASS, 0 FAIL; V-8 visual glance SKIP-MANUAL (30 s, justified); live two-browser/PUBLIC_URL operator-pending non-blocking. Aggregate `bash scripts/verify-m1.sh` green. **Finding (non-blocking):** V-2 spec/plan selectors `-t "horizontal clamp"` / `-t "position clamp"` match 0 tests (vacuous) — substance verified under real test names (client 24/24, server 7/7); fix wording in M2 spec/plan. |
| 2026-08-26 | M1 | Post-verify refactors re-gated at HEAD `67cbdb9`: `bash scripts/verify-m1.sh` re-run after `38e81a4`+`67cbdb9` — ALL REQUIRED CHECKS PASS, `m1 full round loop: PASS` (Docker single-origin + smoke green). Closing gate `python3 scripts/validate-state.py M1` exit 0. M1 done. |
| 2026-08-26 | M1 | Close-out committed (local): `scripts/verify-m1.sh`, root `verify:m1` forwarder, `.dev/reports/M1-verification.md`, STATE.md done-transition. No push (blast-radius). |

## Log

| When | Milestone | Event |
|------------|-----------|------------------------------------------------|
| 2026-08-26 | — | Pipeline initialized; agents created; nothing built yet |
| 2026-08-26 | M0 | SPEC started → spec-creator spawned |
| 2026-08-26 | M0 | SPEC done → .dev/specs/M0-spec.md accepted (V-1…V-9, no blockers); flagged: deploy account needed before verify |
| 2026-08-26 | M0 | PLAN started → planner spawned |
| 2026-08-26 | M0 | PLAN done → .dev/plans/M0-plan.md accepted (9 tasks, 6 stages, 2 parallel groups; all R-1…R-9 covered) |
| 2026-08-26 | M0 | BUILD started → S1: M0.1.1 spawned |
| 2026-08-26 | M0 | HOTFIX started → S1 scaffold uninstallable (colyseus/schema 0.5.70 gone, tooling workspace missing); Status `building:BUILD → hotfix:HOTFIX` |
| 2026-08-26 | — | Workflow updated → hotfix transition added (`pending ··· hotfixing`) per user request |
| 2026-08-26 | M0 | HOTFIX done → verified `pnpm install && pnpm -r typecheck/build/test` PASS; Status `hotfix:HOTFIX → building:BUILD` (resume S2) |
| 2026-08-26 | M0 | BUILD resumed → S2: M0.2.1 queued (shared package) |
| 2026-08-26 | M0 | BUILD S2 → M0.2.1 spawned (shared constants + schemas) |
| 2026-08-26 | M0 | BUILD S2 done → M0.2.1 PASS (17 tests, shared build green) → S3 PG-A spawned (M0.3.1 ∥ M0.3.2 ∥ M0.3.3) |
| 2026-08-26 | M0 | BUILD S3 done → M0.3.1 PASS + M0.3.2 PASS + M0.3.3 PASS → S4 PG-B spawned (M0.4.1 ∥ M0.4.2) |
| 2026-08-26 | M0 | BUILD S4 done → M0.4.1 PASS + M0.4.2 PASS → S5 spawned (M0.5.1) |
| 2026-08-26 | M0 | BUILD S5 done → M0.5.1 PASS (docker health+overlay green) → S6 spawned (M0.6.1) |
| 2026-08-26 | M0 | BUILD S6 done → M0.6.1 PASS (verify-m0.sh 8/8 stages green; V-1…V-9 automated PASS, 4 SKIP-MANUAL) → BUILD done → VERIFY spawned |
| 2026-08-26 | M0 | VERIFY done → PASS (V-1…V-9 automated PASS, V-8 local mechanics PASS, 4 SKIP-MANUAL) → M0 done |
| 2026-08-26 | M1 | SPEC started → spec-creator spawned |
| 2026-08-26 | M1 | SPEC done → .dev/specs/M1-spec.md accepted (R-1…R-15, V-1…V-15, no blockers) |
| 2026-08-26 | M1 | PLAN started → planner spawned |
| 2026-08-26 | M1 | PLAN done → .dev/plans/M1-plan.md accepted (12 tasks, 7 stages, 4 parallel groups; all R-1…R-15 covered) |
| 2026-08-26 | M1 | BUILD started → S1: M1.1.1 spawned |
| 2026-08-26 | M1 | BUILD S1 done → M1.1.1 PASS → S2 PG-A spawned (M1.2.1 ∥ M1.2.2 ∥ M1.2.3) |
| 2026-08-26 | M1 | BUILD S2 → M1.2.1 PASS + M1.2.2 PASS + M1.2.3 PASS; hotfix: removed redundant `hasReachedMaxClients()` check in HotelRoom.onJoin so 6th client is allowed; cap test + harness 6-client path green |
| 2026-08-26 | M1 | BUILD S3 → M1.3.1 spawned |
| 2026-08-26 | M1 | BUILD S3 done → M1.3.1 PASS (`elevator deterministic` 14/14, typecheck PASS; no literal 3000/2000/2 tuning values) → S4 PG-B queued |
| 2026-08-26 | M1 | BUILD S4 → M1.4.1 PASS (channels 21/21 + typecheck + build green, imports from @grandhotel/shared) + M1.4.2 PASS (client typecheck + 49 tests, no colyseus import in game/ui) → S5 PG-C queued |
| 2026-08-26 | M1 | BUILD S5 → M1.5.1 PASS (23/23 buzzer/attrition/results/visibility/authority, typecheck green) + M1.5.2 PASS (3/3 room-observability/results, typecheck green) → S6 PG-D queued; non-blocking: test teardown emits `onDispose error: Cannot read properties of undefined (reading 'remove')`, flagged for M1.7.1 cleanup |
| 2026-08-26 | M1 | HOTFIX-RECOVER → first M1.6.1 spawn FAILED reporting broken tree (shared unresolvable, client modules missing). Root cause: `git reset --hard HEAD~1` dropped `2683e9f` (M1.4.2+M1.5.2 client) and wiped uncommitted edits. Recovered all from `ec32b33` stash + dangling blobs + `2683e9f`; `pnpm -r typecheck` + `pnpm -r test` green again (server 87, client 51, shared, tooling). Staged M1.6.1 WIP (main.ts/index.html/style.css) preserved for finalization. |
| 2026-08-26 | M1 | BUILD S6 → M1.6.1 PASS (composition root finalized: canvas 960×540, channel bar via CHANNEL_DURATIONS, results freeze; client 51/51 + build green) + M1.6.2 PASS (8 new integration suites, 13 tests; M0 regression green) → S7 queued. M1.6.2 flagged a real server defect: elevator arrival could stall under real clients (clock fires ~1 tick before Date.now) — fixed in b1f5cd9 by re-arming remaining delay; server 87/87 regression green. |
| 2026-08-26 | — | TLC gates installed (Option A): `validate-spec 0 warnings` on M0+M1, `validate-plan` M0 0/0, M1 0/9 (R-21 soft), `validate-state M0` PASS (prose evidence allowed), `check-commit` OK — ready for M1 VERIFY close |
| 2026-08-26 | M1 | BUILD S7 done → M1.7.1 PASS (user-approved review): `scripts/verify-m1.sh` executable (chain: install→typecheck/build→shared/server/client tests→tooling integration→literal sweep→Docker single-origin→smoke:local), root `verify:m1` forwarder wired, Dockerfile dist flatten fix for single-origin static serving, `onDispose` teardown cleanup (listing stub in onCreate + colyseus-compat type). BUILD done → Status `building:BUILD → verifying:VERIFY`; verifier spawned. |
| 2026-08-26 | M1 | VERIFY done → PASS (V-1…V-15, 0 FAIL; V-8 visual glance SKIP-MANUAL; .dev/reports/M1-verification.md written). Post-verify refactors (`38e81a4`,`67cbdb9`) re-gated: `bash scripts/verify-m1.sh` ALL REQUIRED CHECKS PASS at HEAD `67cbdb9`; `validate-state M1` exit 0 → M1 done. |
