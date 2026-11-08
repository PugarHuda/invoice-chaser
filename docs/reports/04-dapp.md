# 04 · dApp and integration (Full-Stack Engineer)

## Wallet and transactions

- Wallet Standard connect on the pay page. The server builds every transaction through Tatum (`/pay-tx`): coin selection, gas, the Payment Kit call. The wallet only signs.
- The real fee is shown before signing (`SimulateTransaction`: gas used − storage rebate).
- States: waiting for signature → submitted → verified through Tatum (paid / partial) → Suiscan link. A rejected signature, a payer short of USDC, a `FailedTransaction` and a rate limit each have their own message, covered by E2E route interception.
- Double submit: an in-flight lock per invoice on the server, and the button is disabled in the same tick (a bug the suite found and that is now fixed).
- The live checkpoint stream (SSE over Tatum `SubscribeCheckpoints`) flips the page to paid without polling. It pauses while the tab is hidden.

## Chain data

- Tatum gRPC with throttling (3 rps free tier) and backoff on 429 or a reset channel. On HTTP 402 (credits exhausted) it falls back for 10 minutes to the public fullnode and says so: `/proof` shows `gatewayStatus`, and every payment memory records `verified_via`.
- Batch reads: `BatchGetObjects` (payment sync) and `BatchGetTransactions` (audit), one call each.
- Inputs validated server-side. The latest addition is `invoiceInputError()` with 30+ edge cases in a unit test.

## Sponsor integration, before → after

| | Before (AI Builder v0) | After |
|---|---|---|
| Walrus Memory | remember/recall | system of record, analyze, restore, listMemories cursor sync, sharding, durability audit, 3 recall ranking modes |
| Tatum | GetTransaction | 17 gRPC methods incl. checkpoint stream, BatchGet*, SignatureVerification, MovePackage, NameService, plus Data API and Malicious Address API |

## New features and how to try them

| Feature | Try it | Proof |
|---|---|---|
| Memory-chain audit | `/?tab=proof`, `GET /api/chaser/audit` | 7/7 live |
| Chase queue (wallet-aware) | Today tab, `GET /api/chaser/chase-queue` | live `ListBalances`/`ListTransactions` |
| Recurring invoices | New invoice → Repeat: Monthly | E2E `differentiators.spec.ts` |
| Pay-link wallet claim | `/?pay=<id>` → Prove the wallet | E2E `payer-proof.spec.ts` |
| x402 / MPP / gasless / sponsored / swap | README sections | tx in `03-kontrak.md` |

## Tests

40 node:test unit/integration tests pass. The Playwright suite is in `06-qa.md`.
