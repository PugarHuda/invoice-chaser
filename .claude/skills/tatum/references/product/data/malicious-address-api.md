# Malicious Address API

## What it is

Tatum Data API surface for **address risk screening**. Single endpoint: pass an address, get a flagged / safe verdict with category reasons.

## When to use

- Pre-send check — before broadcasting a transfer to a counterparty, screen the destination address.
- Pre-receive / KYC check — before crediting an inbound deposit to a user, screen the sender.
- Compliance review pipeline — bulk-screen historic counterparties.

## Key concepts

- **Hard signal, not graded.** This endpoint answers "is this address known-bad?". For nuanced scoring (high-volume new address, exchange wallet, sanctions-adjacent) use wallet reputation in [wallet-api.md](wallet-api.md). Use both together for layered defence.
- **API version mismatch is intentional:** this endpoint lives on a different API version than the rest of Data API. Don't try to "normalise" the URL — MCP returns the actual route.
- **Per-address only.** No batch endpoint at time of writing — call sequentially if screening a list. Confirm via MCP if batch is added.
- **Source data is third-party feeds.** A "safe" verdict is "not in our feeds" — absence of evidence, not proof. Layer reputation, transaction patterns, and your own allowlist for production controls.
- **Not a substitute for sanctions compliance.** Treat the verdict as a signal, not a legal opinion.

## Relates to

- [wallet-api.md](wallet-api.md) — reputation gives a graded score, complementary to this binary flag.
- Also: [transactions-api.md](transactions-api.md)

## Get the details

- **tatum-docs MCP:** `GET /v3/security/address/{address}`. Response categories enumerated in the schema.
- **Web:** https://docs.tatum.io/reference/malicious-address
