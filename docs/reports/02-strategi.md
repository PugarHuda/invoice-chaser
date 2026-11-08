# 02 · Strategy and differentiation (Hackathon Strategist)

## Judging scorecard (self-assessment)

Criteria are from the Total Recall brief and organizer rulings on Discord: a learning loop on Walrus Memory ("learned patterns across runs, not static rules"), a working Tatum Sui integration (Technical, 30%), track fit (Consumer Finance: blockchain invisible to the user), and presentation.

| Criterion | Start (2 Nov) | Now | What was needed for 9–10 |
|---|---|---|---|
| Learning loop on Walrus Memory | 6 | 9 | Measured loop (error 1.5 → 0.3 days), plans that cite memories, memory on vs off, `analyze()` rules, promises |
| Tatum integration (technical) | 5 | 9 | Payments verified through gRPC, Payment Kit lookup, live checkpoint stream, memory-chain audit |
| Track fit (Consumer Finance) | 7 | 9 | Pay link + QR, gasless/sponsored, swap-and-pay, Slush link, PDF + Factur-X, statement |
| Presentation | 5 | 9 | 2:08 video, deck, landing page with live numbers, judge tour, `/proof` |

## Competitors

| Product | Core | Chain | Learns per client | Shows its evidence | Payment proven on chain | Weakness | Source |
|---|---|---|---|---|---|---|---|
| Chaser | AR collections, ML late-payment predictor | none (bank/ledger) | yes | no | no | closed prediction, from $259/mo | chaserhq.com, newswire |
| Kolleno | AR + AI cash forecast, tone, promises | none | yes | no | no | sales-quote pricing, bank data | kolleno.com |
| Request Finance | Crypto invoicing, recurring | EVM | no | — | yes | never learns who pays when | request.finance |
| Coinbase Business | Invoices, USDC on Base | Base | no | — | yes | no learning, no tone | coinbase.com/business |
| Spark list (other crypto invoicers) | invoice + pay link | various | no | — | yes | parity features only | spark.money |

Full table with citations: README §How it compares.

- **Parity (not a reason to choose us):** pay link, reminders, PDF, CSV, prediction (Chaser and Kolleno), tone (Kolleno), promises (Kolleno).
- **Caught up:** recurring invoices (Request Finance, Coinbase).
- **Gap left:** QuickBooks/Xero sync. It needs OAuth apps; this is a blocker for the owner.

## Differentiators (hard to copy)

1. **Learning you can check:** each plan cites its Walrus memories, and the prediction error is published.
2. **Memory proven by the chain:** every payment memory is re-proven on Sui through Tatum, and every incoming USDC is checked against memory (7/7 both ways).
3. **Chases the wallet, not the calendar:** the payer's live USDC and activity (`ListBalances`, `ListTransactions`) rank the chase queue. Fiat tools can't read a bank balance.

All three need user-owned memory (Walrus), a public chain (Sui) and a live gateway (Tatum) together.

## Positioning

For freelancers and small studios paid in USDC, who lose days chasing clients with the same reminder for everyone, Invoice Chaser is an invoicing app that learns each client's payment behaviour into memory the user owns and can verify on-chain. Unlike Chaser and Kolleno, which predict from private ledgers without showing why, and unlike Request Finance and Coinbase Business, which take the payment but never learn who pays when.

## Features decided

| Feature | Decision | Why |
|---|---|---|
| Recurring invoices | BUILT | competitor must-have for retainers |
| Memory-chain audit, chase queue, payer readiness | BUILT | the differentiators above |
| x402 v1/v2 + MPP + discovery | BUILT | agent payments bounty, unique on Sui |
| Gasless / sponsored / swap-and-pay | BUILT | track fit: the payer needs only USDC, or only SUI |
| QuickBooks/Xero sync | NOT BUILT | needs vendor OAuth apps (blocker) |
| Email sending | NOT BUILT | needs an email API key (blocker); `mailto:` works today |

Landing copy: the three differentiators with live numbers sit directly under the CTA in the first viewport. This is covered by an E2E test (`e2e/differentiators.spec.ts`).
