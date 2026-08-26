#!/usr/bin/env bash
set -euo pipefail

# M0.6.1 — Final gate verifier
# Chains: install → typecheck/build/test → shared → server → client → integration → docker → smoke
# Prints PASS/FAIL summary mirroring V-1…V-9, manual supplements marked SKIP-MANUAL.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Ensure pnpm is on PATH (npm-global prefix used in this env)
export PATH="/home/du2x/.npm-global/bin:$PATH"
if ! command -v pnpm >/dev/null 2>&1; then
  if [ -x "/home/du2x/.npm-global/bin/pnpm" ]; then
    export PATH="/home/du2x/.npm-global/bin:$PATH"
  fi
fi

# ── helpers ────────────────────────────────────────────────────────────────
GREEN="\033[32m"; RED="\033[31m"; YELLOW="\033[33m"; NC="\033[0m"

pass() { echo -e "${GREEN}PASS${NC}"; }
fail() { echo -e "${RED}FAIL${NC}"; }
warn() { echo -e "${YELLOW}WARN${NC}"; }

# statuses
V1_STATUS="FAIL"
V2_STATUS="FAIL"
V3_STATUS="FAIL"
V4_STATUS="FAIL"
V5_STATUS="FAIL"
V6_STATUS="FAIL"
V7_STATUS="FAIL"
V8_STATUS="FAIL"
V9A_STATUS="FAIL"
# manual supplements always SKIP-MANUAL
V3_MANUAL="SKIP-MANUAL"
V5_MANUAL="SKIP-MANUAL"
V6_MANUAL="SKIP-MANUAL"
V9B_STATUS="SKIP-MANUAL"

OVERALL=0
DOCKER_AVAILABLE=0

step() {
  echo ""
  echo "======================================================================"
  echo ">> $1"
  echo "======================================================================"
}

