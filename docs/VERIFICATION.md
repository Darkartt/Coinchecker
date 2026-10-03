# Release validation

Validated on 2026-10-03 for product version 1.0.0 and risk rules version 1.0.1. Provider fixtures, live integration checks, and outstanding release checks are recorded separately.

## Automated checks

All 47 tests passed, together with workspace type checks, production builds, and package validation. The complete verification also passed in a Node 22 Alpine Linux container using isolated PostgreSQL 17 and Redis 7 storage.

| Check                                      | Coverage                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk rules and provider adapters: 36 tests | Exact token identity, unsupported and mismatched simulation routes, uncertainty, critical findings, administrative capabilities, outages, authenticated provider fixtures, cache isolation, and extension worker behavior |
| PostgreSQL and Redis: 7 integration tests  | Installation authorization, private ownership, persisted evidence and history, cache reuse, hashed tokens, watch settings and baselines, monitoring failures and alerts, quotas, and data deletion                        |
| Optional Sites runtime: 4 tests            | Static routing and required hosting build outputs                                                                                                                                                                         |
| Extension package                          | Manifest V3, minimal permissions, locally bundled code, assets and dependency licence notices, no source maps or provider secrets, ZIP and SHA-256 generation                                                             |
| Dependency audit                           | No known vulnerabilities reported by the final dependency audit                                                                                                                                                           |
| Production container                       | Node 22 image build, unprivileged runtime, database/cache readiness, extension-origin allowlist, and disabled Honeypot production capability without provider permission                                                  |

Run `npm run verify`, `npm run test:integration`, and `npm run test:sites -w @coinchecker/extension` to reproduce the checks. Integration tests require dedicated test storage.

For Linux build and package checks, run:

```sh
docker build -f scripts/verify-linux.Dockerfile -t coinchecker-verify:local .
```

Run the resulting image with isolated test `DATABASE_URL` and `REDIS_URL` values to execute integration checks. Supported Node versions are 22.12+ or 24 LTS. Hosted GitHub Actions execution remains unverified; the workflow is included in the repository.

## Live integration and interface checks

`npm run smoke:live` exercised Ethereum and Base USDC scans, cache reuse, persisted history, input validation, and installation-private access. GoPlus, DEX Screener, public CoinGecko metadata and historical prices, and RPC were exercised. Ethereum RPC event indexing had partial coverage; Etherscan was not configured. Local results are written to the ignored `artifacts/live-smoke.json`.

Base scans on a selected Uniswap v3 pool returned five complete sources and a missing Etherscan source. Unsupported Aerodrome simulation responses remained explicitly unsupported and did not determine observed taxes or a honeypot verdict. These checks establish integration behavior, not token safety or detection accuracy.

The web interface was exercised with live scans, expandable findings and raw evidence digests, pool selection, watch creation and editing, persisted watchlists, scan comparison, alerts, and invalid-input handling. Sample and settings views were checked at a 320-pixel viewport.

## Outstanding release checks

- Live authenticated Etherscan and CoinGecko coverage after configuring provider keys; adapter fixtures have passed.
- Honeypot.is production permission under the provider's published terms. Production calls remain disabled until permission is cleared and `HONEYPOT_PRODUCTION_PERMISSION=true` is configured. See [provider coverage and terms](PROVIDERS.md).
- Installed desktop Google Chrome verification: toolbar side panel, API access, supported-page detection, optional permissions, alarms, notifications, and a completed JSON evidence download.
- Production hosting, TLS, provider quotas, stable extension ID, and Chrome Web Store publication.
- Hosted GitHub Actions execution.

No historical malicious-token detection benchmark has been completed. History coverage is a bounded persistent event index with recorded scan comparison. Full lifetime event history, protocol-universal liquidity lock validation, audit certification, Solana analysis, and an AI explanation layer are outside this release's advertised coverage.
