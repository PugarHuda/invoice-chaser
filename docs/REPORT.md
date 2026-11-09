# Invoice Chaser: final report

Total Recall (Tatum × Walrus Memory) · Track 03 Consumer Finance · Sui Mainnet · https://invoice-chaser-sigma.vercel.app

Details per phase are in [`docs/reports/`](reports/):
- [01 audit](reports/01-audit.md)
- [02 strategy](reports/02-strategi.md)
- [03 contracts](reports/03-kontrak.md)
- [04 dApp](reports/04-dapp.md)
- [05 security](reports/05-keamanan.md)
- [06 QA](reports/06-qa.md)
- [07 submission](reports/07-submission.md)

## 1. Scorecard and bounty checklist

| Criterion | Start | Now |
|---|---|---|
| Learning loop on Walrus Memory | 6 | 9 |
| Tatum integration | 5 | 9 |
| Track fit | 7 | 9 |
| Presentation | 5 | 9 |

Bounty requirements:
- Walrus Memory is load-bearing ✓
- Tatum Sui gRPC ✓
- Mainnet ✓
- AI Builder origin ✓
- Video and deck ✓
- Form submitted ✓

## 2. Audit and security

The latest pass found:
- A-1/S-12: `minimatch` advisory, fixed.
- A-2: stale README seller line, fixed.
- A-3: reports missing from the repo, fixed.

All 12 security findings are fixed; known issues are documented (see 05).

`npm audit`: 0 high/critical, 2 moderate with no upstream fix.

## 3. Sponsor integration, before → after

| Sponsor | Before | After |
|---|---|---|
| Walrus Memory | remember/recall | system of record, analyze, restore, cursor sync, sharding, durability audit |
| Tatum | one `GetTransaction` call | 17 gRPC methods, Data API, Malicious Address API |

## 4. Competitors and positioning

Compared against Chaser, Kolleno, Request Finance, Coinbase Business and the crypto invoicers in Spark's list. Positioning is in 02 and at the top of the README.

## 5. Differentiators, with on-chain proof

1. Plans cite their Walrus memories; the prediction error drops 1.5 → 0.3 days.
2. The memory-chain audit is 7/7 both ways, checked live in one Tatum call.
3. The chase queue reads the payer's wallet live on chain.

## 6. New features and how to try them

Recurring invoices, chase queue, statement of account, wallet claim, x402 v1/v2, MPP, gasless, sponsored and swap-and-pay. How to try each one is in 04; the tx list is in 03.

## 7. Tests

| Suite | Result |
|---|---|
| Unit | 40/40 |
| Playwright, 6 browser and device projects | 266 pass, 16 skipped by design |
| CI against production | green |
| Testnet on-chain | 10/10 |

## 8. Links

- Demo: https://invoice-chaser-sigma.vercel.app
- Video: https://youtu.be/nCpQtlcQF-0
- Deck: GitHub release `demo-v4`
- Contracts: Sui Payment Kit (no custom package); Walrus Site `0x980e…69d0`

## 9. Blockers (need the owner)

1. ~~Tatum Ecosystem developer profile~~: live at https://ecosystem.tatum.io/developers/pugar-huda-mantoro (v1).
2. ~~Repository secrets for PR E2E~~: set 2026-11-08; the `e2e-local` job passes on a branch run.
3. ~~Email from the owner's mailbox~~: configured 2026-11-09 (Gmail SMTP with an app password).
4. ~~Xero OAuth app~~: built and configured 2026-11-08 (Xero app "Invoice Chaser", tokens in Upstash Redis). QuickBooks is not built.
5. **After judging:** `PRIVATE_READS=1` on Vercel, then redeploy.