# trap for background pids
CLEANUP_PIDS=()
CLEANUP_CONTAINERS=()
cleanup() {
  for pid in "${CLEANUP_PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  for c in "${CLEANUP_CONTAINERS[@]:-}"; do
    docker stop "$c" >/dev/null 2>&1 || true
    docker rm "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# ── (1) pnpm install --frozen-lockfile (fresh-clone stand-in) ─────────────
step "(1) pnpm install --frozen-lockfile"
if pnpm install --frozen-lockfile; then
  echo "[1] pnpm install: $(pass)"
else
  echo "[1] pnpm install: $(fail)"
  OVERALL=1
fi

# ── (2) pnpm -r typecheck && pnpm -r build && pnpm -r test (V-1) ─────────
step "(2) V-1: pnpm -r typecheck && pnpm -r build && pnpm -r test"

V1_TYPECHECK="FAIL"
V1_BUILD="FAIL"
V1_TEST="FAIL"

if pnpm -r typecheck; then
  V1_TYPECHECK="PASS"
  echo "[2a] typecheck: $(pass)"
else
  echo "[2a] typecheck: $(fail)"
  OVERALL=1
fi

if pnpm -r build; then
  V1_BUILD="PASS"
  echo "[2b] build: $(pass)"
else
  echo "[2b] build: $(fail)"
  OVERALL=1
fi

if pnpm -r test; then
  V1_TEST="PASS"
  echo "[2c] test (all workspaces): $(pass)"
else
  echo "[2c] test (all workspaces): $(fail)"
  OVERALL=1
fi

if [ "$V1_TYPECHECK" = "PASS" ] && [ "$V1_BUILD" = "PASS" ] && [ "$V1_TEST" = "PASS" ]; then
  V1_STATUS="PASS"
else
  V1_STATUS="FAIL"
  OVERALL=1
fi

# Also verify workspaces exist (R-1)
if [ -d "apps/client" ] && [ -d "apps/server" ] && [ -d "packages/shared" ] && [ -d "tooling" ]; then
  echo "[2d] workspaces apps/client, apps/server, packages/shared, tooling exist: $(pass)"
else
  echo "[2d] workspaces missing: $(fail)"
  V1_STATUS="FAIL"
  OVERALL=1
fi

# ── (3) shared constants filter (V-2) ─────────────────────────────────────
step "(3) V-2: shared constants (MAX_PLAYERS=6 etc.)"

V2_GREP="FAIL"
V2_TEST="FAIL"

if grep -q "MAX_PLAYERS = 6" packages/shared/src/constants.ts; then
  V2_GREP="PASS"
  echo "[3a] grep MAX_PLAYERS = 6 in packages/shared/src/constants.ts: $(pass)"
else
  echo "[3a] grep MAX_PLAYERS = 6: $(fail)"
  OVERALL=1
fi

# Extra: ensure server imports MAX_PLAYERS from shared, no literal 6 cap
if grep -q "MAX_PLAYERS" apps/server/src/rooms/HotelRoom.ts && grep -q "from.*@grandhotel/shared" apps/server/src/rooms/HotelRoom.ts; then
  echo "[3b] server imports MAX_PLAYERS from @grandhotel/shared: $(pass)"
else
  echo "[3b] server MAX_PLAYERS import: $(fail)"
  V2_GREP="FAIL"
  OVERALL=1
fi

if grep -rn "maxClients.*6" apps/server/src/ 2>/dev/null | grep -q .; then
  echo "[3c] stray literal maxClients.*6 found: $(fail)"
  grep -rn "maxClients.*6" apps/server/src/ || true
  V2_GREP="FAIL"
  OVERALL=1
else
  echo "[3c] no stray maxClients.*6 literal: $(pass)"
fi

if pnpm --filter @grandhotel/shared test; then
  V2_TEST="PASS"
  echo "[3d] pnpm --filter @grandhotel/shared test: $(pass)"
else
  echo "[3d] pnpm --filter @grandhotel/shared test: $(fail)"
  OVERALL=1
fi

if [ "$V2_GREP" = "PASS" ] && [ "$V2_TEST" = "PASS" ]; then
  V2_STATUS="PASS"
else
  V2_STATUS="FAIL"
fi

# ── (4) server suite (V-4, V-7) ──────────────────────────────────────────
step "(4) V-4 + V-7: server suite (cap + lifecycle)"

if pnpm --filter @grandhotel/server test; then
  echo "[4] pnpm --filter @grandhotel/server test: $(pass)"
  V4_STATUS="PASS"
  V7_STATUS="PASS"
else
  echo "[4] pnpm --filter @grandhotel/server test: $(fail)"
  V4_STATUS="FAIL"
  V7_STATUS="FAIL"
  OVERALL=1
fi

# ── (5) client suite (V-5) ────────────────────────────────────────────────
step "(5) V-5: client suite (movement/clamp/pass-through)"

if pnpm --filter @grandhotel/client test; then
  echo "[5] pnpm --filter @grandhotel/client test: $(pass)"
  V5_STATUS="PASS"
else
  echo "[5] pnpm --filter @grandhotel/client test: $(fail)"
  V5_STATUS="FAIL"
  OVERALL=1
fi

# ── (6) tooling integration suite — test:integration (V-3, V-6, V-9a) ─────
step "(6) V-3, V-6, V-9a: tooling integration (lobby, sync, exit-criterion)"

if pnpm --filter @grandhotel/tooling test:integration; then
  echo "[6] pnpm --filter @grandhotel/tooling test:integration: $(pass)"
  V3_STATUS="PASS"
  V6_STATUS="PASS"
  V9A_STATUS="PASS"
else
  echo "[6] pnpm --filter @grandhotel/tooling test:integration: $(fail)"
  V3_STATUS="FAIL"
  V6_STATUS="FAIL"
  V9A_STATUS="FAIL"
  OVERALL=1
fi

# ── (7) Docker image build+run+/healthz+GET / probe (V-8 mechanics) ───────
step "(7) V-8: Docker build+run probe (same-origin)"

# Check docker available
if docker info >/dev/null 2>&1; then
  DOCKER_AVAILABLE=1
  echo "[7] Docker daemon available: $(pass)"
else
  DOCKER_AVAILABLE=0
  echo -e "${YELLOW}[7] Docker daemon NOT available — will use local fallback with loud warning${NC}"
fi

if [ "$DOCKER_AVAILABLE" -eq 1 ]; then
  IMAGE_TAG="turnover-m0:verify"
  CONTAINER_NAME="m0-verify-$$"
  DOCKER_PORT=18080

  # Find free port if 18080 taken
  if command -v python3 >/dev/null 2>&1; then
    FREE_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1])" 2>/dev/null || echo "18080")
    # Prefer 18080 if free, else use free port
    if ss -tuln 2>/dev/null | grep -q ":${DOCKER_PORT} " || netstat -tuln 2>/dev/null | grep -q ":${DOCKER_PORT} "; then
      DOCKER_PORT="$FREE_PORT"
    fi
  fi

  echo "[7a] docker build -t $IMAGE_TAG ."
  DOCKER_BUILD_OK=0
  if docker build -t "$IMAGE_TAG" .; then
    echo "[7a] docker build: $(pass)"
    DOCKER_BUILD_OK=1
  else
    echo "[7a] docker build: $(fail)"
    V8_STATUS="FAIL"
    OVERALL=1
  fi

  if [ "$DOCKER_BUILD_OK" -eq 1 ]; then
    echo "[7b] docker run -d -p ${DOCKER_PORT}:8080 --name $CONTAINER_NAME $IMAGE_TAG"
    # ensure stale container removed
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    if docker run -d --rm -p "${DOCKER_PORT}:8080" --name "$CONTAINER_NAME" "$IMAGE_TAG" >/dev/null; then
      CLEANUP_CONTAINERS+=("$CONTAINER_NAME")
      echo "[7b] docker run: $(pass)"
      # wait for healthz
      echo "[7c] waiting for /healthz on http://localhost:${DOCKER_PORT}/healthz"
      HEALTH_OK=0
      for i in $(seq 1 30); do
        if curl -fsS "http://localhost:${DOCKER_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then
          HEALTH_OK=1
          break
        fi
        sleep 0.5
      done
      if [ "$HEALTH_OK" -eq 1 ]; then
        echo "[7c] /healthz: $(pass)"
      else
        echo "[7c] /healthz: $(fail)"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -n 50 || true
        V8_STATUS="FAIL"
        OVERALL=1
      fi

      # GET / probe
      if [ "$HEALTH_OK" -eq 1 ]; then
        echo "[7d] GET / probe for id=\"overlay\""
        if curl -fsS "http://localhost:${DOCKER_PORT}/" 2>/dev/null | grep -q 'id="overlay"'; then
          echo "[7d] GET / overlay marker: $(pass)"
          V8_STATUS="PASS"
        else
          echo "[7d] GET / overlay marker: $(fail)"
          curl -fsS "http://localhost:${DOCKER_PORT}/" 2>/dev/null | head -c 500 || true
          echo ""
          V8_STATUS="FAIL"
          OVERALL=1
        fi
      else
        V8_STATUS="FAIL"
        OVERALL=1
      fi

      # teardown container
      docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
      # remove from cleanup (already stopped)
      CLEANUP_CONTAINERS=()
    else
      echo "[7b] docker run: $(fail)"
      V8_STATUS="FAIL"
      OVERALL=1
    fi
  fi
