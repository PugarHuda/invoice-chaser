# 03 · Contracts (Smart Contract Engineer)

Date: 2026-11-09 · Sui Mainnet. This replaces [03-kontrak.md](03-kontrak.md); that file keeps the original rationale.

## Decision: no custom Move package

The app needs one on-chain guarantee: an invoice can't be paid twice. Mysten's **Sui Payment Kit** already gives exactly that. `process_registry_payment` creates a `PaymentKey<USDC>{nonce, amount, receiver}` record in a shared registry, and a second payment with the same nonce aborts.

A custom package would add audit surface and a Mainnet deploy without adding any guarantee. The quality bar in the brief (tested library, events, access control, no reentrancy) is met by using the audited package, not by re-implementing it.

What the app verifies on every boot instead of trusting it (live on `/proof` → `chainFacts`):
- `MovePackageService.GetFunction`: `process_registry_payment` exists with the parameter shape we build against.
- `ListPackageVersions`: the package version in use.
- `StateService.GetCoinInfo`: the USDC decimals and symbol match the amounts we compute.

## Findings fixed (contract-adjacent)

| Finding | Fix | File |
|---|---|---|
| A tx that only emits an event could satisfy x402 v2 | Simulation must **create** the `PaymentKey` object for this nonce | `server/sui.mjs` (`inspectSignedPayment`) |
| An on-chain `FailedTransaction` could settle an invoice | `executed()` reports it and never settles | `server/sui.mjs` |
| `@mysten/payment-kit` `getPaymentRecord` builds a malformed type name | The dynamic field is looked up directly (derived object id) | `server/sui.mjs` |
| Payment lookups were one call per invoice | One `BatchGetObjects` call for all open invoices and every amount they were quoted | `server/sui.mjs` |

## On-chain components (Mainnet)

| Component | Address | Explorer |
|---|---|---|
| Sui Payment Kit package (Mysten) | `0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6` | [Suiscan](https://suiscan.xyz/mainnet/object/0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6) |
| Payment Kit namespace | `0xccd3e4c7802921991cd9ce488c4ca0b51334ba75483702744242284ccf3ae7c2` | [Suiscan](https://suiscan.xyz/mainnet/object/0xccd3e4c7802921991cd9ce488c4ca0b51334ba75483702744242284ccf3ae7c2) |
| Registry | `default-payment-registry` (override: `PAYMENT_REGISTRY`) | derived from the name |
| USDC (Circle) | `0xdba34672…f900e7::usdc::USDC` | [Suiscan](https://suiscan.xyz/mainnet/coin/0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC) |
| Walrus Site (UI) | `0x980e107e8226a9229fafb1b6cfb1378bc7dcf9fe409a69125cbf6f8ab9e569d0` | [Suiscan](https://suiscan.xyz/mainnet/object/0x980e107e8226a9229fafb1b6cfb1378bc7dcf9fe409a69125cbf6f8ab9e569d0) |

The package id comes from `@mysten/payment-kit` (`MAINNET_PAYMENT_KIT_PACKAGE_CONFIG`). The USDC type and the registry name live in `server/sui.mjs`, switchable by `SUI_NETWORK` / `PAYMENT_REGISTRY`. The frontend never holds an address; every transaction is built by the server.

## Tests

| Suite | Result |
|---|---|
| Testnet on-chain E2E ([`scripts/e2e-testnet.mjs`](../../scripts/e2e-testnet.mjs)) | 10/10. Includes: the registry rejects a second payment, and a payment for one invoice cannot settle another (nonce binding). |
| Unit tests on settlement logic (`npm test`) | 44/44. Includes FailedTransaction, digest reuse, payer proofs. |

Not done, honestly: Foundry-style fuzz, invariant and coverage runs apply to our own contracts, and there are none. The Payment Kit package is Mysten's and audited by them.

## Main flows on Mainnet, with gas

All seven checked through Sui GraphQL on 2026-11-09: every one is `SUCCESS`. Values are in SUI; net = computation + storage − rebate, paid by whoever owned the gas coin.

| Flow | Tx | Checkpoint | Computation | Storage | Rebate | Net |
|---|---|---|---|---|---|---|
| Payment Kit registry payment (found by sync, nobody reported it) | [G5r8eC1h…](https://suiscan.xyz/mainnet/tx/G5r8eC1hwTkrj4Dg7FFWTcP1P5LTJaRn8FvGUx7WbAJP) | 341117052 | 0.0001 | 0.007319 | 0.002979 | 0.004440 |
| x402 v1 agent payment | [4BTevagv…](https://suiscan.xyz/mainnet/tx/4BTevagvT34X166FBGsqj9tQSxisY1PDGwXXtrxLSC3z) | 341116828 | 0.0001 | 0.007319 | 0.002979 | 0.004440 |
| x402 v2, server as facilitator | [BnnyNUwv…](https://suiscan.xyz/mainnet/tx/BnnyNUwvAYVqWT7bM2HAAWVRuPgoMckD6Tk2DzTqftFJ) | 341412757 | 0.0001 | 0.007364 | 0.002979 | 0.004485 |
| Sponsored gas (payer's SUI unchanged) | [8UkL1z4K…](https://suiscan.xyz/mainnet/tx/8UkL1z4KhCrta1zJfvfTsdZmMPss9jrTnNcceLGUgwCq) | 341405407 | 0.0001 | 0.008352 | 0.003967 | 0.004486 (paid by the sponsor) |
| MPP charge | [CrgvCr2F…](https://suiscan.xyz/mainnet/tx/CrgvCr2FoJXxuc3p3tuNorCSoPquSUeuuhHqu5tL8iG4) | 341397518 | 0.0001 | 0 | 0.001322 | −0.001222 (net rebate) |
| Plain USDC transfer, matched by its unique amount | [CzFhbHnE…](https://suiscan.xyz/mainnet/tx/CzFhbHnEY6ug3dauaPqmp6CsNkuwfTMtJEGPqRArqkqU) | 341573132 | 0.0001 | 0.002645 | 0.001322 | 0.001423 |
| Native gasless USDC (Address Balances) | [7oaYHYj2…](https://suiscan.xyz/mainnet/tx/7oaYHYj24aBSLs8QxTHg7zebAiZycCKkCF6vFPSMcLYA) | 341594410 | 0 | 0 | 0 | **0** |

Reading the numbers:
- A Payment Kit payment costs about 0.0044 SUI, most of it storage for the `PaymentKey` record. Part of that comes back as rebate if the record is ever deleted.
- The gasless path costs the payer nothing at all.
- Whole-project total (all wallets, all hackathon txs): 0.061 SUI gas + 2.59 WAL.

## Known limit and the upgrade path

The shared registry keeps records for 30 epochs. A private registry with a longer `setConfigEpochExpirationDuration` removes that limit; it is one Mainnet transaction plus `PAYMENT_REGISTRY=<name>`.

Not done during judging: invoices already quoted point at the default registry, so switching now would make their QR codes stale.
