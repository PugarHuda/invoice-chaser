# 05 · Security (Web3 Security Auditor)

No custom Move contract (see `03-kontrak.md`), so Slither and Aderyn don't apply. The on-chain surface is Payment Kit (Mysten) plus our server's transaction building, signature checks and settlement, reviewed below.

| ID | Component | Severity | Impact | PoC / check | Status |
|---|---|---|---|---|---|
| S-1 | Passcode check | High | each route checked the passcode separately, so a route could serve as a guessing oracle | unit test `live.test.mjs` | fixed: checked once per request (`req.owner`) |
| S-2 | Lockout order | High | the right passcode was still accepted during lockout | unit test | fixed: lockout checked before the passcode |
| S-3 | Open writes without a passcode | High | Walrus memories can't be deleted | Vercel without `APP_PASSCODE` → 503 | fixed (fail-closed) |
| S-4 | x402 settle on a failed tx | High | an on-chain `FailedTransaction` could settle an invoice | unit test | fixed: `sui.executed()` |
| S-5 | Digest replay across invoices | High | one payment settling two invoices | testnet E2E step 5 and 10 | fixed: spent-digest memory + nonce binding |
| S-6 | x402 facilitator binding | High | a tx that only emits an event | simulation must create the `PaymentKey` object | fixed |
| S-7 | Sponsored gas abuse | High | the server signs arbitrary bytes as gas owner | HMAC over the built bytes, per-payment gas cap | fixed |
| S-8 | `X-Forwarded-For` spoofing of the rate limit | Medium | bypass limits | edge header only on Vercel | fixed |
| S-9 | CSV injection | Medium | formula in exported cells | unit test | fixed |
| S-10 | Array amount `[5]` passed validation | Medium | type confusion | unit test | fixed (`cc9ea1f`) |
| S-11 | LLM draft injection | Medium | the model invents a link, amount or address | the server inserts the facts, drafts with numbers or links are rejected | fixed |
| S-12 | `minimatch` DoS (dev dependency) | Medium | lint-time only | `npm audit` | fixed in this pass (override 11.0.5) |

Also in place:
- CSP, HSTS and X-Frame-Options headers.
- The MCP endpoint refuses foreign browser Origins (403).
- Strict routing.
- Secrets live only in `.env.local` and on Vercel; none are in the client bundle.
- zkLogin signatures are verified through Tatum `SignatureVerificationService`.
- Wallet claims expire after 10 minutes and are bound to the invoice and client.

## Scanner, before → after

`npm audit`: 9 moderate → **2 moderate**, 0 high/critical. The 2 left are in `mppx@0.4` (pinned by `@suimpp/mpp`, no fix available). They concern EVM access-list gas draining, a path the Sui charge flow does not use.

## Known issues (documented, not fixed)

- Replay of a plain transfer is guarded per process. Two instances verifying the same digest at the same moment could both accept it, limited to one invoice's exact unique amount.
- The default MemWal relayer sees memory plaintext. Memories hold aliases and amounts only, no emails.
- Owner reads are public for judging. Set `PRIVATE_READS=1` afterwards.
