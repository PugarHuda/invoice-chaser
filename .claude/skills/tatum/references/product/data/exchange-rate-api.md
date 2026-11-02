# Exchange Rate API

## What it is

Tatum Data API surface for **token pricing**: spot rates, OHLCV candles, price-change deltas, and historical rate series. Two lookup styles — by **symbol** (`ETH`, `BTC`) or by **contract** (`chain` + `contractAddress`).

## When to use

- Show the current USD price of a token.
- Compute a wallet's USD value (portfolio × current rates).
- Draw a candle chart — pull OHLCV **batch** at your chosen interval (the non-batch path is one candle per call).
- Display 24h / 7d price change indicators.
- Backfill historical price series for analytics or P&L computation.
- Batch-fetch rates for many tokens in one call (portfolio dashboards, leaderboards).

## Key concepts

- **Symbol vs contract:** symbol-based is convenient ("ETH"), but ambiguous across chains (USDC on Ethereum vs USDC on Polygon are different deployments). Contract-based is precise — prefer it when accuracy matters.
- **OHLCV** = Open / High / Low / Close / Volume per interval bucket. Batch returns a capped run of candles per call, so charting a long window is paginated — get the cap and interval enum from MCP. Symbol-quoted pricing is not currency-parameterised the way contract rates are; confirm before promising a quote currency.
- **Price-change** is a derived delta (1h, 24h, 7d). Same as building it yourself from OHLCV but cheaper to fetch.
- **Batch endpoints** (`/batch` suffix) take an array — one round-trip instead of N. Use them for portfolio valuation or table views.
- **Rate freshness varies by source.** Confirm staleness tolerance via MCP for production-critical pricing.

## Relates to

- [wallet-api.md](wallet-api.md) — portfolio composition (compose with rates for USD valuation).
- Also: [token-api.md](token-api.md), [defi-api.md](defi-api.md)

## Get the details

- **tatum-docs MCP:** paths `/v4/data/rate/*`. `get-endpoint` per path for required params, interval enum, supported quote currencies.
- **Guides:** `search "exchange rate ohlcv candle"`, `fetch tatumdocs/making-price-candle-chart-with-price-apis`.
- **Web:** https://docs.tatum.io/reference/exchange-rate
