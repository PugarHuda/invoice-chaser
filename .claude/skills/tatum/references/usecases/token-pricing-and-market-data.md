# Token pricing and market data

**Products:** [data/exchange-rate-api](../product/data/exchange-rate-api.md), [data/token-api](../product/data/token-api.md)

## Problem

User wants token prices — current spot, OHLCV candles for a chart, price-change indicators, or historical series for analytics. A naive approach scrapes a public price site or wires CoinGecko directly. Tatum's Exchange Rate API serves the same data with a single auth + a single bill.

## Recommended approach

- **Step 1:** Decide identifier — **symbol** (`ETH`, `BTC`, `USDC`) or **contract** (`chain` + `contractAddress`). Prefer contract for cross-chain disambiguation.
- **Step 2:** Pick the capability in [data/exchange-rate-api](../product/data/exchange-rate-api.md) by question shape.
  - Current price → the **spot rate by symbol or contract** capability.
  - Candle chart → the **OHLCV batch** capability. The non-batch OHLCV path returns ONE candle for one timestamp; a chart needs the batch path, which caps candles per call, so a long window means paginating. Confirm the cap via `get-endpoint`.
  - 24h / 7d delta → the **price-change** capability (single or batch).
  - Historical series → the **rate history** capability.
- **Step 3:** For dashboards / leaderboards, always batch — batch variants accept an array.
- **Step 4:** Compose with the **trending / popular / newest tokens** capabilities in [token-api](../product/data/token-api.md) for a "tokens to watch" sidebar.

## Decision points

- **Quote currency** (USD vs EUR vs stablecoin)? Confirm support via MCP — varies per endpoint.
- **Interval granularity** (1m candles vs 1d)? OHLCV interval enum varies — check `get-endpoint`.
- **Symbol ambiguity bites** — `USDC` differs across chains. For accuracy, switch to contract-based rates.

## Anti-patterns

- Don't loop the single-rate endpoint for a portfolio when the batch endpoint exists.
- Don't compute price-change yourself from OHLCV when the dedicated endpoint returns it.
- Don't use spot rates as DEX-routing quotes — those come from [defi-api](../product/data/defi-api.md) `/swaps/quote`.

## Next steps

→ Read [data/exchange-rate-api](../product/data/exchange-rate-api.md).
→ Query `tatum-docs` MCP:
  - `get-endpoint` `GET /v4/data/rate/symbol/OHLCV/batch` — interval enum, per-call candle cap, so you can compute how many calls a window needs. (The non-batch `/OHLCV` path is single-candle.)
  - `get-endpoint` `POST /v4/data/rate/contract/batch` — batch request shape.
  - `fetch tatumdocs/making-price-candle-chart-with-price-apis` for end-to-end chart guide.
