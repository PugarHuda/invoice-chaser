# Data API troubleshooting

Verify current specifics via `tatum-docs` MCP; values change.

## Data API balance disagrees with RPC

**Symptom:** `/v4/data/wallet/portfolio` or `/v4/data/blockchains/balance` shows a different balance than a direct RPC `eth_getBalance` for the same address.

**Cause:** Data API serves from an indexer that trails the chain head by seconds to minutes (varies per chain). RPC reads live state.

**Fix:** For live state (just-sent tx, pending mempool dependency), use RPC. For dashboards and analytics, the indexer lag is usually acceptable. If a customer needs both freshness AND multi-chain rollup, hybrid the flows: portfolio from Data API, "just-sent" balance from RPC. Query `tatum-docs` MCP `get-endpoint` for current freshness guarantees per endpoint.

## Data API returns empty / `chain not supported`

**Symptom:** Calling `/v4/data/*` against a specific chain returns empty arrays or `chain not supported`.

**Cause:** Data API chain support is per-endpoint — not every chain is indexed for every sub-API. A chain may be in RPC and not in Data API for a given endpoint.

**Fix:** Confirm support via MCP `get-endpoint` — the request schema lists the supported `chain` enum per endpoint. If the chain isn't supported for the surface you need (e.g. wallet portfolio on a small L2), fall back to RPC + your own composition, or contact Tatum sales to request chain coverage.

## Fee Estimation API number doesn't match RPC `eth_gasPrice`

**Symptom:** `/v3/blockchain/fee/{chain}` and an EVM RPC `eth_gasPrice` (or `eth_feeHistory` priority fee) disagree.

**Cause:** Data API returns a normalised recommendation composed from multiple chain signals (recent base fees, recent priority fees, network congestion). RPC returns one raw chain value. They are intentionally different views — Data API trades real-time precision for cross-chain consistency.

**Fix:** For UX fee selectors ("slow / standard / fast") use Data API. For exact gas at submit time, use RPC. Query MCP for current behaviour of each endpoint.

## NFT metadata missing or stale

**Symptom:** `/v4/data/metadata` or `/v4/data/nft/balances` returns null fields or outdated `image` / `attributes` for an NFT.

**Cause:** NFT metadata typically lives off-chain (IPFS, Arweave, HTTP) and Data API caches resolved versions. Fresh mints, recently-renamed assets, or off-chain hosts that are slow / down produce missing fields.

**Fix:** Tolerate missing metadata in your UI (show placeholder). For real-time accuracy, call the contract directly via RPC `eth_call` against `tokenURI(tokenId)` and resolve yourself. Confirm whether a refresh endpoint exists via MCP `search "nft metadata refresh"`.
