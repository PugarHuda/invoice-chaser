# RPC Gateway

## What it is

Middleware that sits between an app and one or more RPC nodes. Handles routing, failover, health checks, and caching so the app talks to a single stable endpoint instead of juggling node pools.

## When to use

- App needs 99.9%+ uptime and cannot afford per-node outages
- Traffic must spread across multiple providers or regions
- You want a single endpoint URL that survives provider switches
- You need consistent latency under traffic spikes

## Key concepts

- **Routing strategies:** Priority Failover (primary + fallback) and Load Distributed (weighted round-robin). Applied globally or per RPC method.
- **Failover:** unhealthy or out-of-sync nodes are skipped automatically.
- **Caching:** Tatum prefills a cache from its own nodes. Customers can tap into this cache by enabling the RPC Accelerator PowerUp on their Gateway — repeated reads of recent blockchain data are served from the prefilled cache instead of hitting the node. See [powerups.md](powerups.md).
- **Health checks:** Gateway continuously evaluates each endpoint's sync state and responsiveness.

## Relates to

- Also: [rpc-nodes.md](rpc-nodes.md), [custom-gateways.md](custom-gateways.md), [byo-rpc.md](byo-rpc.md), [powerups.md](powerups.md)

## Get the details

- **tatum-docs MCP:** search `"rpc gateway"`, `"routing strategies"`, `"endpoint health"`, or fetch guide id `tatumdocs/rpc-gateway`.
- **Web:** https://docs.tatum.io/docs/rpc-gateway
