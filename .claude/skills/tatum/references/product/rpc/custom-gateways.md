# Custom RPC Gateways

## What it is

Customer-built RPC gateway running on Tatum's orchestration engine. Customer picks the chain, adds RPC provider endpoints (Tatum and/or third-party), configures routing rules, and enables PowerUps. Behaves like any standard RPC URL.

## When to use

- Default Tatum Gateway behavior is not enough — customer needs explicit routing rules
- Customer wants to combine multiple providers in one endpoint
- Customer wants priority-based failover or weighted load distribution under their control
- Customer wants method-specific routing (different strategy per RPC method)

## Key concepts

- **Provider endpoints:** Tatum nodes, third-party providers, or self-hosted nodes — added via [byo-rpc.md](byo-rpc.md).
- **Routing levels:** global (all methods) and method-specific (override per method).
- **Routing strategies:** Priority Failover, Load Distributed (weighted round-robin), or combined with Intelligent Data Routing PowerUp.
- **No vendor lock-in:** mix providers freely; gateway abstracts provider differences.
- **Consumption pricing:** credit-based; query `tatum-docs` MCP for current rates (do not inline pricing numbers from memory).

## Relates to

- [gateway.md](gateway.md) — Custom Gateway is the configurable form of the basic Gateway.
- [powerups.md](powerups.md) — extend Custom Gateway with caching, MEV protection, smart routing.
- Also: [byo-rpc.md](byo-rpc.md)

## Get the details

- **tatum-docs MCP:** search `"custom rpc gateways"`, `"routing strategies"`, `"endpoint routing"`, or fetch guide ids `tatumdocs/custom-blockchain-rpc-gateways`, `tatumdocs/routing-strategies`.
- **Management API:** `search-endpoints "manage gateway"`, or `list-endpoints "GATEWAY MANAGE API"` (~170 tok).
- **Web:** https://docs.tatum.io/docs/custom-blockchain-rpc-gateways
