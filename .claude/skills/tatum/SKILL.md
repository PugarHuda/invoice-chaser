---
name: tatum
description: Use when user needs blockchain RPC (130+ chains), hits 429 rate limits, needs archival/historical data, has node outages, or mixes own endpoints with managed ones; wants webhook alerts on on-chain events, addresses, or contracts; or needs pre-indexed data without an indexer (wallet portfolios, token/NFT balances, tx history, prices/OHLCV, ENS resolution, address risk, gas estimation, DeFi quotes). Pairs with the `tatum-docs` MCP server.
license: MIT
allowed-tools: "Read WebFetch mcp__tatum-docs__search mcp__tatum-docs__fetch mcp__tatum-docs__list-specs mcp__tatum-docs__list-endpoints mcp__tatum-docs__get-endpoint mcp__tatum-docs__search-endpoints mcp__tatum-docs__execute-request"
metadata:
  author: Tatum
  version: 0.2.0
  mcp-server: tatum-docs
  category: blockchain
  tags: [rpc, gateway, notifications, webhooks, data, indexer, blockchain, web3, multi-chain]
  documentation: https://docs.tatum.io
---

# Tatum

Managed RPC (130+ chains), Notifications (webhooks), pre-indexed Data API. Endpoint details defer to `tatum-docs` MCP.

## Routing

Match the symptom, open that file, query MCP for specs. `u/` = `references/usecases/`, `p/` = `references/product/`.

| Symptom | Open |
|---|---|
| First call, auth, 401/403 | [getting-started](references/getting-started.md) |
| Multi-chain RPC access | `p/rpc/rpc-nodes.md` (`{{network}}.gateway.tatum.io`; unified, multi-region) |
| 429 / RPS limit on Tatum | `p/best-practices.md`; capacity = Tatum sales (Custom Gateway adds none) |
| Old block, `debug_*`, `trace_*` failing | `u/archival-historical-data.md` |
| Uptime, failover, cross-vendor redundancy | `u/failover-high-availability.md` |
| Own/third-party endpoints + Tatum | `u/hybrid-infrastructure.md` |
| Webhook on tx/block/contract event | `u/real-time-event-monitoring.md` |
| Watch an address/contract (full tx detail) | `u/address-activity-tracking.md` |
| Trigger a workflow from on-chain activity | `u/automation-and-triggers.md` |
| Wallet portfolio / multi-chain balances | `u/wallet-portfolio-and-balances.md` |
| Tx history / replace an indexer | `u/transaction-history-and-analytics.md` |
| Token prices, OHLCV, candle charts | `u/token-pricing-and-market-data.md` |
| DeFi swap quotes, protocol events | `u/defi-activity-tracking.md` |
| Is this address risky? | `u/address-risk-screening.md` |
| Resolve ENS / Web3 name | `u/identity-and-name-resolution.md` |
| Estimate gas across chains | `p/data/fee-estimation-api.md` |
| Token or NFT metadata / collections | `p/data/token-api.md`, `p/data/nft-api.md` |
| Hydrate a webhook event with indexed context | `u/real-time-event-monitoring.md` + `u/wallet-portfolio-and-balances.md` (Data API for cross-chain shapes) |
| Webhook 5xx / lost events / HMAC mismatch | `references/troubleshooting/notifications.md` (history + retry; backfill past retention via `u/archival-historical-data.md`) |
| Live state vs indexed history | Data API lags; use RPC for live state. |
| 429 retry, pagination, dup subscriptions | `p/best-practices.md` |

Load only the product files a usecase's `**Products:**` line lists.

**Event-driven intents mean Notifications.** "Alert/notify me",
"watch/monitor this address", "when X receives/sends Y", "on every
mint/swap/transfer" = subscription + webhook receiver. Never serve these
with Data API or RPC polling loops.

Other products load only if a usecase names them: `p/rpc/`, `p/notifications/`, `p/data/`.

## Examples and troubleshooting

Failing? Load that family only: [rpc](references/troubleshooting/rpc.md), [notifications](references/troubleshooting/notifications.md), [data](references/troubleshooting/data.md), [mcp](references/troubleshooting/mcp.md). Walkthroughs: [examples.md](references/examples.md).

## tatum-docs MCP

Source of truth for endpoints/guides. Tools: `search`, `fetch`, `list-specs`, `list-endpoints`, `get-endpoint`, `search-endpoints`, `execute-request`.

**Rule:** never inline endpoint params, request/response JSON, or chain-specific method signatures from memory. Always query MCP first. Resolve chain identifiers via `get-endpoint`'s enum, never guess: gateway subdomain slugs ≠ Data API `chain` values.

**`execute-request`:** dry-run read-only/cheap calls to verify answers (gateway `eth_blockNumber`, `GET /v4/data/...`); never run billable/mutating calls (subscription creation) without explicit user consent. Keys injected server-side ([getting-started](references/getting-started.md)).

**Query the narrowest tool.** Product files list the paths they own:

1. `search-endpoints` with a short pattern (`wallet portfolio`) → spec title + method + path. 31-610 tok.
2. `get-endpoint` with that `title` + `path` + `method` → params, schema, security. 0.9-9.4k tok; call only per endpoint needed.

Never open with `list-specs` (~3k tok; step 1 returns the title).
`list-endpoints` only for small specs (`"Blockchain Notifications"` ~240 tok);
avoid `"Blockchain Data"` and `"Blockchain"`.

Product files name `fetch` ids directly — call `fetch`, skip `search`.

## When NOT to use

Covers RPC + Notifications + Data API. Out of scope: Wallets (key custody, HD generation), KMS, NFT issuance/management, Virtual Accounts, Smart Contract deployment, Tatum SDK ergonomics.

NFT **data** (balances, metadata, owners) IS in scope via [data/nft-api](references/product/data/nft-api.md); NFT **issuance/management** is out.