else
  # Loud warning + local fallback
  echo -e "${YELLOW}======================================================================${NC}"
  echo -e "${YELLOW}WARNING: Docker not available — V-8 Docker mechanics SKIPPED${NC}"
  echo -e "${YELLOW}Running local fallback: STATIC_DIR=apps/client/dist PORT=scratch node apps/server/dist/index.js${NC}"
  echo -e "${YELLOW}======================================================================${NC}"

  FALLBACK_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1])" 2>/dev/null || echo "18090")
  # Ensure build exists
  if [ ! -f "apps/server/dist/index.js" ]; then
    echo "[7] fallback: building server first"
    pnpm --filter @grandhotel/server build
  fi
  if [ ! -d "apps/client/dist" ]; then
    pnpm --filter @grandhotel/client build
  fi

  echo "[7-fallback] booting server on port $FALLBACK_PORT with STATIC_DIR=apps/client/dist"
  STATIC_DIR="$ROOT_DIR/apps/client/dist" PORT="$FALLBACK_PORT" node apps/server/dist/index.js >/tmp/m0-fallback-docker.log 2>&1 &
  FALLBACK_PID=$!
  CLEANUP_PIDS+=("$FALLBACK_PID")

  HEALTH_OK=0
  for i in $(seq 1 30); do
    if curl -fsS "http://localhost:${FALLBACK_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then
      HEALTH_OK=1
      break
    fi
    sleep 0.5
  done
  if [ "$HEALTH_OK" -eq 1 ]; then
    echo "[7c-fallback] /healthz: $(pass)"
  else
    echo "[7c-fallback] /healthz: $(fail)"
    cat /tmp/m0-fallback-docker.log 2>/dev/null | tail -n 50 || true
    V8_STATUS="FAIL"
    OVERALL=1
  fi

  if [ "$HEALTH_OK" -eq 1 ]; then
    if curl -fsS "http://localhost:${FALLBACK_PORT}/" 2>/dev/null | grep -q 'id="overlay"'; then
      echo "[7d-fallback] GET / overlay marker: $(pass)"
      V8_STATUS="PASS-LOCAL-FALLBACK"
    else
      echo "[7d-fallback] GET / overlay marker: $(fail)"
      V8_STATUS="FAIL"
      OVERALL=1
    fi
  fi

  # kill fallback
  if kill -0 "$FALLBACK_PID" 2>/dev/null; then
    kill "$FALLBACK_PID" 2>/dev/null || true
    wait "$FALLBACK_PID" 2>/dev/null || true
  fi
  # remove from cleanup
  CLEANUP_PIDS=()
