# Notifications troubleshooting

Verify current specifics via `tatum-docs` MCP; values change.

## Webhook handler returns 5xx; events appear lost

**Symptom:** Handler is returning 5xx (timeout, exception, downstream dep failure) and the user sees gaps in processed events.

**Cause:** Failed deliveries are not auto-retried indefinitely; they queue in the failed state and expire with the plan's retention window.

**Fix:** Use the webhook history endpoint to list failed deliveries, then the retry endpoint to replay each. Fix the underlying handler bug before mass retry (otherwise retries also fail). For events older than retention, back-fill via RPC. Query `tatum-docs` MCP `search-endpoints "webhook retry history"` for the route names.

## HMAC verification fails (`x-payload-hash` mismatch or missing)

**Symptom:** Computed HMAC-SHA512 doesn't match `x-payload-hash`, or the header is missing entirely.

**Cause:** Three common causes — (a) HMAC not enabled on the API key that created the subscription; (b) subscription was created with a different API key than the one holding the secret; (c) a proxy between Tatum and the handler is mutating the body (load balancer, WAF, JSON middleware).

**Fix:** Confirm HMAC is enabled for the active key. If the subscription pre-dates HMAC enablement, recreate it. Compute HMAC on the raw body bytes BEFORE any JSON parse / reserialize. Query `tatum-docs` MCP `fetch tatumdocs/authenticating-notification-webhooks` for the verification recipe.

## Subscription creation returns 403 with `subscription.attr.*.invalid`

**Symptom:** Creating a subscription returns 403 with an `errorCode` like `subscription.attr.currency.invalid`, `subscription.attr.interval.invalid`, or `subscription.attr.balance.invalid`.

**Cause:** The combination of subscription `type`, `chain`, and other `attr` fields is not supported. Each subscription type accepts a different chain enum (e.g. internal-trace types don't support BTC/UTXO chains; some types don't support every L2).

**Fix:** Query `tatum-docs` MCP `get-endpoint` for the create-subscription route and inspect the schema for the specific subscription type — the `chain` enum is type-specific. Pick a different `type` or `chain`.

## Conditions don't filter as expected

**Symptom:** Webhooks arrive for events that should have been filtered out by the subscription's `conditions`.

**Cause:** Three common causes — (a) conditions are EVM + TRON only; non-supported chains ignore the filter and deliver everything. (b) The `value` field uses the chain's smallest unit (wei, lamports, etc.) and must be a string; numeric or decimal forms silently fail to filter. (c) Conditions are AND-logic; to express OR you need separate subscriptions with different URLs.

**Fix:** Confirm chain support, encode amount thresholds as strings in the smallest unit, or split into multiple subscriptions. Query `tatum-docs` MCP `fetch tatumdocs/notifications-conditions-and-filters` for current field + operator semantics.
