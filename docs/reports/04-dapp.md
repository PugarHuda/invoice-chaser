# 04 · dApp and integration (Full-Stack Engineer)

Updated 2026-11-09 · inputs: [01-audit](01-audit.md), [02-strategi](02-strategi.md), [03-contracts](03-contracts.md)

## Findings fixed in this round

| Finding | Fix | Files |
|---|---|---|
| `/proof` said "(Tatum)" while the public fullnode served the call | `providerLabel()` names the provider that really served it | `server/routes/chaser.mjs` |
| Chain→memory audit errored on a pruned node ("below earliest available") | Treated as the end of available history and reported as `coveredSince` | `server/sui.mjs`, `server/routes/chaser.mjs` |
| Judges couldn't try "teach a rule" without the passcode | `POST /clients/:id/preview-rule` sandbox: real engine, nothing saved; private mode still gates it | `server/routes/chaser.mjs`, `src/App.tsx` |
| Owner writes were open off Vercel without a passcode (CI wrote 2 test clients) | Fail closed everywhere; `client_archived` memory with an owner-only archive | `server/routes/chaser.mjs`, `server/engine.mjs` |
| Archive could hide an invoice with a payment in flight, and free its unique amount | Paid invoices stay visible, hidden amounts stay reserved, archive waits for in-flight verification | `server/engine.mjs`, `server/routes/chaser.mjs` |
| README was 440 lines; blog link missing | 114-line judge-first README; details in `docs/DETAILS.md` | `README.md`, `docs/DETAILS.md` |

## Wallet and transactions

- **Wallet Standard connect** on the pay page. The server builds every transaction through the gateway: coin selection, gas, the Payment Kit call, the sponsor. The wallet only signs.
- **Simulation before signing**: `SimulateTransaction` shows the real fee and rejects a transaction that would fail.
- **Every outcome has its own message**, all covered by E2E with route interception: waiting for signature → submitted → verified (paid or partial) → Suiscan link, plus rejected, short of USDC, `FailedTransaction` and rate limited.
- **No double submit**: a per-invoice in-flight lock and a digest reservation on the server, and the button disabled in the same tick.
- **Live updates** without polling: SSE over `SubscribeCheckpoints`, paused while the tab is hidden.

## Sponsor integration, before → after

| | AI Builder v0 | Now |
|---|---|---|
| Walrus Memory | remember/recall | System of record (state rebuilt on boot) plus: <br>• `analyze`, `restore` <br>• `listMemories` cursor sync, sharding <br>• durability audit, 3 recall ranking modes <br>• append-only revocation and archive |
| Tatum | one `GetTransaction` | 17 gRPC methods (including the checkpoint stream, `BatchGet*`, `SignatureVerification`, `MovePackage`, `NameService`), Data API, Malicious Address API. Public-fullnode fallback on quota, labelled honestly. |
| Accounting / email | none | **Xero** (OAuth2 granular scopes; invoices and USDC payments with the Sui digest) and **SMTP email** from the owner's mailbox |

## New features, how to try them, proof

| Feature | Try it | Proof |
|---|---|---|
| Rule sandbox | Clients → Acme → type `never chase before the 20th` → **Try it (no passcode)** | Production: inv-101 moves 10 Nov → 20 Nov, `saved: false` |
| Xero sync | Owner: Invoices header → **Sync to Xero** | Org "Invoice Chaser Test": 21 invoices and 17 payments created, a re-run creates 0 and 0 |
| Email reminders | Owner: draft a reminder → **Send by email** | Test email delivered 2026-11-09 to the owner inbox (inv-mw8ndv065d3e08); memory `reminder_emailed` |
| Honest provider labels | `/api/chaser/audit` | `LedgerService.BatchGetTransactions (public Sui fullnode: Tatum quota fallback)`, chain→memory 7/7, `coveredSince` 2026-11-02 |

Mainnet payment proofs are in [03-contracts](03-contracts.md).

## Tests

- **Unit/integration**: 44/44 (`npm test`). Includes the Xero plan (idempotent, partial difference), OAuth state MAC/expiry/tamper, the email gate, archive visibility and reservation, and fail-closed writes.
- **Lint and typecheck**: clean.
- **CI on `main`**: green, including Playwright against production. `e2e-local` on a branch is green with the repository secrets.

## Blockers (owner)

- **Tatum credits.** Ted could only offer a 30% code (`TATUMCOMMUNITY30`), and the owner chose not to buy. Production stays on the public fullnode fallback, which the organizers allow.
- **After judging:** set `PRIVATE_READS=1`.
