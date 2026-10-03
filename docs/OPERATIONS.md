# Deployment and operations

## Configuration

Copy `.env.example` to `.env`; this file is ignored by Git and excluded from Docker build context. Keys belong on the API host, never in `VITE_` variables. `VITE_API_URL` is the public backend origin embedded in the extension manifest/client. Rebuild the extension after changing it.

| Variable                                   | Purpose                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV` / `PORT`                        | Development/test/production; API port defaults to 3001                                                                                            |
| `DATABASE_URL` / `REDIS_URL`               | PostgreSQL and Redis credentials/endpoints                                                                                                        |
| `ALLOWED_ORIGINS`                          | Comma-separated web-preview origins; use only your actual origins                                                                                 |
| `EXTENSION_IDS`                            | Comma-separated 32-letter Chrome IDs; mandatory in production                                                                                     |
| `ETHERSCAN_API_KEY`                        | Source/deployment lookup key                                                                                                                      |
| `COINGECKO_API_KEY` / `COINGECKO_API_TIER` | Demo or Pro key/origin; Pro requires a key                                                                                                        |
| `GOPLUS_ACCESS_TOKEN` / `HONEYPOT_API_KEY` | Optional provider credentials                                                                                                                     |
| `HONEYPOT_PRODUCTION_PERMISSION`           | Defaults false. Enable only after provider permission for this product is cleared. Otherwise production returns `not_configured` for this source. |
| `ETHEREUM_RPC_URL` / `BASE_RPC_URL`        | Reliable RPC nodes on the exact selected chains                                                                                                   |
| `PROVIDER_TIMEOUT_MS`                      | Per-request timeout, default 12000                                                                                                                |
| `SCAN_CACHE_SECONDS`                       | Cache freshness, default 60                                                                                                                       |
| `MONITOR_INTERVAL_SECONDS`                 | Due-watch scheduler cadence, default 300; actual check can be later than the watch's due time by this cadence/load                                |
| `RPC_LOG_LOOKBACK` / `RPC_LOG_CHUNK`       | Bounded indexing, default 500 blocks / 500-block queries                                                                                          |
| `VITE_API_URL`                             | HTTPS backend for distribution, localhost allowed for local builds                                                                                |

Do not reuse the development PostgreSQL password for production. The Compose PostgreSQL volume retains the password set when first initialized; changing the environment alone does not rotate an existing role's password. Rotate it explicitly with your database administration workflow.

## Container deployment

The multi-stage Dockerfile builds shared/API code and runs the API as the unprivileged `node` user. The Compose production profile uses private internal database/cache endpoints and binds the API to loopback. Set provider keys, extension IDs, and a unique `POSTGRES_PASSWORD` in `.env` before production use.

```powershell
docker compose --profile production up -d --build
docker compose logs --tail 100 api
```

Use a TLS reverse proxy on the selected server/domain. `deploy/Caddyfile` is a starting configuration; provide the domain and appropriate DNS/certificate access yourself. The API does not trust arbitrary forwarded client IP headers; application IP quotas behind a proxy aggregate at the proxy IP. Configure ingress per-client limits/capacity and explicitly reviewed proxy trust before a public multi-user launch. Database/cache ports remain loopback-bound and must not be exposed publicly.

Set `VITE_API_URL=https://your-domain` and build/package the extension. Load the unpacked build, copy its Chrome extension ID into `EXTENSION_IDS`, then restart the API. A Chrome Web Store package has a stable store ID; add it to the allowlist before release. Chrome Web Store approval is a separate owner-controlled publication step.

## Health and recovery

Check `/health/ready` for both stores and inspect watch `lastError`, source statuses, and alert timing. A failed provider produces partial/unavailable coverage; a failed monitor check preserves its earlier report. If Redis is unavailable, authenticated work fails closed with 503. Restart services after correcting connections. Avoid logging bearer tokens, request credentials, or credential-bearing provider URLs.

PostgreSQL holds durable snapshots, access links, watches, alerts and events. Back it up with `pg_dump` using your secure credential workflow; test restoration into a separate database. Redis uses AOF in Compose, but report/evidence persistence is PostgreSQL. Never use `docker compose down -v` unless you intentionally want to erase these volumes.

Retention is operator-controlled. Private installation deletion removes identity/report access/watches/alerts; shared public reports and indexed events remain. For a documented retention period, schedule pruning outside active cached/report references and notify users in your hosted privacy policy. No time-based purge is silently enabled by this release.

The monitor claims up to ten due watches at a time. Multiple replicas use atomic database claims and Redis scan locks/pacing. Work can be delayed by provider quotas; queue saturation is reported. Size provider plans and monitoring intervals to traffic. The installation-token model is anonymous and does not prevent a determined client from registering many identities; protect public registration with infrastructure quotas.

## Updating

Run `npm ci`, `npm run verify`, and `npm run test:integration` before release. CI uses Node 22, PostgreSQL 17 and Redis 7, uploads the checked ZIP and checksum, and needs no provider secrets. `scripts/verify-linux.Dockerfile` reproduces build/package checks locally on Node 22 Linux; run its integration command with isolated test storage. Run authenticated live checks after configuring keys. Update `RULES_VERSION` for interpretation changes, bump the product/manifest version for releases, and update the release validation and provider coverage documentation.
