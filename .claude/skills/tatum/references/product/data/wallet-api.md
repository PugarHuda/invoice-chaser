# Wallet API

## What it is

Tatum Data API surface for **wallet-level views**: portfolio aggregation, native balance lookups, point-in-time balance history, wallet reputation, and UTXO listings. One address in → multi-asset, multi-chain rollup out.

## When to use

- Build a portfolio dashboard — what does this wallet hold across all supported chains?
- Show balance "as of block X" or "as of timestamp T" without walking history yourself.
- Native-coin balance for one address or a batch.
- List unspent UTXOs for a UTXO-chain address (single or batch).
- Score a wallet's reputation — composite signal across portfolio, token mix, and behavioural heuristics.

## Key concepts

- **Portfolio = composition** of native balance + fungible tokens + NFTs + multi-tokens for one address. Single call replaces walking per-chain RPC.
- **Balance-by-time** uses indexer history. Block / timestamp granularity depends on chain and indexer depth — confirm range via MCP.
- **Reputation has three flavours** — overall score, per-portfolio context, per-token context — distinct from the binary `malicious-address` flag in [malicious-address-api.md](malicious-address-api.md). Reputation is graded; malicious is a hard signal.
- **Indexer lag is real:** Data API trails the chain head by seconds to minutes depending on chain. For live state (just-sent tx, pending mempool view), fall back to RPC.
- **UTXO chains** (BTC, LTC, DOGE, …) have a distinct balance model — UTXOs not account balances. Use the UTXO endpoints for those chains; native-balance endpoints return the summed value.

## Relates to

- Also: [token-api.md](token-api.md), [nft-api.md](nft-api.md), [transactions-api.md](transactions-api.md), [malicious-address-api.md](malicious-address-api.md), [exchange-rate-api.md](exchange-rate-api.md)

## Get the details

- **tatum-docs MCP:** paths `/v4/data/wallet/*`, `/v4/data/blockchains/balance*`, `/v4/data/utxos*`. `get-endpoint` per path for params + per-chain enum.
- **Guides:** `search "wallet api portfolio"`, `fetch tatumdocs/wallet-portfolio-balance-tracking`.
- **Web:** https://docs.tatum.io/reference/wallet-api
