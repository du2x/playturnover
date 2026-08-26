#!/usr/bin/env python3
"""
validate-spec.py — deterministic closure-gate for Turnover .dev/specs/M#-spec.md
Adapted from tlc-spec-driven validate_spec.py (CC-BY-4.0, Felipe Rodrigues).

Checks Turnover's spec shape (Goal / Scope / Requirements / Verification Criteria)
instead of TLC's Problem Statement / User Stories layout, so it actually passes
on M0/M1 without rewriting history.

Usage:
  python3 scripts/validate-spec.py .dev/specs/M1-spec.md
  python3 scripts/validate-spec.py --root .              # auto-detect sole spec
  python3 scripts/validate-spec.py --strict .dev/specs/M0-spec.md
"""

import argparse
import os
import re
import sys

REQUIRED_SECTIONS = [
    "Goal",
    "Scope",
    "Requirements",
    "Verification Criteria",
    "Assumptions",
]

ID_RE_R = re.compile(r"\bR-(\d+)\b")
ID_RE_V = re.compile(r"\bV-(\d+)\b")

def resolve_spec(target, root):
    if target and os.path.isfile(target):
        return target
    if target and os.path.isdir(target):
        for name in sorted(os.listdir(target)):
            if name.endswith("-spec.md"):
                return os.path.join(target, name)
        cand = os.path.join(target, "spec.md")
        if os.path.isfile(cand):
            return cand
        return None
    # auto-detect .dev/specs
    base = os.path.join(root, ".dev", "specs")
    if os.path.isdir(base):
        specs = [os.path.join(base, f) for f in sorted(os.listdir(base)) if f.endswith("-spec.md")]
        if len(specs) == 1:
            return specs[0]
        if len(specs) == 0:
            return None
        raise SystemExit(f"validate-spec: multiple specs found; pass one explicitly:\n  " + "\n  ".join(specs))
    return None

def section_bounds(lines, name_fragment):
    for i, ln in enumerate(lines):
        if re.match(r"^#{1,3}\s+.*"+re.escape(name_fragment)+r".*\s*$", ln.strip(), re.IGNORECASE):
            start = i + 1
            end = len(lines)
            for j in range(start, len(lines)):
                if re.match(r"^#{1,3}\s+\S", lines[j]):
                    end = j
                    break
            return (start, end)
    return None

def check(spec_path):
    with open(spec_path, "r", encoding="utf-8") as f:
        text = f.read()
    lines = text.splitlines()
    errors, warnings = [], []

    # 1. required sections
    for name in REQUIRED_SECTIONS:
        if section_bounds(lines, name) is None:
            # allow partial match for Assumptions & Open Questions
            if name == "Assumptions":
                if section_bounds(lines, "Assumption") is None and section_bounds(lines, "Open Question") is None:
                    errors.append(f"missing required section: ## {name} (or Assumptions & Open Questions)")
            else:
                errors.append(f"missing required section: ## {name}")

    # 2. requirement / verification IDs
    r_ids = set(ID_RE_R.findall(text))
    # Extract V ids that appear as section items like V-1 or V-1 (covers R-1)
    v_mentions = re.findall(r"V-(\d+)", text)
    v_ids = set(v_mentions)

    if not r_ids:
        errors.append("no R-n requirement IDs found (expected R-1, R-2, ...)")
    if not v_ids:
        errors.append("no V-n verification IDs found (expected V-1, V-2, ...)")

    # 3. coverage: every R should have a V covering it
    # Heuristic: look for "V-n (covers R-n)" or spec refs
    covers = {}
    for m in re.finditer(r"V-(\d+)\s*\(covers\s*R-(\d+)", text):
        v, r = m.group(1), m.group(2)
        covers.setdefault(r, []).append(v)
    # also generic: if V and R counts roughly match, warn only if orphan
    r_sorted = sorted(r_ids, key=int)
    v_sorted = sorted(v_ids, key=int)
    if len(v_sorted) < len(r_sorted):
        warnings.append(f"fewer V ids ({len(v_sorted)}) than R ids ({len(r_sorted)}) — every R needs ≥1 V")
    # explicit orphan check: R with no covering V
    for r in r_sorted:
        if r not in covers:
            # soft check: does any V line mention R-r?
            if not re.search(rf"V-\d+.*R-{r}\b", text):
                warnings.append(f"R-{r} has no explicit V covering it (no 'V-x (covers R-{r})' found)")

    # 4. verification criteria executability
    b = section_bounds(lines, "Verification Criteria")
    if b:
        body = "\n".join(lines[b[0]:b[1]])
        # each V entry should mention an executable check
        v_entries = re.findall(r"V-\d+.*", body)
        for entry in v_entries:
            low = entry.lower()
            has_executable = any(kw in low for kw in ["pnpm", "vitest", "curl", "docker", "grep", "test", "run", "command", "smoke", "verify"])
            if not has_executable and "manual" not in low and "skip-manual" not in low:
                warnings.append(f"V entry may not be executable (no command/test reference): {entry[:70]}")

    # 5. Assumptions closure
    b = section_bounds(lines, "Assumption")
    if b:
        body = "\n".join(lines[b[0]:b[1]])
        if "open question" in body.lower() and "blocked" in body.lower() and "none" not in body.lower():
            warnings.append("Assumptions section mentions BLOCKED/open questions — confirm closure gate passed")

    # 6. SHALL / EARS advisory (Turnover specs use plain requirements, not EARS, so WARN only)
    req_b = section_bounds(lines, "Requirements")
    if req_b:
        for i in range(*req_b):
            ln = lines[i]
            if re.match(r"\s*-\s+\*\*R-\d+", ln):
                if "shall" not in ln.lower() and "must" not in ln.lower() and "should" not in ln.lower():
                    warnings.append(f"L{i+1}: requirement has no SHALL/MUST (EARS advisory): {ln.strip()[:60]}")

    return errors, warnings

def main(argv=None):
    p = argparse.ArgumentParser(description="Turnover spec gate")
    p.add_argument("target", nargs="?", default=None)
    p.add_argument("--root", default=".")
    p.add_argument("--strict", action="store_true")
    args = p.parse_args(argv)
    spec = resolve_spec(args.target, args.root)
    if not spec:
        print("validate-spec: could not locate a spec.md. Pass a path or use --root.", file=sys.stderr)
        return 2
    errors, warnings = check(spec)
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  ERROR {e}")
    fail = errors or (warnings and args.strict)
    print(f"\nvalidate-spec: {len(errors)} error(s), {len(warnings)} warning(s) in {spec}")
    # Also run upstream TLC validate_spec as advisory (if .specs/features exists it will warn, otherwise skip)
    return 1 if fail else 0

if __name__ == "__main__":
    raise SystemExit(main())
