# Examples

End-to-end walkthroughs showing how to use this skill against real customer prompts. Each example follows: user prompt → matched usecase → product picks → MCP calls → outcome.

## Example 1 — Hybrid setup with a third-party provider

**User says:** "We already pay for one Ethereum RPC node from another vendor, but we want Tatum to manage failover with Tatum's own nodes. Can Tatum do that?"

**Match:** [usecases/hybrid-infrastructure.md](usecases/hybrid-infrastructure.md).

**Products:** [custom-gateways](product/rpc/custom-gateways.md) + [byo-rpc](product/rpc/byo-rpc.md) + [powerups](product/rpc/powerups.md) (Endpoint Health Monitor).

**Steps agent describes:**
1. Create a Custom Gateway for Ethereum.
2. Add the third-party endpoint via BYO-RPC (chain, URL, optional auth headers).
3. Test endpoint via the management API's test endpoint before routing traffic.
4. Add Tatum's Ethereum RPC node as a secondary endpoint.
5. Set routing strategy to Priority Failover with the third-party primary, Tatum as fallback.
6. Enable Endpoint Health Monitor PowerUp.

**MCP calls agent should make:**
- `list-endpoints "GATEWAY MANAGE API"` (~170 tok) for the gateway + endpoint creation routes.
- `search "bring your own rpc"` for endpoint field details.

**Outcome:** Agent walks user through the hybrid setup conceptually and tells them which MCP endpoints handle each step. Agent does NOT inline POST bodies, header schemas, or routing config JSON — those come from MCP.

## Example 2 — Real-time deposit notifications + RPC hydration

**User says:** "Notify me whenever a specific user wallet receives USDC on Ethereum, and store the full transaction (logs, sender, gas) for our audit log."

**Match:** [usecases/address-activity-tracking.md](usecases/address-activity-tracking.md) — cross-product (notifications signal + RPC hydration).

**Products:** [notifications/subscriptions](product/notifications/subscriptions.md), [notifications/webhooks](product/notifications/webhooks.md), [rpc/gateway](product/rpc/gateway.md), [rpc/rpc-nodes](product/rpc/rpc-nodes.md).

**Steps agent describes:**
1. Create an incoming-fungible subscription with a USDC `contractAddress` filter on the user's wallet.
2. Pick the low-latency finality tier for fast UX.
3. In the webhook handler, verify HMAC `x-payload-hash`, then credit the user balance keyed by `txId` for idempotency.
4. Call RPC through the gateway to fetch the full tx receipt for audit.
5. Periodically inspect webhook history; replay any failed deliveries.

**MCP calls agent should make:**
- `list-endpoints "Blockchain Notifications"` (~240 tok) to surface subscription + webhook routes.
- `get-endpoint` on the create-subscription route for the exact request schema of the incoming-fungible type — required fields, condition shape, finality enum.
- `search-endpoints "eth_getTransactionReceipt"` → the chain-specific spec title + path.
- `get-endpoint` for the RPC method shape.
- `search "authenticating notification webhooks"` for HMAC verification details.

**Outcome:** Agent walks user through subscription → handler → RPC hydration conceptually. Agent does NOT inline subscription type identifiers, condition payload shapes, RPC method bodies, or HMAC pseudocode beyond the high-level steps — those come from MCP.

## Example 3 — Multi-chain portfolio dashboard

**User says:** "I'm building a dashboard that shows a wallet's full portfolio — native coin, fungible tokens, NFTs — across Ethereum, Polygon, and BSC, with USD valuations."

**Match:** [usecases/wallet-portfolio-and-balances.md](usecases/wallet-portfolio-and-balances.md).

**Products:** [data/wallet-api](product/data/wallet-api.md), [data/exchange-rate-api](product/data/exchange-rate-api.md), [data/nft-api](product/data/nft-api.md) (for collection-level enrichment).

**Steps agent describes:**
1. One call to `/v4/data/wallet/portfolio` for the address — returns native + fungible + NFT across supported chains.
2. Collect contract addresses from the portfolio response; batch them into `/v4/data/rate/contract/batch` for USD rates.
3. Multiply quantities × rates for USD valuation.
4. For NFT-heavy wallets, supplement with `/v4/data/nft/balances` + `/v4/data/multitoken/balances` to surface collection + metadata fields.

**MCP calls agent should make:**
- `search-endpoints "wallet portfolio"` then `search-endpoints "rate contract batch"` (~240 tok each, vs ~2.1k to list the whole Data spec).
- `get-endpoint GET /v4/data/wallet/portfolio` and `POST /v4/data/rate/contract/batch` for exact params.

**Outcome:** Agent walks user through the indexer-replacement flow conceptually and routes API specifics to MCP. Does NOT inline JSON bodies or chain enums.

## Example 4 — Hydrate a webhook with portfolio context

**User says:** "When this address receives any token, give me the wallet's updated full token + NFT portfolio so I can refresh the user's dashboard server-side."

**Match:** [usecases/address-activity-tracking.md](usecases/address-activity-tracking.md) extended with Data API hydration (cross-product).

**Products:** [notifications/subscriptions](product/notifications/subscriptions.md), [notifications/webhooks](product/notifications/webhooks.md), [data/wallet-api](product/data/wallet-api.md).

**Steps agent describes:**
1. Create the narrowest address-scoped incoming-transfer subscription on the wallet via [notifications/subscriptions](product/notifications/subscriptions.md); get the type identifier from MCP.
2. Webhook handler verifies HMAC, extracts the address.
3. Call `/v4/data/wallet/portfolio` for the address — single normalised response, no per-chain loop.
4. Push the refreshed portfolio to your dashboard via WebSocket or cache invalidation.

**Why Data API beats RPC here:** dashboard wants a normalised cross-chain rollup; RPC would mean many per-chain calls + manual aggregation. Data API delivers in one call.

**MCP calls agent should make:**
- `list-endpoints "Blockchain Notifications"` (~240 tok); for Data use `search-endpoints` instead of listing (~2.1k).
- `get-endpoint GET /v4/data/wallet/portfolio` for the response shape.

**Outcome:** Agent picks Data API over RPC for hydration when normalisation > raw shape, and routes specifics to MCP.
