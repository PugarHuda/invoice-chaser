# DeFi activity tracking

**Products:** [data/defi-api](../product/data/defi-api.md), [data/transactions-api](../product/data/transactions-api.md), [data/exchange-rate-api](../product/data/exchange-rate-api.md)

## Problem

User wants to interact with DeFi data — show a swap UI with the best route across protocols, track swap volumes on a specific DEX, or page through DeFi-indexed blocks for analytics. Per-protocol integrations multiply quickly; Tatum's DeFi API aggregates the surface.

## Recommended approach

- **Step 1:** Quote vs event — is this a forward-looking trade UI or backward-looking analytics? All capabilities below live in [data/defi-api](../product/data/defi-api.md).
  - **Quote UI** → the **best-route swap quote** capability or the **multi-protocol quote comparison** capability.
  - **Activity feed** → the **DeFi events** capability (protocol events) or the **DeFi-indexed blocks** capabilities (paged and latest).
- **Step 2:** For a swap UI, fetch a quote per input change; debounce so you don't spam the endpoint on every keystroke.
- **Step 3:** For an activity feed, page through events filtered by chain / protocol / time. Compose with [transactions-api](../product/data/transactions-api.md) for cross-protocol tx context.
- **Step 4:** For settlement / P&L, layer [exchange-rate-api](../product/data/exchange-rate-api.md) to value the swap legs in USD.

## Decision points

- **Single quote or multi?** `/quote` returns the best one; `/quotes` returns the comparison. Show multi when the user wants visibility into routing.
- **Execute the swap?** Data API quotes; **execution is a transaction** — build and broadcast via RPC. Data API doesn't sign or send.
- **Protocol coverage** varies — confirm supported DEXes per chain via MCP before promising completeness.

## Anti-patterns

- Don't poll quote endpoints in a tight loop — debounce input or use a request budget.
- Don't treat a quote as committed pricing — markets move between quote and execution.
- Don't reimplement protocol-specific event parsing per DEX — that's what `/defi/events` exists for.

## Next steps

→ Read [data/defi-api](../product/data/defi-api.md).
→ Query `tatum-docs` MCP:
  - `get-endpoint` `GET /v4/data/defi/swaps/quotes` — multi-protocol quote shape, supported protocols per chain.
  - `get-endpoint` `GET /v4/data/defi/events` — event filter params, supported event families.
