# PowerUps

## What it is

Add-ons that extend an RPC Gateway with smarter routing, faster responses, stronger security, and automated reliability. Layered on top of the chosen routing strategy. Multiple PowerUps can be combined.

## When to use

- Need to shield transactions from MEV (front-running, sandwich attacks) → MEV Protection
- Read-heavy app with repeated queries for recent blockchain data → RPC Accelerator (cache)
- Multiple providers but data freshness varies → Intelligent Data Routing
- Endpoints occasionally lag or go unhealthy → Endpoint Health Monitor

## Available PowerUps

- **MEV Protection** — routes transactions through MEV-shielded relays. Use for: DEX swaps, NFT mints, anything where front-running matters.
- **RPC Accelerator** — caches recent blockchain reads. Lower latency, fewer paid node calls. Use for: high-RPS dApps, analytics.
- **Intelligent Data Routing** — picks the provider with best data freshness for each request. **Requires RPC Accelerator + Endpoint Health Monitor to be active first** — without them the gateway has no reference points to compare freshness.
- **Endpoint Health Monitor** — skips unhealthy endpoints automatically before they cause failures.

## Key concepts

- **Layered on routing strategy:** PowerUps do not replace Priority Failover or Load Distributed — they enhance them.
- **Enable per gateway:** activated via the `enabledPowerups` parameter on a Gateway.
- **Cache pricing impact:** RPC Accelerator changes the per-call billing; query `tatum-docs` MCP for current pricing (do not inline numbers from memory).

## Relates to

- [byo-rpc.md](byo-rpc.md) — Endpoint Health Monitor is especially valuable with BYO endpoints.
- Also: [gateway.md](gateway.md), [custom-gateways.md](custom-gateways.md)

## Get the details

- **tatum-docs MCP:** search `"powerups"`, `"mev protection"`, `"rpc accelerator"`, `"intelligent data routing"`, `"endpoint health monitor"`, or fetch guide id `tatumdocs/rpc-powerups`.
- **Web:** https://docs.tatum.io/docs/rpc-powerups
