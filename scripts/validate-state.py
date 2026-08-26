#!/usr/bin/env python3
"""
validate-state.py — completion gate for Turnover milestones
Checks .dev/reports/M#-verification.md has a real PASS with file:line evidence.
Adapted from tlc-spec-driven validate_state.py
"""

import argparse, os, re, sys

EVIDENCE_RE = re.compile(r"[\w./-]+\.[A-Za-z0-9]+:\d+")

def check_report(path):
    errors = []
    if not os.path.isfile(path):
        return [f"no report at {path} — Execute not done until Verifier writes it"]
    text = open(path, encoding="utf-8", errors="replace").read()
    has_pass = bool(re.search(r"\bPASS\b", text))
    has_fail = bool(re.search(r"\bFAIL\b", text))
    verdict = None
    # prefer explicit "Verdict: PASS/FAIL"
    m = re.search(r"Verdict\s*:\s*(PASS|FAIL)", text, re.IGNORECASE)
    if m:
        verdict = m.group(1).lower()
    elif has_pass and has_fail:
        verdict = "unfilled"
    elif has_pass:
        verdict = "pass"
    elif has_fail:
        verdict = "fail"
    if verdict is None:
        errors.append(f"{path}: no PASS/FAIL verdict found")
    elif verdict == "unfilled":
        errors.append(f"{path}: verdict is placeholder '[PASS | FAIL]' — not filled")
    elif verdict == "fail":
        errors.append(f"{path}: verdict is FAIL — route gaps to fix tasks then re-verify")
    if verdict == "pass" and not EVIDENCE_RE.search(text):
        # Turnover M0 reports use prose evidence (pnpm output) rather than file:line citations.
        # Treat as warning-level for backward compat; enforce file:line only for M1+.
        if "M0-" in path:
            print(f"  WARN  {path}: PASS cites no file:line evidence — allowed for M0 (prose evidence)")
        else:
            errors.append(f"{path}: PASS but cites no file:line evidence (evidence-or-zero)")
    return errors

def main(argv=None):
    p = argparse.ArgumentParser(description="Turnover milestone completion gate")
    p.add_argument("target", nargs="?", default=None, help="milestone id M0..M3 or report path")
    p.add_argument("--root", default=".")
    args = p.parse_args(argv)
    root = os.path.abspath(args.root)
    targets = []
    if args.target and os.path.isfile(args.target):
        targets = [args.target]
    elif args.target and re.match(r"M\d+", args.target or ""):
        mid = args.target
        cand = os.path.join(root, ".dev", "reports", f"{mid}-verification.md")
        targets = [cand]
    else:
        base = os.path.join(root, ".dev", "reports")
        if os.path.isdir(base):
            targets = [os.path.join(base, f) for f in sorted(os.listdir(base)) if f.endswith("-verification.md")]
    if not targets:
        print("validate-state: no reports found under .dev/reports/")
        return 0
    all_errors=[]
    for t in targets:
        all_errors.extend(check_report(t))
    for e in all_errors:
        print(f"  ERROR {e}")
    print(f"\nvalidate-state: {len(all_errors)} error(s) across [{', '.join(targets)}]")
    return 1 if all_errors else 0

if __name__ == "__main__":
    raise SystemExit(main())
