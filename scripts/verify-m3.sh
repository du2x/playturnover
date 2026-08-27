#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

pnpm() { corepack pnpm "$@"; }

step() {
  printf '\n==> %s\n' "$1"
}

step "typecheck and build"
pnpm -r typecheck
pnpm -r build

step "shared M3 contracts"
pnpm --filter @grandhotel/shared test -- -t "tuning constants m3"

step "server justice/spectator/recap tests & M1/M2 regression"
pnpm --filter @grandhotel/server test

step "client accusation/spectator/recap tests & M1/M2 regression"
pnpm --filter @grandhotel/client test

step "tooling integration regression"
pnpm --filter @grandhotel/tooling test:integration

step "M3 real-client justice and recap integration"
pnpm --filter @grandhotel/tooling test:integration -- -t "m3"

step "client transport boundary"
if grep -R "from ['\"]colyseus" apps/client/src/game apps/client/src/ui >/dev/null 2>&1; then
  echo "colyseus import leaked into client game/ui" >&2
  exit 1
fi

step "M3 tuning literal audit"
if grep -RnE --include="*.ts" '\b(75000|75_000)\b' apps/server/src apps/client/src >/dev/null 2>&1; then
  echo "freshness tuning literal found outside shared" >&2
  exit 1
fi
if grep -RnE --include="*.ts" '(Math\.abs\([^)]*\)\s*(<=?|>=?|>|<)\s*64\b)' apps/server/src apps/client/src >/dev/null 2>&1; then
  echo "hardcoded accusation range literal found outside shared" >&2
  exit 1
fi

step "previous milestone regressions"
pnpm --filter @grandhotel/shared test -- -t "tuning constants m2"
pnpm --filter @grandhotel/tooling test:integration -- -t "m2"

printf '\nM3 justice + recap: PASS\n'
