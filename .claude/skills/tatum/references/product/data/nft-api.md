# NFT API

## What it is

Tatum Data API surface for **non-fungible and multi-token assets** (ERC-721 and ERC-1155 equivalents across chains). Normalised access to balances, ownership, collection contents, and metadata.

## When to use

- List the NFTs (ERC-721) or multi-tokens (ERC-1155) held by a wallet across supported chains.
- Enumerate a collection's tokens (every `tokenId` minted under one contract).
- Resolve the current owner of a specific `tokenId`.
- Pull metadata (name, image, attributes, traits) for one or many tokens.

## Key concepts

- **Three identifiers compose:** `chain` + `contractAddress` (= collection) + `tokenId` (= specific NFT). NFT balances need all three; collection enumeration needs the first two.
- **NFT vs multi-token:** ERC-721 = unique, balance always 0 or 1 per tokenId. ERC-1155 = multi-token, balance can be > 1 and one contract holds multiple distinct `tokenId`s. Separate endpoints; don't reuse balances across them.
- **Metadata sources vary:** on-chain (rare), tokenURI → HTTP/IPFS (common). Data API resolves and caches; expect lag on fresh mints, occasional missing fields when off-chain hosts are unreachable.
- **Collections endpoint** enumerates the token IDs inside a contract; for a single owner's view, use the per-wallet balance endpoints instead.
- **Out of scope (any Tatum skill):** minting, transferring, or programmatically issuing NFTs. This is read-side only.

## Relates to

- [token-api.md](token-api.md) — fungible counterpart. Some endpoints (`/owners`, `/metadata`) serve both surfaces depending on params.
- Also: [wallet-api.md](wallet-api.md)

## Get the details

- **tatum-docs MCP:** paths `/v4/data/nft`, `/v4/data/multitoken`, `/v4/data/collections`, `/v4/data/metadata`, `/v4/data/owners`. Use `get-endpoint` per path for required params and per-chain support.
- **Guides:** `search "nft api"`, `fetch tatumdocs/get-all-nfts-the-wallet-holds`.
- **Web:** https://docs.tatum.io/reference/nft-api
