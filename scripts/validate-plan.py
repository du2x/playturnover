#!/usr/bin/env python3
"""
validate-plan.py — deterministic pre-approval checks for Turnover .dev/plans/M#-plan.md
Adapted from tlc-spec-driven validate_tasks.py (CC-BY-4.0).

Usage:
  python3 scripts/validate-plan.py .dev/plans/M1-plan.md
  python3 scripts/validate-plan.py --spec .dev/specs/M1-spec.md .dev/plans/M1-plan.md
"""

import argparse
import os
import re
import sys

TASK_RE = re.compile(r"^#{2,4}\s+M(\d+)\.(\d+)\.(\d+)\s*[—-]\s*(.+)", re.IGNORECASE)
TASK_ID_RE = re.compile(r"M\d+\.\d+\.\d+")
SPEC_REF_RE = re.compile(r"[RV]-\d+", re.IGNORECASE)

def resolve_plan(target, root):
    if target and os.path.isfile(target):
        return target
    base = os.path.join(root, ".dev", "plans")
    if os.path.isdir(base):
        plans = [os.path.join(base, f) for f in sorted(os.listdir(base)) if f.endswith("-plan.md")]
        if len(plans) == 1:
            return plans[0]
        if target is None and len(plans) > 1:
            raise SystemExit(f"validate-plan: multiple plans found; pass one explicitly:\n  " + "\n  ".join(plans))
    return None

def parse_plan(path):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    text = "\n".join(lines)
    tasks = {}
    current = None
    for idx, ln in enumerate(lines):
        m = TASK_RE.match(ln.strip())
        if m:
            tid = f"M{m.group(1)}.{m.group(2)}.{m.group(3)}"
            tasks[tid] = {"line": idx+1, "stage": int(m.group(2)), "title": m.group(4), "depends": set(), "spec_refs": set(), "verify": None, "files": "", "raw": []}
            current = tid
            continue
        if current is None:
            continue
        # capture fields
        if re.match(r"^\s*-\s*Stage\s*:", ln, re.IGNORECASE):
            try:
                tasks[current]["stage"] = int(re.search(r"S(\d+)", ln).group(1))
            except: pass
        dm = re.match(r"^\s*-\s*Depends on\s*:\s*(.*)", ln, re.IGNORECASE)
        if dm:
            body = dm.group(1)
            if "none" not in body.lower() and body.strip() not in ("[]", "-"):
                for tid2 in TASK_ID_RE.findall(body):
                    tasks[current]["depends"].add(tid2)
        sm = re.match(r"^\s*-\s*Spec refs\s*:\s*(.*)", ln, re.IGNORECASE)
        if sm:
            for ref in SPEC_REF_RE.findall(sm.group(1)):
                tasks[current]["spec_refs"].add(ref.upper())
        vm = re.match(r"^\s*-\s*Verify\s*:\s*(.*)", ln, re.IGNORECASE)
        if vm:
            tasks[current]["verify"] = vm.group(1).strip()
        fm = re.match(r"^\s*-\s*Files owned\s*:\s*(.*)", ln, re.IGNORECASE)
        if fm:
            tasks[current]["files"] = fm.group(1).strip()
        tasks[current]["raw"].append(ln)
    return tasks, text, lines

