# Bring Your Own RPC (BYO-RPC)

## What it is

Feature of [custom-gateways.md](custom-gateways.md) that lets customers register third-party or self-hosted RPC endpoints inside a Tatum Custom Gateway. The Gateway then manages routing, health checks, failover, and retries across the customer's endpoints alongside Tatum's own nodes.

## When to use

- Customer already pays for a third-party RPC provider and wants to keep using it
- Customer is dissatisfied with off-the-shelf RPC performance and runs their own node, with third-party providers as backups
- Customer runs self-hosted nodes for compliance or cost reasons
- Customer wants Tatum nodes as fallback behind their primary provider (or vice versa)
- Customer wants to A/B compare providers behind one URL

**Note:** putting a Custom Gateway in front of an RPC endpoint adds a hop and does not reduce latency on its own — its value is routing, failover, and observability across multiple providers.

## Key concepts

- **Requires a Custom Gateway:** BYO-RPC endpoints cannot stand alone — they are added to a Custom Gateway.
- **Endpoint fields:** chain, URL, provider label, optional HTTP headers (for auth).
- **Test before route:** Gateway can probe a new endpoint before sending real traffic.
- **Multi-endpoint per chain:** add as many endpoints per chain as needed; routing strategy decides who gets the request.
- **Combine with Tatum endpoints:** mix BYO and Tatum nodes in one Gateway for hybrid setups.

## Relates to

- [powerups.md](powerups.md) — Endpoint Health Monitor automatically skips unhealthy BYO endpoints.
- Also: [custom-gateways.md](custom-gateways.md), [gateway.md](gateway.md)

## Get the details

- **tatum-docs MCP:** search `"bring your own rpc"`, `"endpoint management"`, or fetch guide id `tatumdocs/bring-your-own-rpc`.
- **Management API:** `search-endpoints "manage endpoint"`, or `list-endpoints "GATEWAY MANAGE API"` (~170 tok) for the full set.
- **Web:** https://docs.tatum.io/docs/bring-your-own-rpc
