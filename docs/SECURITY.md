# Privacy and security

Coinchecker performs read-only inspection. There is no wallet, seed phrase, signing, approval, or transaction feature. The extension sends selected chain/address/pool identifiers to the configured backend. Full page content, browsing history, wallet balances and unrelated tabs are not uploaded.

Required permissions are `activeTab`, `sidePanel`, `storage`, and `alarms`, plus the built-in backend host. Click access identifies supported URLs after the toolbar action. Optional supported-site permissions enable URL suggestions on the active tab; suggestions require an explicit scan. Optional notifications retrieve server alerts. Additional HTTPS host permission is requested only when the user selects another backend. No content scripts or remote executable code are installed.

Each installation uses a random bearer token. PostgreSQL stores its hash; Chrome stores the credential locally. Private watchlists, report-history links and alerts require ownership authorization. Cached public-chain report bodies can be reused for another installation scanning the same target; they contain no bearer tokens or page URLs. Deleting installation data cascades its identity/access/watch/alert records. Shared public report bodies and indexed chain events remain in storage under the backend retention policy. JSON exports downloaded by the user are separate files. This is disclosed in the packaged `privacy.html`.

Changing backend creates another private identity. Losing the token prevents recovery of the old private history; Settings can start a new identity. This tradeoff avoids email/wallet accounts. Keep backend TLS, database access, backups and retention under the operator's control. Providers and backend infrastructure may process request IPs under their own policies.

The API uses strict Zod schemas, parameterized SQL, route ownership checks, IP/device rate limits, distributed scan locks, provider timeouts, body/response size limits, Helmet, and production extension-origin allowlisting. CORS is a browser boundary, not authentication. A public deployment needs ingress rate limiting and capacity planning in addition to the application limits. Logs avoid provider credential URLs and installation tokens.

Token names/metadata/provider fields are rendered as escaped text. Explorer URLs come from a fixed network registry. Project/pool links require HTTPS without URL credentials and open with `noopener noreferrer`. Remote metadata images use `no-referrer` and fall back to a bundled icon. Third-party links and images are still third-party content; they are not an endorsement.

Administrative capability flags are not proof of fraud or exhaustive role analysis. A zero owner address does not prove all authority has disappeared. Scans can become stale; history is bounded; provider outages and unsupported routes are visible. No numerical safety score or blanket “safe” label is used.

For reports about the application itself, use the repository owner's GitHub contact/private reporting mechanism. Do not post credentials in public issues.