def check(plan_path, spec_path=None):
    tasks, text, lines = parse_plan(plan_path)
    errors, warnings = [], []

    if not tasks:
        return (["no tasks parsed (expected ### M#.#.# — title)"], warnings)

    # required sections
    if "## Task graph" not in text and "## Tasks" not in text:
        warnings.append("no '## Task graph' or '## Tasks' heading found")

    # per-task field presence
    for tid, t in tasks.items():
        if not t["verify"]:
            errors.append(f"{tid}: missing `Verify:` field (every task needs a gate)")
        elif t["verify"].lower() in ("tbd", "todo", "none"):
            errors.append(f"{tid}: Verify is placeholder '{t['verify']}'")
        if not t["spec_refs"]:
            warnings.append(f"{tid}: no Spec refs (expected R-x, V-y)")
        if t["files"] and len(re.findall(r"[\w./-]+\.\w{1,6}", t["files"])) > 4:
            warnings.append(f"{tid}: Files owned lists many paths — granularity smell (split?)")

    # stage ordering + forward dependency
    for tid, t in tasks.items():
        for dep in t["depends"]:
            if dep not in tasks:
                warnings.append(f"{tid} depends on {dep} which is not in this plan (cross-milestone or typo)")
                continue
            if tasks[dep]["stage"] > t["stage"]:
                errors.append(f"{tid} (S{t['stage']}) depends on {dep} (S{tasks[dep]['stage']}) — dependencies must point backward")

    # circular (simple DFS)
    visited = {}
    def dfs(n, stack):
        if n in stack:
            return True
        if visited.get(n): return False
        visited[n]=True
        stack.add(n)
        for d in tasks.get(n, {}).get("depends", []):
            if d in tasks and dfs(d, stack): return True
        stack.remove(n)
        return False
    for tid in tasks:
        if dfs(tid, set()):
            errors.append(f"circular dependency involving {tid}")
            break

    # spec coverage check if spec provided
    if spec_path and os.path.isfile(spec_path):
        with open(spec_path, encoding="utf-8") as f:
            spec_text = f.read()
            # Only consider requirement IDs in the Requirements section to avoid FR-x noise in Scope/Out paragraphs
        req_bounds = re.search(r"## Requirements(.*?)(## |\\Z)", spec_text, re.S | re.I)
        ver_bounds = re.search(r"## Verification Criteria(.*?)(## |\\Z)", spec_text, re.S | re.I)
        r_ids = set(m.upper() for m in re.findall(r"R-\d+", req_bounds.group(1) if req_bounds else spec_text))
        v_ids = set(m.upper() for m in re.findall(r"V-\d+", ver_bounds.group(1) if ver_bounds else spec_text))
        covered = set()
        for t in tasks.values():
            covered |= t["spec_refs"]
        for r in sorted(r_ids):
            if r not in covered:
                warnings.append(f"{r} from spec has no covering task (Spec refs)")
        for v in sorted(v_ids):
            if v not in covered:
                warnings.append(f"{v} from spec has no covering task")

    # parallel-group file disjoint (approx: if same stage and no dep between them, check Files owned overlap)
    stages = {}
    for tid, t in tasks.items():
        stages.setdefault(t["stage"], []).append(tid)
    for s, tids in stages.items():
        for i in range(len(tids)):
            for j in range(i+1, len(tids)):
                a, b = tids[i], tids[j]
                if b in tasks[a]["depends"] or a in tasks[b]["depends"]:
                    continue  # not parallel
                fa, fb = tasks[a]["files"], tasks[b]["files"]
                if fa and fb:
                    toks_a = set(re.findall(r"[\w./-]+", fa.lower()))
                    toks_b = set(re.findall(r"[\w./-]+", fb.lower()))
                    inter = toks_a & toks_b - {"a", "and", "or", "the", "src", "apps", "client", "server"}
                    # crude: if they share a non-trivial path token like shared, tooling, etc.
                    if len(inter) > 2:
                        warnings.append(f"S{s} parallel {a} ∥ {b} may touch overlapping files: {inter}")

    return errors, warnings

def main(argv=None):
    p = argparse.ArgumentParser(description="Turnover plan gate")
    p.add_argument("target", nargs="?", default=None, help="plan.md path")
    p.add_argument("--spec", default=None, help="spec.md path for coverage check")
    p.add_argument("--root", default=".")
    p.add_argument("--strict", action="store_true")
    args = p.parse_args(argv)
    plan = resolve_plan(args.target, args.root)
    if not plan:
        print("validate-plan: could not locate a plan.md. Pass a path.", file=sys.stderr)
        return 2
    spec = args.spec
    if not spec:
        # infer spec from plan name M1-plan.md -> M1-spec.md
        m = re.search(r"(M\d+)-plan\.md", plan)
        if m:
            cand = os.path.join(os.path.dirname(os.path.dirname(plan)), "specs", f"{m.group(1)}-spec.md")
            if os.path.isfile(cand):
                spec = cand
    errors, warnings = check(plan, spec)
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  ERROR {e}")
    fail = errors or (warnings and args.strict)
    print(f"\nvalidate-plan: {len(errors)} error(s), {len(warnings)} warning(s) in {plan}" + (f" (spec {spec})" if spec else ""))
    return 1 if fail else 0

if __name__ == "__main__":
    raise SystemExit(main())
