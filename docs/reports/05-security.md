# 05 · Security (Web3 Security Auditor)

Date: 2026-11-09 · scope: server (`server/`), UI (`src/`), CI, production at invoice-chaser-sigma.vercel.app. Earlier rounds are in [05-keamanan.md](05-keamanan.md); this file is the current state.

## Smart contracts

There is no custom Move package (see [03-contracts](03-contracts.md)), so Slither, Aderyn and their Move equivalents have nothing to scan. The on-chain trust surface is how the server **builds, checks and settles** transactions against Mysten's Payment Kit. That part was reviewed by hand:

| Area | Result |
|---|---|
| Replay | A digest settles once: spent-digest memory, an in-flight lock, and a 30-minute reservation. The Payment Kit nonce is the invoice id, so the chain itself rejects a second registry payment. A payment for invoice A can't settle invoice B (testnet E2E step 10). |
| Signature checks | Pay-link wallet claims sign a message bound to the invoice, the client and an issued-at time, valid for 10 minutes. The signer must equal the address. zkLogin is checked through `SignatureVerificationService` against current JWKs and epoch. The x402 v2 signer must be the tx sender. |
| Front-running / MEV | Payments are fixed-amount transfers to the payee. There is no price or oracle input to manipulate. The SUI→USDC swap is exact-out with 1% max slippage, signed by the payer, who sees the simulation first. |
| Unchecked results | `FailedTransaction` from execution is surfaced and never settled. Simulation must **create** the `PaymentKey` object, not just emit an event. |
| Sponsor abuse | The server only co-signs bytes it built itself (HMAC). Gas budget is capped (`SPONSOR_MAX_MIST`). |
| Honest signing UI | The pay page shows amount, payee, network fee (from simulation) and the exact USDC before the wallet opens. There are no approvals or allowances on Sui: a transaction moves exactly what it shows. |

## Findings

| ID | Component | Severity | Impact | PoC / check | Status |
|---|---|---|---|---|---|
| S-1 | Passcode check | High | Per-route checks made a passcode-guessing oracle | Unit test `live.test.mjs` | Fixed: one check per request |
| S-2 | Lockout order | High | The right passcode worked during lockout | Unit test | Fixed |
| S-13 | Writes without `APP_PASSCODE` off Vercel | High | A CI run wrote 2 permanent test clients to production Walrus | E2E `owner writes need the passcode` got 200 | Fixed (`a480872`): fail closed everywhere; unit test covers the case off Vercel; test clients archived |
| S-14 | Archive hides an invoice with a payment in flight | Medium | A payment could land on a hidden invoice | Review finding | Fixed (`c981450`): archive refused while a payment is being verified; paid invoices stay visible |
| S-15 | Archived invoice frees its unique amount | Medium | A new invoice could reuse the amount, so a payment could match the wrong invoice | Unit test (`allInvoices` keeps the amount) + route PoC: archiving a paid client → 409 | Fixed (`c981450`): amounts reserved from `allInvoices`; unit test |
| S-16 | Rule sandbox under private mode | Medium | With `PRIVATE_READS=1` it would leak invoice plans | Route PoC: no passcode → 401, passcode → 200. Mutation-checked: without the fix the test fails (200 ≠ 401) | Fixed (`a5a2259`): gated like other owner reads |
| S-17 | Xero callback error page | Low | A Xero error string was echoed as `text/html` (reflected content; CSP blocks scripts) | Route PoC: `state=<script>…` → 400 `text/plain`; production checked with curl | Fixed: `text/plain` |
| S-4…S-11 | FailedTransaction settle, digest replay, x402 binding, sponsor abuse, XFF spoofing, CSV injection, array amount, LLM draft injection | High–Medium | See 05-keamanan | Unit and testnet tests | Fixed in earlier rounds |
| S-12 | `minimatch` (dev dependency) | Medium | Lint-time ReDoS | `npm audit` | Fixed (override 11.0.5) |

PoCs live in `server/live.test.mjs` (`security PoCs S-15/S-16/S-17`). They run the real routes against an in-memory book and never write to Walrus. The in-flight branch of S-14 has no PoC, because the lock is module-private; it is covered by review.

## Checks run this round

| Check | Result |
|---|---|
| Secrets in git history | Searched all branches with `git log -p -G/-S` for Sui private keys, Tatum key patterns, MemWal key and passcode assignments, `sk-` keys, and the prefixes of the real keys in `.env.local`: **0 hits**. No `.env`, `.pem` or key file is tracked. |
| Secrets in the client bundle | `public/` (the built SPA) has no key pattern and no prefix of the real Tatum key. |
| Security headers (production) | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS 2 years with preload, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` all present |
| CORS | No `Access-Control-Allow-Origin` for foreign origins. The MCP endpoint answers 403 to a foreign `Origin`. |
| SSRF | Every server `fetch` goes to a fixed host (Xero, Tatum, Walrus aggregator). No URL comes from a request. |
| XSS / reflection | The markdown pay link and the JSON 404 don't reflect injected markup. React escapes UI text. |
| Rate limiting | Per-IP buckets (write 30 / payment 60 / expensive 40 / sync 120 per 10 minutes). The sandbox falls in the payment bucket (41 quick calls → all 200, under 60). The passcode lockout is 10 fails per 10 minutes. |
| Input validation | `invoiceInputError` (30+ edge cases in a unit test), length caps, real calendar dates, JSON errors |
| OAuth (Xero) | `state` is HMAC-signed with a 10-minute expiry and rejects tampering (unit test). Granular scopes. Tokens are stored server-side in Upstash, never in the browser. |
| Email | The recipient is the client's stored contact (owner-set). The subject has newlines stripped. Pay and PDF links are added by the server. The memory stores the message id, never the address. |

## Scanner: before → after

| | Start of audit | Now |
|---|---|---|
| `npm audit` high/critical | 0 | 0 |
| `npm audit` moderate | 9 (`minimatch` chain + `mppx`) | 2 (`mppx`) |

The 2 left are in `mppx@0.4`, pinned by `@suimpp/mpp`, with no upstream fix. They concern EVM access-list/padding gas draining, a path the Sui charge flow does not use.

## Known issues (not fixed, and why)

- **Rate-limit buckets are per instance.** A distributed attacker could exceed them across serverless instances. A global limiter needs a shared store (Upstash is now available); left for after judging.
- **Plain-transfer replay across instances.** Two instances verifying the same pasted digest at the same moment could both accept it. The damage is bounded to one invoice's exact unique amount; registry payments are protected on-chain.
- **The default MemWal relayer sees memory plaintext.** Memories hold aliases and amounts. The one test client that held an email address is archived, but its memory remains on Walrus (append-only).
- **Owner data is publicly readable during judging.** This is by design. `PRIVATE_READS=1` closes it afterwards.
- **Shared Payment Kit registry records expire after 30 epochs.** After that, only the app's spent-digest memory blocks a reused transaction. The fix is a private registry (see 03-contracts).
