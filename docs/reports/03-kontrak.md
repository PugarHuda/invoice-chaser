# 03 · Smart contracts (Smart Contract Engineer)

## Decision: no custom contract

The app needs only one on-chain guarantee: "one invoice can't be paid twice". **Sui Payment Kit** (Mysten, audited, shared `default-payment-registry`) gives exactly that. `process_registry_payment` creates a `PaymentKey<USDC>{nonce, amount, receiver}` record, and a second payment with the same nonce aborts. Writing our own Move package would add audit surface and deploy risk, with no new guarantee. Asked against the brief's rule "ask before changing contract architecture": nothing to change, because nothing was replaced.

What the app verifies instead of trusting:
- `/proof` → `chainFacts`: `MovePackageService.GetFunction` confirms `process_registry_payment` exists with the parameter shape we build against; `ListPackageVersions` shows the package version.
- Payment lookup derives the `PaymentKey` object id locally and reads all open invoices in **one** `BatchGetObjects` call. Only `NOT_FOUND` counts as unpaid.
- x402 v2 settlement requires the simulation to **create** that `PaymentKey` object, not just emit an event.

## Mainnet transaction proof

| Flow | Tx |
|---|---|
| x402 v2: the agent only signed, server facilitated through Tatum | [BnnyNUwv…](https://suiscan.xyz/mainnet/tx/BnnyNUwvAYVqWT7bM2HAAWVRuPgoMckD6Tk2DzTqftFJ) |
| MPP charge | [CrgvCr2F…](https://suiscan.xyz/mainnet/tx/CrgvCr2FoJXxuc3p3tuNorCSoPquSUeuuhHqu5tL8iG4) |
| Sponsored gas (payer SUI unchanged) | [8UkL1z4K…](https://suiscan.xyz/mainnet/tx/8UkL1z4KhCrta1zJfvfTsdZmMPss9jrTnNcceLGUgwCq) |
| Native gasless USDC (Address Balances) | [7oaYHYj2…](https://suiscan.xyz/mainnet/tx/7oaYHYj24aBSLs8QxTHg7zebAiZycCKkCF6vFPSMcLYA) |
| Plain transfer found by reconciliation | [CzFhbHnE…](https://suiscan.xyz/mainnet/tx/CzFhbHnEY6ug3dauaPqmp6CsNkuwfTMtJEGPqRArqkqU) |
| Payment Kit payment nobody reported, found by `/sync-payments` | [G5r8eC1h…](https://suiscan.xyz/mainnet/tx/G5r8eC1hwTkrj4Dg7FFWTcP1P5LTJaRn8FvGUx7WbAJP) |
| Testnet E2E: registry rejects a second payment (10 on-chain checks) | [CTXc9cDK…](https://suiscan.xyz/testnet/tx/CTXc9cDKTXBJFDJjf1pwip43cVY7TB7eyuGWTyKeyqwD) |

On-chain objects: Walrus Site `0x980e107e8226a9229fafb1b6cfb1378bc7dcf9fe409a69125cbf6f8ab9e569d0`; PDF receipt blob `maCqeFY1G5eSVx_ji5zrqXM308rCMUMY-nGWqBMNNPM`.

## Known limit

The shared registry keeps records for 30 epochs. After that the app's spent-digest memory still refuses a reused transaction, but the chain no longer does. A private registry (`PAYMENT_REGISTRY`) removes the limit; it needs a mainnet deploy by the owner.
