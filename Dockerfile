# syntax=docker/dockerfile:1
# Multi-stage build for single-origin deploy (server + static client)
# Spec: R-8, V-8 — same origin serves built client over HTTP and WSS

# ── stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY tooling/package.json tooling/package.json
RUN pnpm fetch

# ── stage 2: build ───────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm install --offline
RUN pnpm --filter @grandhotel/shared build
RUN pnpm --filter @grandhotel/server build
RUN pnpm --filter @grandhotel/client build

# ── stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_DIR=/srv/public
ENV PORT=8080

# Copy workspace manifests for pnpm context (needed for pruned prod install)
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/server ./apps/server
COPY --from=builder /app/apps/client/dist /srv/public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules

# Ensure CMD path exists: tsc with rootDir "." emits to dist/src/, but spec
# expects apps/server/dist/index.js. Create a compatibility copy/symlink.
RUN if [ ! -f apps/server/dist/index.js ] && [ -f apps/server/dist/src/index.js ]; then \
      cp apps/server/dist/src/index.js apps/server/dist/index.js && \
      cp apps/server/dist/src/index.js.map apps/server/dist/index.js.map 2>/dev/null || true && \
      cp apps/server/dist/src/colyseus-compat.js apps/server/dist/colyseus-compat.js 2>/dev/null || true && \
      cp apps/server/dist/src/static.js apps/server/dist/static.js 2>/dev/null || true && \
      mkdir -p apps/server/dist/rooms && cp -r apps/server/dist/src/rooms/* apps/server/dist/rooms/ 2>/dev/null || true; \
    fi

# Prune dev dependencies (keep prod). Ignore failure if pnpm prune not needed.
RUN pnpm prune --prod 2>/dev/null || true

EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
