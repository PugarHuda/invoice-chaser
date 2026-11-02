# Address activity tracking

**Products:** [notifications/subscriptions](../product/notifications/subscriptions.md), [notifications/webhooks](../product/notifications/webhooks.md), [rpc/gateway](../product/rpc/gateway.md)

## Problem

User wants to track everything happening on an address — every transfer, every interaction — with enough detail to audit or index it. Webhooks alone give the trigger and the tx id; full tx context (logs, internal calls, traces) needs RPC.

## Recommended approach

- **Step 1:** Subscribe to address-scoped activity — see [real-time-event-monitoring](real-time-event-monitoring.md) for type selection.
- **Step 2:** In the webhook handler, verify HMAC, then extract the tx id and block number.
- **Step 3:** Call RPC through the [gateway](../product/rpc/gateway.md) to hydrate the full tx (logs, status, internal calls). The method name varies per chain family — for EVM use the tx-receipt / tx-by-hash methods; for non-EVM use the chain's equivalent. Look up the exact method via MCP.
- **Step 4:** Persist or forward the combined event + detail record.

## Decision points

- **Webhook payload enough?** If you only need `txId`, `value`, `from`, `to`, the enriched template may be sufficient — see [templates](../product/notifications/templates.md). Skip RPC hydration entirely.
- **High-volume address (exchange wallet, popular DEX router)?** Route RPC through [gateway](../product/rpc/gateway.md) for rate-limit smoothing and failover.
- **Need deep traces (internal calls, storage diffs)?** Use the chain's `debug_*` / `trace_*` methods on an archival-capable node — see [archival-historical-data](archival-historical-data.md).
- **Handler down? Missed events?** Use the webhook history endpoint to list missed deliveries and the retry endpoint to replay them. For events past the plan's retention window, scan the address's tx history directly via RPC.
- **Want to filter before hydrating?** Add `conditions` (minimum amount, specific contract, specific symbol) on the subscription so only events you care about hit RPC.

## Anti-patterns

- Don't poll the chain for address activity — that's what subscriptions are for. Polling burns RPC credits and lags behind.
- Don't hydrate every event blindly — filter via `conditions` first to avoid paying RPC for noise.
- Don't read tx receipts directly without HMAC-verifying the webhook first — anyone can POST to your URL.

## Next steps

→ Read [notifications/subscriptions](../product/notifications/subscriptions.md), [notifications/webhooks](../product/notifications/webhooks.md), [rpc/gateway](../product/rpc/gateway.md).
→ Query `tatum-docs` MCP for setup + endpoint specs:
  - `search-endpoints "eth_getTransactionReceipt"` → the chain-specific spec title + path
  - `get-endpoint` → exact method shape per chain
  - `list-endpoints "Blockchain Notifications"` (~240 tok) → subscription, webhook history, retry routes
