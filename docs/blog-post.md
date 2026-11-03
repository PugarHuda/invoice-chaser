---
title: "Invoice Chaser: an invoice tool that learns how each client pays (Walrus Memory + Tatum on Sui)"
tags: walrus, sui, tatum, hackathon
---

<!-- DRAFT for dev.to. Fill the two TODO links before publishing. -->

Every freelancer has a client like Acme. The invoice is due on the 5th, nothing happens, you send a friendly nudge on the 6th, nothing happens, and somewhere around the 10th the money shows up, usually right after you finally write something formal. Next month it happens again, because your invoicing tool has no idea it already happened four times.

I built **Invoice Chaser** for the Total Recall hackathon (Tatum × Walrus Memory) to fix exactly that. It's an invoice tracker for freelancers who get paid in USDC on Sui, and it remembers how each client pays.

- Live demo: https://invoice-chaser-sigma.vercel.app
- Video (2:50): https://github.com/PugarHuda/invoice-chaser/releases/download/demo-v2/invoice-chaser-demo-v2.mp4
- Code: https://github.com/PugarHuda/invoice-chaser

## What it does

1. You issue an invoice. Instead of "300 USDC" the client is asked to pay something like **300.004217 USDC**. Those extra micro-decimals are the invoice's fingerprint on-chain.
2. The client opens a pay link with a real `sui:pay` QR code and pays from any Sui wallet. The payment goes through the **Sui Payment Kit** registry with the invoice as the nonce, so the chain refuses a second payment for the same invoice, and the app finds the payment by invoice on its own. Every payment is checked **on Sui Mainnet through Tatum's gRPC gateway**: did it succeed, how much USDC landed on my address, is it newer than the invoice, has this transaction been used before, and which wallet paid.
3. Everything that happens (invoice sent, reminder sent and in what tone, paid how many days late, underpaid by how much, and any rule you tell it) is written to **Walrus Memory**.
4. Before the next reminder, the app recalls that client's history and decides **when** to chase, **in what tone**, and **what it expects** to happen. A "Why?" panel shows the memories behind each decision.

## The part judges asked for: does it actually learn?

Here is the same invoice for Acme (due 5 Nov) with memory switched off and on:

| | Memory off | Memory on |
|---|---|---|
| First reminder | 6 Nov, friendly | **9 Nov, formal** |
| Predicted payment | — | **10 Nov** |
| Why | default schedule | Acme paid +4, +6, +5, +5 days late; formal reminders were followed by payment within 3 days 4/4 times, friendly 1/3 |

And the prediction got better with each invoice it saw. Before each of Acme's last four payments the app predicted how late it would be. It was off by **4 days, then 2, then 0, then 0**. That chart is in the app, on every client page.

Rules work the same way. Type "never chase Acme before the 10th" into the client page and it becomes a memory; the next plan moves the reminder to the 10th, and the Why panel says so. Or paste the client's email: Walrus Memory's `analyze()` pulls out "vendor payments are only run on Thursdays and never before the 15th" as a fact, and the plan predicts a Thursday payment and holds reminders until the 15th, even for a client with no payment history yet. (My first parser read that sentence as "don't remind on Thursdays". A Playwright QA pass caught it.)

## How it uses Walrus Memory

I didn't want memory to be a log on the side, so **Walrus Memory is the only database**.

Every event is one memory: a sentence a human can read, plus a small JSON tag the code can parse:

```
Acme Corp paid inv-095 in full (3500.007537 USDC) on 2026-10-20, 5 day(s) after due, after 1 reminder(s); last tone formal.
#ic {"type":"invoice_paid","client":"c1","invoice":"inv-095","delay_days":5,"reminders":1,"last_tone":"formal",...}
```

Each client gets its own namespace (`ic:main:client:<id>`). When the server starts it holds nothing. It lists the namespaces, recalls each one, and rebuilds clients, invoices and learned profiles from Walrus. There's a **Total Recall** button that throws away local state and does it again on demand. This also happens to be the only way to run on the Tatum AI Builder preview, which has no database at all.

Two practical things I learned:

