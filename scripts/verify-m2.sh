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

step "shared M2 contracts"
pnpm --filter @grandhotel/shared test -- -t "tuning constants m2"

step "server M2 evidence and M1 regression"
pnpm --filter @grandhotel/server test

step "client M2 evidence and M1 regression"
pnpm --filter @grandhotel/client test

step "tooling integration regression"
pnpm --filter @grandhotel/tooling test:integration

step "M2 real-client evidence integration"
pnpm --filter @grandhotel/tooling test:integration -- -t "m2"

step "client transport boundary"
if grep -R "from ['\"]colyseus" apps/client/src/game apps/client/src/ui >/dev/null 2>&1; then
  echo "colyseus import leaked into client game/ui" >&2
  exit 1
fi

step "M2 tuning literal audit"
if grep -RnE --include="*.ts" '\b(75000|75_000)\b' apps/server/src apps/client/src >/dev/null 2>&1; then
  echo "freshness tuning literal found outside shared" >&2
  exit 1
fi

printf '\nM2 evidence layer: PASS\n'
