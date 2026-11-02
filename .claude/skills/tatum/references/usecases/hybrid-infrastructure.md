# Hybrid Infrastructure

**Products:** [byo-rpc](../product/rpc/byo-rpc.md), [custom-gateways](../product/rpc/custom-gateways.md), [powerups](../product/rpc/powerups.md)

## Problem

User already pays for a third-party RPC provider or runs self-hosted nodes (often for compliance, latency, or private mempool reasons) but wants Tatum's routing, failover, and observability on top. They don't want to throw away existing infra.

## Recommended approach

- **Step 1:** Create a [custom-gateways](../product/rpc/custom-gateways.md) for the chain.
- **Step 2:** Add the user's existing endpoints via [byo-rpc](../product/rpc/byo-rpc.md). Test them with the management API's test endpoint before routing real traffic.
- **Step 3:** Optionally keep Tatum's RPC node as a fallback in the same Gateway — gives cross-vendor redundancy at zero extra integration cost.
- **Step 4:** Pick routing strategy:
  - **Priority Failover** — own/preferred provider primary, Tatum as fallback.
  - **Load Distributed** — split traffic by weight (e.g. 80% own, 20% Tatum).
- **Step 5:** Enable **Endpoint Health Monitor** PowerUp (see [powerups](../product/rpc/powerups.md)) — critical for BYO endpoints which may have less reliable health.

## Decision points

- **Private mempool needed?** Keep the private mempool endpoint as primary, Tatum as fallback for read traffic only via method-specific routing.
- **Compliance requires only certain providers?** Use Priority Failover with only the compliant endpoints listed.
- **Self-hosted nodes occasionally desynced?** Health Monitor + Intelligent Data Routing combination skips them automatically.

## Anti-patterns

- Don't add BYO endpoints without a Custom Gateway — they cannot stand alone.
- Don't skip the endpoint test step — bad URLs/headers silently break failover.
- Don't expose the BYO endpoint's auth headers in client-side code — set them on the Gateway endpoint config (server-side).

## Next steps

→ Read [byo-rpc](../product/rpc/byo-rpc.md), [custom-gateways](../product/rpc/custom-gateways.md), [powerups](../product/rpc/powerups.md).
→ Query `tatum-docs` MCP:
  - `search "bring your own rpc"`
  - `search "endpoint health monitor"`
  - `list-endpoints "GATEWAY MANAGE API"` (~170 tok) for endpoint management routes
