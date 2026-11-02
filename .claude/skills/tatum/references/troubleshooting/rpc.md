# RPC troubleshooting

Verify current specifics via `tatum-docs` MCP; values change.

## Custom Gateway returns 401 from BYO endpoint

**Symptom:** Requests through a Custom Gateway to a BYO endpoint fail with 401 Unauthorized.

**Cause:** BYO endpoint requires an API key but its auth header was not set on the endpoint config in the Gateway.

**Fix:** Update the endpoint configuration with the required HTTP headers (e.g. `Authorization`, `x-api-key`). Test it via the management API's endpoint-test route before routing real traffic. Direct the user to query `tatum-docs` MCP for the exact PATCH endpoint signature.

## Archival query returns "block not found" or empty result

**Symptom:** `eth_getBalance` / `eth_getStorageAt` / `debug_traceTransaction` at an old block returns an error or empty data.

**Cause:** Chain has reduced archival range (e.g. Algorand pre-block-19M, Beacon ~60 days, Stellar ~12 months, Monad ~10 days, SUI ~3 days). Block is outside Tatum's supported range.

**Fix:** Check the chain's archival depth via `tatum-docs` MCP `fetch tatumdocs/full-nodes-and-archive`. If the block is outside range, recommend a third-party archive provider added via BYO-RPC inside a Custom Gateway.

## Load Distributed strategy slower than expected

**Symptom:** User enabled Load Distributed routing across multiple endpoints; throughput is fine but p95 latency is worse than a single endpoint.

**Cause:** Load Distributed spreads traffic across all active endpoints including slower ones. If one provider is significantly faster, weighting all equal hurts tail latency.

**Fix:** Either (a) switch to Priority Failover with the fastest endpoint primary, or (b) keep Load Distributed but weight the faster endpoint higher. Refer to `tatum-docs` MCP `search "load distribution"` for current weighting syntax.

## Stale or inconsistent data across calls

**Symptom:** Same query returns different results on consecutive calls (e.g. different block heights).

**Cause:** Multiple endpoints behind the Gateway are at different sync states. Load Distributed sends each call to a different one.

**Fix:** Enable the Intelligent Data Routing PowerUp — it prefers providers with the best data freshness. Or switch to Priority Failover so calls hit the same primary endpoint as long as it is healthy.

## "debug_*" / "trace_*" calls billed unexpectedly high

**Symptom:** Credit usage jumped after enabling trace/debug methods.

**Cause:** Trace/debug methods cost substantially more per call than standard methods. Repeated traces in analytics workloads compound fast.

**Fix:** Enable the RPC Accelerator PowerUp to cache repeated traces. Get current per-method pricing from `tatum-docs` MCP.

## Wrong RPC method on non-EVM chain

**Symptom:** Agent suggested `eth_getBalance` for a Solana / NEAR / Tron / Sui app — the request returns "method not found".

**Cause:** Non-EVM chains use different method namespaces (Solana: `getAccountInfo`; NEAR: `view_account`; Tron: HTTP API; Sui: distinct method set).

**Fix:** `GET https://{{network}}.gateway.tatum.io/_methods` lists exactly what that chain supports, per transport (usually 100-600 tok). A 404 means the network slug is wrong — slugs are not guessable (`arbitrum-one-mainnet`, not `arbitrum-one`); get the list from MCP `fetch ref:tatumdocs/how-to-connect-rpc-gateway`. Then `search-endpoints` the chosen method for its spec title + path, and `get-endpoint` for the shape.
