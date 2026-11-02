# Failover / High Availability

**Products:** [gateway](../product/rpc/gateway.md), [custom-gateways](../product/rpc/custom-gateways.md), [byo-rpc](../product/rpc/byo-rpc.md), [powerups](../product/rpc/powerups.md)

## Problem

App can't tolerate per-node outages. When an RPC node goes down, becomes desynced, or slows, the app should automatically route around the failure without manual intervention.

## Recommended approach

- **Step 1:** If the user only needs HA across Tatum's infrastructure, use Tatum's default RPC endpoint (`{{network}}.gateway.tatum.io`). It already provides best-in-class availability across multiple regions with built-in failover. **Do not add a Custom Gateway in front of just Tatum RPC for HA — it adds an extra hop without adding redundancy.**
- **Step 2:** If the user wants cross-vendor redundancy (Tatum + at least one other provider), then a [custom-gateways](../product/rpc/custom-gateways.md) is the right tool. Add the other provider via [byo-rpc](../product/rpc/byo-rpc.md), with **Priority Failover** routing.
- **Step 3:** Enable **Endpoint Health Monitor** PowerUp (see [powerups](../product/rpc/powerups.md)) to skip unhealthy endpoints proactively — especially valuable when BYO endpoints are in the mix.
- **Step 4:** If providers occasionally serve stale data, enable **Intelligent Data Routing** to prefer providers with better freshness. Note: Intelligent Data Routing requires RPC Accelerator + Endpoint Health Monitor to be active first.

## Decision points

- **Just need Tatum-side HA?** Use `{{network}}.gateway.tatum.io` directly. Done.
- **Need cross-vendor HA (Tatum + another provider)?** Custom Gateway + BYO-RPC + Priority Failover.
- **Per-method redundancy?** Use method-specific routing — different strategies per RPC method.

## Anti-patterns

- Don't put a Custom Gateway in front of just Tatum RPC expecting better availability — Tatum's own gateway is already the multi-region HA layer.
- Don't rely on a single endpoint URL with retry logic in the app — that's what a Gateway exists for.
- Don't use Load Distributed if the goal is failover — Priority Failover is the matching strategy.
- Don't promise 100% uptime — verify SLA expectations with the user before quoting numbers.

## Next steps

→ Read [gateway](../product/rpc/gateway.md), [custom-gateways](../product/rpc/custom-gateways.md), [byo-rpc](../product/rpc/byo-rpc.md), [powerups](../product/rpc/powerups.md).
→ Query `tatum-docs` MCP:
  - `search "priority failover"`
  - `search "endpoint health monitor"`
  - `search "intelligent data routing"`