fi

# Ensure V8 is set
if [ "$V8_STATUS" = "FAIL" ]; then
  OVERALL=1
fi

# ── (8) smoke:local pointed at freshly booted built server ───────────────
step "(8) V-8/V-9 smoke:local against freshly booted built server (STATIC_DIR, scratch port)"

SMOKE_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1])" 2>/dev/null || echo "18091")
echo "[8a] booting built server: STATIC_DIR=apps/client/dist PORT=$SMOKE_PORT node apps/server/dist/index.js"

# Ensure dist exists
if [ ! -f "apps/server/dist/index.js" ]; then
  echo "[8] building server..."
  pnpm --filter @grandhotel/server build
fi
if [ ! -d "apps/client/dist" ]; then
  echo "[8] building client..."
  pnpm --filter @grandhotel/client build
fi

STATIC_DIR="$ROOT_DIR/apps/client/dist" PORT="$SMOKE_PORT" node apps/server/dist/index.js >/tmp/m0-smoke-server.log 2>&1 &
SMOKE_PID=$!
CLEANUP_PIDS+=("$SMOKE_PID")
echo "[8a] server pid $SMOKE_PID"

# wait for /healthz
SMOKE_HEALTH=0
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${SMOKE_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then
    SMOKE_HEALTH=1
    break
  fi
  sleep 0.4
done

if [ "$SMOKE_HEALTH" -eq 1 ]; then
  echo "[8b] smoke server /healthz: $(pass)"
else
  echo "[8b] smoke server /healthz: $(fail)"
  cat /tmp/m0-smoke-server.log 2>/dev/null | tail -n 80 || true
  OVERALL=1
fi

SMOKE_RESULT="FAIL"
if [ "$SMOKE_HEALTH" -eq 1 ]; then
  echo "[8c] running smoke handshake: pnpm --filter @grandhotel/tooling exec tsx src/smoke.ts --url http://localhost:${SMOKE_PORT}"
  # Use tooling's smoke via tsx directly to avoid pnpm's smoke:local default port confusion
  if pnpm --filter @grandhotel/tooling exec tsx src/smoke.ts --url "http://localhost:${SMOKE_PORT}"; then
    echo "[8c] smoke handshake+position exchange: $(pass)"
    SMOKE_RESULT="PASS"
  else
    echo "[8c] smoke handshake+position exchange: $(fail)"
    cat /tmp/m0-smoke-server.log 2>/dev/null | tail -n 80 || true
    SMOKE_RESULT="FAIL"
    OVERALL=1
  fi
else
  SMOKE_RESULT="FAIL"
  OVERALL=1
fi

# ensure V9A reflects smoke as well (if smoke fails, V9a should be fail)
if [ "$SMOKE_RESULT" != "PASS" ]; then
  # Don't override V9A if integration already failed, but mark overall
  if [ "$V9A_STATUS" = "PASS" ]; then
    echo "[8] smoke failed but integration passed — marking V-9a as FAIL"
    V9A_STATUS="FAIL"
  fi
fi

# tear down smoke server
if kill -0 "$SMOKE_PID" 2>/dev/null; then
  kill "$SMOKE_PID" 2>/dev/null || true
  wait "$SMOKE_PID" 2>/dev/null || true
fi
# remove from cleanup
CLEANUP_PIDS=()

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "======================================================================"
echo " M0 verify summary (V-1…V-9, R-1…R-9)"
echo "======================================================================"

# Determine overall textual
if [ "$OVERALL" -eq 0 ]; then
  OVERALL_TXT="${GREEN}ALL REQUIRED CHECKS PASS${NC}"
else
  OVERALL_TXT="${RED}SOME CHECKS FAILED${NC}"
fi

printf "V-1 (R-1 install/typecheck/build/test)        : %s\n" "$V1_STATUS"
printf "V-2 (R-2 shared constants)                    : %s\n" "$V2_STATUS"
printf "V-3 (R-3 lobby integration)                   : %s  (%s: V-3 screen glance ~30s visual)\n" "$V3_STATUS" "$V3_MANUAL"
printf "V-4 (R-4 cap enforcement, 6→7 reject)         : %s\n" "$V4_STATUS"
printf "V-5 (R-5 movement/clamp/pass-through)         : %s  (%s: V-5 overlap visual, two browsers at same x)\n" "$V5_STATUS" "$V5_MANUAL"
printf "V-6 (R-6 sync ≥8Hz, clamp, interp)            : %s  (%s: V-6 smoothness, remote dot not teleport-y)\n" "$V6_STATUS" "$V6_MANUAL"
printf "V-7 (R-7 lifecycle waiting→playing→results)   : %s\n" "$V7_STATUS"
printf "V-8 (R-8 same-origin Docker + GET / + WSS)    : %s\n" "$V8_STATUS"
printf "V-9a (R-9 automated exit ≤250ms monotonic)    : %s\n" "$V9A_STATUS"
printf "V-9b (R-9 manual two-browser observation)     : %s  (two browsers/devices on public URL see each other move)\n" "$V9B_STATUS"
echo "----------------------------------------------------------------------"
# explicit manual supplement markers
echo "Manual supplements (justified per spec):"
echo "  V-3 screen glance      : $V3_MANUAL"
echo "  V-5 overlap visual     : $V5_MANUAL"
echo "  V-6 smoothness         : $V6_MANUAL"
echo "  V-9b two-browser       : $V9B_STATUS  (requires operator-provisioned PUBLIC_URL + two browsers)"
echo "----------------------------------------------------------------------"
echo -e "Overall: $OVERALL_TXT"

# Human-readable check for gate criteria: V-1..V-7 and V-9a PASS, V-8 PASS or PASS-LOCAL-FALLBACK
GATE_OK=1
for v in "$V1_STATUS" "$V2_STATUS" "$V3_STATUS" "$V4_STATUS" "$V5_STATUS" "$V6_STATUS" "$V7_STATUS" "$V9A_STATUS"; do
  if [ "$v" != "PASS" ]; then
    GATE_OK=0
  fi
done
if [ "$V8_STATUS" != "PASS" ] && [ "$V8_STATUS" != "PASS-LOCAL-FALLBACK" ]; then
  GATE_OK=0
fi

if [ "$GATE_OK" -eq 1 ]; then
  echo -e "${GREEN}Gate: M0 verification-ready (pending operator deploy for live V-8/V-9b)${NC}"
  echo "V-8 local mechanics and V-9a automated core pass; live PUBLIC_URL checks remain operator step."
  exit 0
else
  echo -e "${RED}Gate: NOT ready — fix required checks above${NC}"
  exit 1
fi
