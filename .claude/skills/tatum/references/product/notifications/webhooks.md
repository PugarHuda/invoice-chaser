# Webhooks

## What it is

The delivery channel for subscription events. Tatum sends an HTTP POST with a JSON body to the URL configured on the subscription whenever the watched event fires.

## When to use

- Receive real-time push notifications instead of polling
- Trigger downstream automation from on-chain activity
- Audit or replay delivery history after an outage

## Key concepts

- **Delivery:** HTTP POST, JSON body. Body shape is set by the subscription's [template](templates.md).
- **Trigger:** event-driven, gated by a confirmation count that varies per chain family.
- **Source IPs:** Tatum publishes its sender IPs so you can whitelist if your endpoint is gated.
- **HMAC SHA-512 auth:** enable per API key via a `hmacSecret`. Every webhook then carries `x-payload-hash` — a Base64 HMAC-SHA512 of `JSON.stringify(body)`. Verify by recomputing and comparing.
- **Missing `x-payload-hash` after enabling HMAC** usually means the subscription was created with a different API key than the one that holds the secret.
- **Retry:** failed deliveries can be replayed manually. Only webhooks in the `failed` state are retryable.
- **History:** executed webhooks (success and failure) are listable for the plan-tiered retention window — primary recovery path for missed events.
- **Body integrity:** any proxy that rewrites the body breaks HMAC. Compute HMAC on raw bytes before any JSON parse/reserialize.

## Relates to

- Also: [subscriptions.md](subscriptions.md), [templates.md](templates.md), [troubleshooting/notifications](../../troubleshooting/notifications.md)

## Get the details

- **tatum-docs MCP:** search `"webhook"`, `"authenticating notification webhooks"`, `"webhook retry"`, or fetch guide id `tatumdocs/authenticating-notification-webhooks`.
- **Webhook API:** `search-endpoints "webhook retry history"`, or `list-endpoints "Blockchain Notifications"` (~240 tok). `get-endpoint` for error codes and state semantics.
- **Source IP list:** Tatum publishes current IPs at a stable URL — find it via the docs guide above.
- **Web:** https://docs.tatum.io/docs/authenticating-notification-webhooks
