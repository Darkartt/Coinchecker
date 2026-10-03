# Coinchecker

Understand a token before interacting: its risks, recorded history, and the evidence behind each finding.

Coinchecker is a read-only Chrome Manifest V3 extension with a native side panel and a NestJS API backed by PostgreSQL and Redis. It supports Ethereum and Base. It requires no wallet connection or transaction signing.

## Product

- Scan an exact network and contract address, or identify a token/pool from supported Etherscan, Basescan, DEX Screener, and Uniswap URLs.
- Inspect reproducible risk rules, referenced fields, provider responses, SHA-256 digests, source coverage, timestamps, and available block references.
- View market context, select a verified token pool, and inspect third-party project metadata and seven-day historical prices where covered.
- Review deployment records and a persistent bounded event index of ownership, roles, implementation upgrades, and mint/burn transfers. Pool age is separate from token age.
- Compare recorded scans. Watch tokens with configurable intervals and tax/liquidity thresholds. The backend monitors changes while Chrome is closed; Chrome retrieves alerts and can show optional notifications.
- Copy full addresses, open trusted explorer links, export full JSON evidence, change backend, and delete private installation data.

Risk categories are **Critical finding**, **High risk**, **Caution**, **No major issues detected in the checks completed**, and **Insufficient data**. Missing evidence is never a pass. An unsupported or failed simulation is never automatically labelled a honeypot. A serious finding cannot be cancelled by unrelated positive signals.

## Run locally

Use Node.js **22 LTS (22.12+) or 24 LTS**, npm, and Docker Desktop. From the repository root:

```powershell
Copy-Item .env.example .env
npm ci
npm run services:up
npm run dev
```

Open [the local panel](http://localhost:4173). API readiness: [localhost:3001/health/ready](http://localhost:3001/health/ready). `?design=1` opens a labelled fictional sample report.

Keep provider keys in `.env`, never in extension code or Git. Etherscan requires `ETHERSCAN_API_KEY`; CoinGecko supports a public/Demo origin or configured Demo/Pro keys. Unavailable keys and coverage are shown in each report. The application works with partial coverage; it never invents missing source or deployment records.

## Install the Chrome extension

```powershell
npm run build
npm run verify:package
npm run package
```

In **Google Chrome 116 or later**, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist/client`. Pin Coinchecker, open a supported token page, and click its toolbar button to open the native side panel. Manual scanning works on any page. Use Settings for backend URL, optional supported-site detection, and optional notifications.

Embedded browsers may not support Chrome's native Side Panel API. Use desktop Google Chrome for the installed extension. The local web panel supports scans and reports; extension-only detection and notification controls are unavailable in the web preview.

The ZIP is `artifacts/coinchecker-extension-1.0.0.zip`, with a SHA-256 companion file. It contains locally bundled scripts/fonts/assets and minimal read-only permissions. The default package uses the local API; for distribution set `VITE_API_URL` to your HTTPS backend before building. Production API origin access must include the installed extension ID.

## Verification and deployment

```powershell
npm run verify
npm run test:integration
npm run test:sites -w @coinchecker/extension
npm run smoke:live
```

Unit/provider tests use labelled fixtures. Integration tests use real local PostgreSQL/Redis and deterministic provider fixtures. `smoke:live` makes public provider calls on Ethereum/Base USDC, verifies stored history/private access/cache, and records source status in `artifacts/live-smoke.json`. It does not certify tokens or measure malicious-token detection accuracy. CI builds and uploads the extension ZIP without needing provider secrets.

See [architecture and API](docs/ARCHITECTURE.md), [coverage and provider terms](docs/PROVIDERS.md), [deployment and operations](docs/OPERATIONS.md), [privacy and security](docs/SECURITY.md), [release validation](docs/VERIFICATION.md), and [asset sources](docs/ASSETS.md).

Production hosting, authenticated provider coverage, and Chrome Web Store publication need your service accounts and configuration. The source contains deployment support; it does not imply a hosted production service or approved store listing.