- A Mainnet write takes ~25 seconds end to end (encrypt, embed, store, certify). So writes go into a background queue; the UI says *writing to Walrus…* until the relayer confirms, then links the blob on Walruscan. Nothing is ever shown as saved before it is.
- `recall` is similarity-ranked and capped at 100, so it's not an inventory. I use `listNamespaces` to know how many memories *should* exist, and if a recall comes back short the app refuses to settle payments rather than risk accepting a digest it can't see was already used.

The demo history (Aug–Oct, 38 memories) was written with a seed script that uses the app's own format. Every seeded memory carries `"seed": true` and the UI labels it. Anything you do in the app is a real new memory.

## How it uses Tatum

All chain reads go through Tatum's **Sui Mainnet gRPC gateway** (`sui-mainnet-grpc.gateway.tatum.io`, `x-api-key` header), with `SuiGrpcClient` from `@mysten/sui` over native gRPC:

- `LedgerService.GetTransaction`: verify a payment from `effects.status` and `balance_changes`
- `StateService.GetBalance`: watch the payee's USDC balance
- `LedgerService.GetCheckpoint`: the live proof page
- building the payer's Payment Kit transaction (coin selection, gas) and executing an agent's signed payment
- looking an invoice's payment up in the Payment Kit registry, and the payer's SuiNS name

Sui's JSON-RPC was deprecated during the hackathon, and gRPC has no "list transactions for an address" call. The Sui Payment Kit fixed that for me: a payment is a record keyed by the invoice, so I look it up directly instead of scanning history. (One gotcha: the SDK's `getPaymentRecord` builds a malformed type name, `PaymentKey<phantom T><coin>`, so I query the dynamic field myself.) The free plan allows 3 requests per second, so calls are throttled and 429s are retried with backoff.

## Agents can pay too (x402)

Every invoice is also an HTTP resource. An accounts-payable agent that requests it gets `402 Payment Required` with the terms (USDC on Sui, amount, payee, and the Payment Kit registry + nonce), pays, and retries with `X-PAYMENT: <digest>` to get a receipt. The repo has a reference agent that checks its own budget before paying.

## Tested on testnet first

The same code runs against Sui Testnet with one env var (Tatum's testnet gateway, Circle testnet USDC, testnet Payment Kit) and a separate memory namespace. An end-to-end script pays a real invoice as an x402 agent, then checks on-chain that a second payment is rejected, that an unreported payment is found and settled automatically, and that a replayed transaction is refused. All six checks pass.

## Then on Mainnet

On Sui Mainnet, an agent asked for invoice `inv-mvzyioev`, got `402 Payment Required`, noticed it held no USDC, swapped just enough SUI through the Cetus aggregator, paid through the Payment Kit registry and got its receipt ([payment](https://suiscan.xyz/mainnet/tx/4BTevagvT34X166FBGsqj9tQSxisY1PDGwXXtrxLSC3z)). A second invoice was paid through the registry and nobody told the app; the production server found it by invoice nonce and settled it ([payment](https://suiscan.xyz/mainnet/tx/G5r8eC1hwTkrj4Dg7FFWTcP1P5LTJaRn8FvGUx7WbAJP)). Delta Studio, a client with no history that morning, now has two remembered on-time payments, and its profile changed accordingly.

## Agents can read the memory too (MCP)

The app is also an MCP server. `claude mcp add --transport http invoice-chaser https://invoice-chaser-sigma.vercel.app/api/chaser/mcp` gives Claude tools like `client_profile`, `plan_reminder` and `search_client_memory` over the same Walrus memories.

## Starting with Tatum AI Builder

The first version came from one prompt in [Tatum AI Builder](https://ai.tatum.io) (the prompt is in the repo, the generated commit is tagged `ai-builder-v0`). It produced a clean UI with all five screens and a sensible profile algorithm. The backend was a mock: in-memory data, fake memories, a simulated wallet payment, and a QR code that was just an icon. I kept the UI and replaced every mock with the real thing: Tatum gRPC, Walrus Memory, Sui Payment Kit, and a payment check that can say no.

## Limits I know about

- Reminders open in your email app with the pay link; the app does not send email itself.
- Rules are read with a small parser (day of month, pay days, days to avoid, tone). Stranger phrasing ("after their board meets on the first Tuesday") isn't understood yet.

Thanks to the Tatum and Walrus teams for the quick answers in Discord.

#TotalRecall @Tatum_io @WalrusProtocol
