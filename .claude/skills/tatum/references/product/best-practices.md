# Operational best practices

Concepts that make Tatum API usage succeed at scale. Endpoint-specific shapes
(param names, limits, header casing) are mutable — verify via `tatum-docs` MCP
(`get-endpoint`) before generating code.

## Pagination (Data API)

- List endpoints are paginated. Never assume one response is the full set —
  loop until the endpoint's own termination signal (empty page / no cursor).
- Pagination style differs per endpoint (cursor vs `page`+`pageSize` offsets);
  read it from `get-endpoint` for that path, don't copy from a sibling.
- Pass the cursor back verbatim as an opaque string; never parse, build, or
  increment cursor values yourself.

## Rate limits and retries (429)

- A 429 means the API-key RPS limit was hit — it is per key, across all
  surfaces. Retrying instantly makes it worse.
- Back off exponentially with jitter; if a `Retry-After` header is present,
  respect it as the minimum wait.
- Retry only idempotent calls (reads, JSON-RPC queries) automatically. For
  writes, surface the error or dedupe first (see idempotency below).
- Sustained 429s are a capacity signal, not a bug: reduce concurrency, cache
  hot reads, or contact Tatum sales for a higher limit. A Custom Gateway does
  not add capacity (see SKILL.md routing).
- A 403 instead of 429 is plan/scope gating, not rate limiting — see
  [getting-started](../getting-started.md).

## Batching

- Prefer one indexed Data API call over N RPC calls (e.g. a portfolio endpoint
  instead of per-token `eth_call` loops) — fewer requests, fewer credits.
- Some surfaces support request batching (e.g. JSON-RPC arrays on EVM
  gateways); support is per-chain and per-endpoint, so confirm via MCP before
  relying on it.

## Idempotency of subscription creation

- `POST` subscription creation is not idempotent: a retried create makes a
  duplicate subscription, and duplicates mean duplicate webhooks and double
  credit burn.
- Before creating, list existing subscriptions and match on
  (type, address, chain, webhook URL); create only if absent. On retry after a
  timeout, re-list first — the create may have succeeded.
- Clean up subscriptions you no longer consume; they keep firing and billing.
