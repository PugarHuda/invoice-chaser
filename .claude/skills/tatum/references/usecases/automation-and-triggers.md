# Automation and triggers

**Products:** [notifications/subscriptions](../product/notifications/subscriptions.md), [notifications/webhooks](../product/notifications/webhooks.md), [notifications/templates](../product/notifications/templates.md)

## Problem

User wants on-chain activity to automatically trigger a downstream action — release escrow, send a receipt, update inventory, page on-call, kick off a workflow. Webhooks are the trigger; the rest is your service.

## Recommended approach

- **Step 1:** Pick the narrowest subscription type that matches the trigger event — see [real-time-event-monitoring](real-time-event-monitoring.md).
- **Step 2:** Add `conditions` so only actionable events fire the webhook (e.g. payment ≥ invoice amount, transfer of a specific NFT). Saves cost and downstream load.
- **Step 3:** Choose a [template](../product/notifications/templates.md) that matches the downstream consumer's expected shape — enriched for general use, custom JSON for fixed schemas, custom string for Slack/SMS.
- **Step 4:** In the handler, verify HMAC, then execute the downstream action. Make it idempotent.

## Decision points

- **Payment confirmation?** Use an incoming-native or incoming-fungible subscription with a minimum-amount filter → mark invoice paid → email receipt.
- **NFT mint alert?** Use a contract-log subscription matching `Transfer(from=0x0, …)` → notify channel.
- **Failed payment recovery?** Use an outgoing-failed subscription on the treasury wallet → re-queue job → page on-call if persistent.
- **Settlement-grade trigger (release goods, finalize escrow)?** Pick the settlement-grade finality tier on the subscription. EVM + TRON only.
- **Slack/SMS as downstream?** Custom string template → handler just forwards the body, no field mapping needed.
- **Need synchronous block-on-result?** Webhooks are the wrong tool — they're fire-and-forget. Use RPC + your own consumer for synchronous needs.

## Anti-patterns

- Don't act on webhook payloads without HMAC verification — anyone can POST to your URL.
- Don't make handlers non-idempotent. Webhooks may be replayed (manual retry, transient delivery failures). Key downstream actions by `txId + subscriptionId`.
- Don't bake business logic into the template — keep templates as shape-shifters, not filters. Use `conditions` for filtering.
- Don't subscribe to broad event families and filter downstream — pick the narrower type.

## Next steps

→ Read [notifications/subscriptions](../product/notifications/subscriptions.md), [notifications/templates](../product/notifications/templates.md), [real-time-event-monitoring](real-time-event-monitoring.md).
→ Query `tatum-docs` MCP for setup + endpoint specs:
  - `list-endpoints "Blockchain Notifications"` (~240 tok) → subscription + template routes
  - `get-endpoint` → exact request schemas per subscription type and per template format
