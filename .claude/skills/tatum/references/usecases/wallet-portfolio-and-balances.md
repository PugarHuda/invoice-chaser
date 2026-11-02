# Wallet portfolio and balances

**Products:** [data/wallet-api](../product/data/wallet-api.md), [data/token-api](../product/data/token-api.md), [data/nft-api](../product/data/nft-api.md), [data/exchange-rate-api](../product/data/exchange-rate-api.md)

## Problem

User wants to show what a wallet holds — native coin + fungible tokens + NFTs — across multiple chains, optionally valued in USD. A naive approach loops per-chain RPC `eth_getBalance` plus per-token contract `balanceOf`, multiplies the chain matrix by the token matrix, and falls over on NFT collection enumeration.

## Recommended approach

- **Step 1:** Call the **wallet portfolio** capability in [data/wallet-api](../product/data/wallet-api.md) for the address. One call returns native + fungible + NFT composition across supported chains.
- **Step 2:** For each token in the portfolio, batch-fetch USD rates via the **batch contract-rate** capability in [data/exchange-rate-api](../product/data/exchange-rate-api.md). Compose with portfolio quantities for USD valuation.
- **Step 3:** For NFT-heavy wallets, supplement with the **NFT and multi-token balance** capabilities in [data/nft-api](../product/data/nft-api.md) to enrich with collection + metadata fields if the portfolio rollup is too coarse.
- **Step 4:** For point-in-time views ("balance as of last month"), use the **historical balance** capability in [data/wallet-api](../product/data/wallet-api.md) instead of the live portfolio.

## Decision points

- **Need real-time current state** (just-sent tx not yet indexed)? Fall back to RPC. Data API trails by seconds to minutes.
- **UTXO chain** (BTC, LTC, …)? Use the **UTXO** capabilities in [data/wallet-api](../product/data/wallet-api.md) — balance model is different.
- **Just one token, one chain?** [token-api](../product/data/token-api.md) holder/owner endpoints may be cheaper than a full portfolio call.
- **Dashboard for many wallets?** Batch where the endpoint supports it; avoid one-call-per-wallet loops.

## Anti-patterns

- Don't loop `eth_getBalance` per chain — that's what the portfolio endpoint replaces.
- Don't build USD valuation by scraping public price sites — use [exchange-rate-api](../product/data/exchange-rate-api.md), and prefer contract-based pricing over symbol-based for cross-chain accuracy.
- Don't assume metadata for fresh mints is present — Data API has indexer + IPFS-resolution lag.

## Next steps

→ Read [data/wallet-api](../product/data/wallet-api.md), [data/exchange-rate-api](../product/data/exchange-rate-api.md).
→ Query `tatum-docs` MCP:
  - `get-endpoint` `GET /v4/data/wallet/portfolio` — required params, supported chain enum.
  - `get-endpoint` `POST /v4/data/rate/contract/batch` — batch shape and quote currency options (it is POST, not GET).
