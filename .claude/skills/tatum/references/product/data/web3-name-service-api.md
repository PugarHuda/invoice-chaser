# Web3 Name Service API

## What it is

Tatum Data API surface for **resolving Web3 names to addresses**. Single endpoint normalises across ENS and equivalent name systems on other chains, so a UI doesn't integrate per registry.

## When to use

- User pastes a `.eth` (or `.crypto`, `.sol`, `.tez`, …) name; resolve it to the on-chain address before sending.
- Display a friendly name where you only have the hex address (when supported).
- Build a "send to name" UX — name resolution happens server-side, away from wallet code.

## Key concepts

- **One endpoint, multiple systems.** Pass the name; the resolver figures out the registry and returns the address. Supported name systems and reverse-lookup support vary — check via MCP before promising it.
- **Resolution is not stable forever.** Names can be renewed, transferred, or expire. Re-resolve when high-value actions hinge on the result.
- **Resolution ≠ ownership of funds.** The resolved address may be a smart contract (multisig, vault) — confirm with [wallet-api.md](wallet-api.md) reputation / portfolio before treating as a personal wallet.
- **No registration / management.** This is a read-only resolver. Registering an ENS name is a wallet/transaction operation — out of scope for this skill.

## Relates to

- Also: [wallet-api.md](wallet-api.md), [malicious-address-api.md](malicious-address-api.md)

## Get the details

- **tatum-docs MCP:** `GET /v4/data/ns/name`. Confirm supported name systems via the schema.
- **Web:** https://docs.tatum.io/reference/web3-name-service
