# Identity and name resolution

**Products:** [data/web3-name-service-api](../product/data/web3-name-service-api.md), [data/wallet-api](../product/data/wallet-api.md), [data/malicious-address-api](../product/data/malicious-address-api.md)

## Problem

User types a Web3 name (`vitalik.eth`, `name.crypto`, `name.sol`, …) — your app needs the address to display the portfolio, route a payment, or perform a risk check. Per-registry integrations don't scale; one resolver does.

## Recommended approach

- **Step 1:** Resolve via the **name resolution** capability in [web3-name-service-api](../product/data/web3-name-service-api.md). One call, name → address, across supported name systems.
- **Step 2:** Validate the resolved address before any high-value action — fetch the **wallet reputation** capability in [wallet-api](../product/data/wallet-api.md) and / or run a malicious-address check via [malicious-address-api](../product/data/malicious-address-api.md).
- **Step 3:** For UI, fetch the **wallet portfolio** capability in [wallet-api](../product/data/wallet-api.md) and display.
- **Step 4:** Re-resolve at action time. Names can expire / transfer between display and send.

## Decision points

- **Is the name system you need supported?** Confirm via MCP — coverage varies.
- **Reverse lookup** (address → name)? Support varies by registry. Check the endpoint schema.
- **Resolved to a contract address** (multisig, vault)? Treat differently — confirm via portfolio + reputation that the resolution matches user expectation.

## Anti-patterns

- Don't cache resolution forever — names change ownership and can expire.
- Don't send to a resolved address without re-resolving at submission time for high-value flows.
- Don't try to register / renew a name through Data API — that's an on-chain transaction, out of scope here.

## Next steps

→ Read [data/web3-name-service-api](../product/data/web3-name-service-api.md).
→ Query `tatum-docs` MCP:
  - `get-endpoint` `GET /v4/data/ns/name` — supported name systems, reverse-lookup availability.
