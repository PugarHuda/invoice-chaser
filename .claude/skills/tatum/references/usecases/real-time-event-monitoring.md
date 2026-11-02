# Real-time event monitoring

**Products:** [notifications/subscriptions](../product/notifications/subscriptions.md), [notifications/webhooks](../product/notifications/webhooks.md), [notifications/templates](../product/notifications/templates.md)

## Problem

User wants a push notification when something happens on chain — a transfer, a contract event, a failed tx — instead of polling. The narrower the trigger, the lower the cost and the lower the noise.

## Recommended approach

- **Step 1:** Identify the event family. Match user intent to a subscription scope and type — see [subscriptions](../product/notifications/subscriptions.md) for the scope model.
- **Step 2:** Pick the narrowest type that matches. Narrower = cheaper to process, less noise.
- **Step 3:** Create the subscription with `chain`, scope identifiers (`address` or `contractAddress + event`), and a webhook `url`.
- **Step 4:** Verify webhook authenticity in the handler — see [webhooks](../product/notifications/webhooks.md) for HMAC.
- **Step 5:** Process the payload.

## Decision points

- **Watch one wallet, all activity** → address-scoped, address-event type.
- **Watch one wallet, only deposits** → address-scoped, incoming-native and/or incoming-fungible type.
- **Watch a contract for a specific event** (e.g. ERC-20 `Transfer`) → contract-scoped, contract-log type with the event signature hash.
- **Watch a whole chain for failed txs** → block-scoped, failed-txs-per-block type.
- **Want to filter further?** Add `conditions` (amount, contract, sender, recipient, token metadata) — AND-logic. EVM + TRON only. See [subscriptions](../product/notifications/subscriptions.md).
- **Need low-latency vs settlement guarantees?** Pick the appropriate finality tier on the subscription. EVM + TRON only.
- **Body shape doesn't match downstream?** Use the recommended enriched template or create a custom one — see [templates](../product/notifications/templates.md).

## Anti-patterns

- Don't subscribe with the broadest type and filter in your handler — pick the narrower subscription type. Cheaper, less noise.
- Don't skip HMAC verification — webhooks are public POSTs to your URL.
- Don't assume body shape — it depends on the chosen template. Probe via MCP before writing the handler.

## Next steps

→ Read [notifications/subscriptions](../product/notifications/subscriptions.md) and [notifications/webhooks](../product/notifications/webhooks.md).
→ Query `tatum-docs` MCP for setup + endpoint specs:
  - `list-endpoints "Blockchain Notifications"` (~240 tok) → subscription + webhook routes
  - `get-endpoint` → exact request schema for the chosen subscription type
