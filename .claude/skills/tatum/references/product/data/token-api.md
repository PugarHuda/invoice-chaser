# Token API

## What it is

Tatum Data API surface for **fungible tokens**: contract metadata, holder lists, ownership checks, and discovery feeds (trending, popular, newest). Returns a normalised shape across supported chains so multi-chain apps don't fork per chain.

## When to use

- Look up a token's metadata (name, symbol, decimals, supply) given chain + contract.
- List the holders of a specific token, or check whether a specific address holds it.
- Surface trending / popular / newest tokens for a discovery UI.
- Pull historical popular-token snapshots for trend analysis.

## Key concepts

- **Token identity** = `chain` + `contractAddress`. Always pass both — the same contract address on different chains is a different token.
- **Discovery feeds** — `trending`, `popular`, `newest`, plus `popular/history` — are precomputed; treat them as inputs to a UI, not as transaction-grade ground truth.
- **Owners endpoints** answer two distinct questions: (a) "who holds this token?" (list) and (b) "does address X hold this token?" (yes/no). Pick the narrower one.
- **Metadata refresh:** Data API caches metadata; on-chain edits propagate with indexer lag. For real-time, fall back to RPC `eth_call` against the contract.

## Relates to

- [nft-api.md](nft-api.md) — non-fungible counterpart. Some endpoints (`/owners`, `/metadata`) serve both depending on params.
- Also: [wallet-api.md](wallet-api.md), [exchange-rate-api.md](exchange-rate-api.md)

## Get the details

- **tatum-docs MCP:** paths `/v4/data/tokens`, `/v4/data/owners`. `get-endpoint` per path for required params, response shape, and per-chain support.
- **Guides:** `search "token api"`, `fetch tatumdocs/blockchain-data`.
- **Web:** https://docs.tatum.io/reference/token-api
