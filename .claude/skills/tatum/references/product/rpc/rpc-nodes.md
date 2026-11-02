# RPC Nodes

## What it is

Tatum's managed RPC node infrastructure. Computers connected to each supported blockchain that validate transactions and serve queries. Tatum maintains nodes for 130+ networks so customers do not have to.

## When to use

- Querying chain data or sending transactions without running nodes, especially across several chains
- Historical / old-block queries (full history by default; see [archival-historical-data](../../usecases/archival-historical-data.md))

## Key concepts

- **Full history by default:** Tatum nodes serve historical state and `debug_*` / `trace_*` methods without special configuration, unless explicitly stated otherwise per chain. The "full vs archival" distinction common to non-Tatum infrastructure does not apply here.
- **Credit-based pricing:** different methods consume different credit amounts (standard reads, `eth_call`, `debug_*` / `trace_*`, chain-specific premium methods). Always query `tatum-docs` MCP for current per-method rates — do not inline pricing numbers.
- **130+ chains:** EVM, Solana, NEAR, TON, Tron, Cardano, Stellar, Sui, Cosmos, and more. Each has its own OpenAPI spec.
- **Per-chain history edge cases:** a small number of chains have inherent protocol-level depth limits. Confirm via MCP before promising a deep-history range on those.

## Relates to

- [gateway.md](gateway.md) — the Gateway routes to these nodes; nodes do not replace the Gateway.
- Also: [byo-rpc.md](byo-rpc.md)

## Get the details

- **Connecting:** host is per-network — `{{network}}.gateway.tatum.io` (e.g. `ethereum-mainnet`; slugs are not guessable, `arbitrum-one-mainnet` not `arbitrum-one`). Bare `gateway.tatum.io` is not usable. Auth is the `x-api-key` header on every call. Slug list: `fetch ref:tatumdocs/how-to-connect-rpc-gateway`.
- **Which methods does a chain support?** `GET {{network}}.gateway.tatum.io/_methods` — live per-transport list, usually 100-600 tok (method-rich chains more; Tron ~2.3k). Beats enumerating specs. `/llms.txt` is the same data as prose.
- **tatum-docs MCP:** search `"rpc nodes"`, `"supported blockchains"`, `"archival data"`, or fetch guide ids `tatumdocs/rpc-nodes`, `tatumdocs/full-nodes-and-archive`.
- **Per-chain endpoint specs:** `search-endpoints` the method name (e.g. `eth_call`, `getAccountInfo`) — returns the chain-specific spec title + path. Coverage is uneven: common EVM methods may only have a spec under one chain (`eth_getBalance` exists only as `"eth_getBalance - Berachain"`). The JSON-RPC body is standard across EVM chains, so that spec is still authoritative for the shape; only the URL changes. Don't enumerate with `list-specs`.
- **Web:** https://docs.tatum.io/docs/rpc-nodes and https://docs.tatum.io/docs/supported-blockchains
