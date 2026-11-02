# Historical / Old Block Data

**Products:** [rpc-nodes](../product/rpc/rpc-nodes.md), [byo-rpc](../product/rpc/byo-rpc.md)

## Problem

User needs to query blockchain state at an old block, replay transactions, or run `debug_*` / `trace_*` methods, and an RPC call is failing or returning empty results.

## Recommended approach

- **Step 1:** Confirm the user is hitting Tatum RPC (not a third-party node). Tatum nodes serve full history by default — historical queries Just Work without special routing. If the user is on a third-party endpoint that prunes, that's the cause.
- **Step 2:** If Tatum-side queries are still failing, the chain may have inherent depth limits (a few networks reduce history at the protocol level). Confirm per chain via `tatum-docs` MCP before promising a range.
- **Step 3:** If the user explicitly wants to keep using a non-Tatum (pruning) provider but needs older data as fallback, add Tatum as a secondary endpoint via [byo-rpc](../product/rpc/byo-rpc.md) inside a Custom Gateway.

## Decision points

- **Already on Tatum RPC and it works?** Done. No special configuration needed.
- **On a third-party provider that prunes?** Either switch to Tatum, or layer Tatum as a fallback for deep-history queries via BYO-RPC inside a Custom Gateway.
- **`debug_*` / `trace_*` heavy workload?** These are more expensive than standard reads. Consider the [RPC Accelerator PowerUp](../product/rpc/powerups.md) to cache repeated traces. Query MCP for current per-method pricing.
- **Chain Tatum doesn't support at all?** Contact Tatum sales for custom chain integration. BYO-RPC does not unlock unsupported chains on its own.

## Anti-patterns

- Don't assume historical depth is a Tatum limitation by default — most chains on Tatum have full history. Confirm with MCP before suggesting workarounds.
- Don't query old-block data through a known pruning provider and blame the chain — pruning is the cause.
- Don't inline `debug_traceTransaction` request shape from memory — the spec varies per chain (Berachain, Ethereum, Fantom, Kaia, Ronin, Sonic each have their own OpenAPI). Fetch via `search-endpoints` + `get-endpoint`.

## Next steps

→ Read [rpc-nodes](../product/rpc/rpc-nodes.md).
→ Query `tatum-docs` MCP for setup + endpoint specs:
  - `search "archival data"` to confirm per-chain depth limits where they exist
  - `search-endpoints "debug_traceTransaction"` → chain-specific spec titles (cheaper than `list-specs`)
  - `get-endpoint` for the exact method on the user's chain
