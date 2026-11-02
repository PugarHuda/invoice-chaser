# Transactions API

## What it is

Tatum Data API surface for **transaction-level history and lookups**: address tx history, single tx by hash, internal/trace transactions, transaction "DNA" (semantic fingerprint), block primitives, mempool visibility.

## When to use

- Show an address's transaction history — replaces walking `eth_getLogs` or paging a block range.
- Look up one transaction by hash with normalised cross-chain fields.
- Fetch internal (trace) transfers for an EVM address — internal calls that don't appear in the top-level tx list.
- Get a transaction's "DNA" — a derived semantic fingerprint (intent classification, protocol attribution).
- Pull block primitives: current height, block by height/hash, hash by height, block-by-timestamp.
- Inspect mempool pending tx hashes (chains that support it).
- UTXO-chain history endpoints (single address + batch).

## Key concepts

- **Indexer replacement:** these endpoints exist so you don't have to run your own block indexer. One call returns what would be hundreds of RPC pages.
- **DNA vs raw tx:** raw tx tells you "address A called function F with value V". DNA layers semantic interpretation ("this was a Uniswap V3 swap of token X for token Y"). Pick DNA only when you need the labelled intent.
- **Block-by-time** answers "what block was mined at this UTC timestamp?" — useful for snapshotting balances or events at a moment.
- **Mempool support varies by chain.** Confirm support via MCP before promising real-time pending tx to a customer.
- **For real-time current state**, prefer RPC. Data API has indexer lag.

## Relates to

- [rpc-nodes](../rpc/rpc-nodes.md) — when you need real-time / chain-specific tx shape that Data API doesn't normalise.
- Also: [wallet-api.md](wallet-api.md), [defi-api.md](defi-api.md)

## Get the details

- **tatum-docs MCP:** paths `/v4/data/transaction*`, `/v4/data/blockchains/transaction*`, `/v4/data/blockchains/block*`, `/v4/data/blockchains/mempool`, `/v4/data/block/time`.
- **Guides:** `search "transaction history wallet"`, `fetch tatumdocs/get-all-transactions-on-the-wallet`.
- **Web:** https://docs.tatum.io/reference/transactions-api
