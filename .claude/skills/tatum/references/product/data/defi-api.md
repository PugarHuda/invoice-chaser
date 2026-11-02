# DeFi API

## What it is

Tatum Data API surface for **DeFi protocol activity**: best-price swap quotes, multi-protocol quote comparison, protocol event feeds, and DeFi-indexed block listings. Aggregates across DEXes so you don't integrate per protocol.

## When to use

- Build a swap UI — fetch the best route across protocols for a given input/output pair.
- Compare quotes across protocols side-by-side before committing.
- Stream or page through DeFi protocol events (swaps, liquidity adds/removes, etc.) for a given chain or contract.
- List recent DeFi-indexed blocks — blocks where DEX activity occurred.

## Key concepts

- **Quote vs event:** quote is a forward-looking "what would I get if I traded now?" answer; event is a backward-looking "what trade actually happened?" record. Same product surface, different semantics.
- **Multi-protocol** quote endpoint returns a side-by-side comparison; the single `/quote` endpoint returns the best one only. Use multi-protocol when you want to show options or do MEV-aware routing.
- **DeFi blocks** are a filtered view — only blocks with indexed DEX activity — useful for paging through swap history without scanning every block.
- **Quotes are not executions.** Data API gives you the rate; you still build and broadcast the transaction yourself (typically via RPC).

## Relates to

- [transactions-api.md](transactions-api.md) — once a swap executes, find the on-chain tx via tx history / by-hash.
- Also: [exchange-rate-api.md](exchange-rate-api.md)

## Get the details

- **tatum-docs MCP:** paths `/v4/data/defi/*`. `get-endpoint` per path — quote requests need different params than event/block listings.
- **Web:** https://docs.tatum.io/reference/defi-api
