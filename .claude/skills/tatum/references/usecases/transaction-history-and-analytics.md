# Transaction history and analytics

**Products:** [data/transactions-api](../product/data/transactions-api.md), [data/wallet-api](../product/data/wallet-api.md), [data/defi-api](../product/data/defi-api.md)

## Problem

User wants transaction history for an address — to populate an account-statement UI, feed an analytics pipeline, or replace a custom indexer. Walking RPC blocks or paging `eth_getLogs` is expensive, slow, and per-chain. Data API serves the indexed history in one normalised call.

## Recommended approach

- **Step 1:** Pick the right history capability in [data/transactions-api](../product/data/transactions-api.md).
  - Account/EVM history → the **transaction history** capability (rich shape per tx).
  - UTXO-chain history → the **UTXO transaction history** capabilities (single and batch).
  - Specific tx by hash → the **transaction by hash** capability.
- **Step 2:** For EVM internal transfers (trace transactions that don't appear in the top-level list), call the **internal transactions** capability.
- **Step 3:** Need semantic labels ("this was a Uniswap V3 swap")? Use the **transaction DNA** capability. Skip if you only need raw history.
- **Step 4:** For block-level primitives (current height, block by hash/height, block-by-timestamp) use the **block** capabilities.

## Decision points

- **Live state vs indexed history?** Data API has indexer lag (seconds to minutes). For just-sent-tx visibility, use RPC.
- **DeFi-specific feeds?** Use the **DeFi events** capability in [defi-api](../product/data/defi-api.md) for protocol-level activity.
- **Pagination shape?** Differs per endpoint — confirm via MCP before building paginated fetchers.
- **One address vs many?** Use batch endpoints where the API offers them; never wrap a per-address call in a loop when batch exists.

## Anti-patterns

- Don't page `eth_getLogs` over a block range for history when Data API serves the same in one call.
- Don't build your own internal-tx walker — internal transfers are a separate endpoint here.
- Don't request `transactions/dna` if you only need raw txs — it's more work for the indexer per call.

## Next steps

→ Read [data/transactions-api](../product/data/transactions-api.md).
→ Query `tatum-docs` MCP:
  - `get-endpoint` `GET /v4/data/transaction/history` — query params, pagination shape.
  - `get-endpoint` `GET /v4/data/blockchains/transaction/internal` — EVM internal tx shape.
  - `get-endpoint` `GET /v4/data/transactions/dna` — DNA classification semantics.
