# Getting started: auth + first successful call

## How auth is injected

Every Tatum call — RPC gateway and Data API alike — authenticates with a single
API key sent as the `x-api-key` HTTP header. Nothing else: no OAuth flow, no
bearer token, no signature.

- Get the key from the Tatum dashboard (https://dashboard.tatum.io).
- Keys are **scoped mainnet vs testnet**. A testnet key against a mainnet URL
  (or vice versa) is rejected — this is the most common "my key doesn't work"
  cause.
- The same header works on both surfaces: `{{network}}.gateway.tatum.io` (RPC)
  and `api.tatum.io` (Data API, Notifications).
- With MCP `execute-request`, the key is injected server-side; never paste keys
  into prompts or commit them.

## What a 401 / 403 means here

- **401 Unauthorized** — the key was missing, malformed, or invalid: header
  name misspelled (`x-api-key`, not `apikey`/`Authorization`), key revoked, or
  a copy-paste truncation. Fix the header before debugging anything else.
- **403 Forbidden** — the key is valid but not allowed to do *this*: wrong
  network scope (testnet key on mainnet), plan does not include the feature,
  or the endpoint requires a paid tier. Check key scope first, then plan.
  Exact plan gating is mutable — verify via `tatum-docs` MCP or the dashboard.
  Sustained 429s are capacity, not auth — see
  [product/best-practices](product/best-practices.md).
- A 401 from a **Custom Gateway / BYO endpoint** is different: the upstream
  provider rejected its own credentials — see
  [troubleshooting/rpc](troubleshooting/rpc.md).

## First successful call (quickstart)

Two stable invariants: the `x-api-key` header and the per-network host
`{{network}}.gateway.tatum.io` (slugs are not guessable — get the list via MCP
`fetch ref:tatumdocs/how-to-connect-rpc-gateway`).

```bash
curl -s https://ethereum-mainnet.gateway.tatum.io \
  -H "x-api-key: $TATUM_API_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

A JSON-RPC `result` with a hex block number = auth and routing both work.
From here, route by symptom via the SKILL.md table; for Data API calls,
resolve the exact path and params with `search-endpoints` then `get-endpoint`
— never guess chain enums (gateway subdomain slugs ≠ Data API `chain` values).
