# Subscriptions

## What it is

Core primitive of Tatum Notifications. A subscription watches a scope on a blockchain and triggers a webhook delivery when matching events occur. Created once, then Tatum monitors continuously until cancelled.

## When to use

- Watch a wallet for incoming deposits, outgoing transfers, or all activity
- Watch a contract for a specific emitted event
- Watch a whole chain for block-level aggregates
- Replace polling-the-chain with event-driven pushes

## Key concepts

- **Scope:** address-scoped (wallet), contract-scoped (contract address + event), or block-scoped (whole chain).
- **Type:** narrows the scope to a particular activity family (native transfers, fungible tokens, NFTs, multi-token, internal/trace transfers, failed txs, paid fees, contract log events). Pick the narrowest type that matches the need.
- **Finality:** each subscription chooses a confirmation tier — low-latency vs settlement-grade. Currently available on EVM + TRON.
- **Conditions:** AND-logic filters on the webhook payload (amount, contract, sender, recipient, token metadata) cut noise before delivery. Currently available on EVM + TRON.
- **Uniqueness:** same scope + same URL = duplicate. To monitor one address with different filters, use a different webhook URL per subscription.
- **Retention:** Tatum stores delivered webhook events for a plan-tiered window.

## Relates to

- Also: [webhooks.md](webhooks.md), [templates.md](templates.md)

## Get the details

- **tatum-docs MCP:** search `"notifications"`, `"subscription types"`, `"conditions and filters"`, or fetch guide ids `tatumdocs/notifications`, `tatumdocs/notification-workflow`, `tatumdocs/notifications-conditions-and-filters`.
- **Subscription API:** `search-endpoints "subscription create"`, or `list-endpoints "Blockchain Notifications"` (~240 tok) for the full CRUD/batch/count catalog. `get-endpoint` for request schemas — they differ per subscription type.
- **Web:** https://docs.tatum.io/docs/notifications
