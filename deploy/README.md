# Deploy — Turnover (Grand Hotel) — M0

Single-container, single-origin deploy: the same Fly.io machine serves the built
Vite client as static files and the Colyseus WebSocket on the same HTTPS origin.

## Public URL

```
PUBLIC_URL=<fill-after-first-deploy>
```

> **Operator:** after the first successful `fly deploy`, replace the placeholder
> above with the real `https://<app>.fly.dev` URL and record it in `STATE.md`
> **Decisions** (required for V-8 live smoke). Do not commit a stale URL.

## Prerequisites

- Fly.io account + `flyctl` installed (`fly auth login`)
- App name `turnover-grandhotel` (configured in `fly.toml`). If the name is taken,
  change `app = "..."` in `fly.toml` to an available name before launching.

## First deploy

From the repo root:

```bash
fly launch --no-deploy
# When prompted:
# - use existing fly.toml? yes
# - copy config? yes
# - region: iad (or nearest; primary_region in fly.toml suggests iad)
# - do not create postgres/redis — not needed in M0

fly deploy
```

`fly launch --no-deploy` creates the app without deploying; `fly deploy`
builds the Dockerfile and releases. The flag `--no-deploy` is intentional so
you can review `fly.toml` before the first build.

## Subsequent deploys

```bash
fly deploy
```

## Verify

Local Docker check (no Fly account needed):

```bash
docker build -t turnover-m0 .
docker run -d --rm -p 18080:8080 --name m0check turnover-m0
sleep 3
curl -fsS http://localhost:18080/healthz | grep -q '"ok":true'
curl -fsS http://localhost:18080/ | grep -q 'id="overlay"'
docker stop m0check
```

Remote smoke against the live URL (after PUBLIC_URL is filled):

```bash
SMOKE_URL=https://<app>.fly.dev pnpm smoke:remote
# or
pnpm --filter @grandhotel/tooling smoke:remote --url https://<app>.fly.dev
```

Two requirements signaled by `fly.toml`:

- `[http_service].internal_port = 8080` — container listens on `PORT=8080`
- `STATIC_DIR=/srv/public` — server mounts `express.static` from that path
- `[[http_service.checks]] path="/healthz"` — Fly health check
- `min_machines_running = 1` — rooms are machine-affine; do not scale to zero
  in M0 or players would be split across machines with no shared state.

## DNS / Custom domain (optional)

Add a custom domain with `fly certs create <hostname>` and point DNS CNAME to
`<app>.fly.dev`. Not required for M0; the `*.fly.dev` URL is the public origin.

## Recording the URL

After first deploy succeeds:

1. Copy the Fly URL (`https://turnover-grandhotel.fly.dev` or renamed variant)
2. Paste it into this file's `PUBLIC_URL=` line above
3. Paste it into `STATE.md` under **Decisions** (e.g., `M0 PUBLIC_URL = https://...`)
4. Commit both files so `pnpm smoke:remote` can run against the live deployment

Operator — not builder — owns steps 1–3. Live V-8 and V-9b cannot run until the
URL is recorded.

## Troubleshooting

- `app name taken` → edit `fly.toml` app field, rerun `fly launch --no-deploy`
- `health check failing` → `fly logs` and `curl https://<app>.fly.dev/healthz`
- `blank page` → verify `STATIC_DIR` env and that `apps/client/dist` was copied to `/srv/public` in the Dockerfile
