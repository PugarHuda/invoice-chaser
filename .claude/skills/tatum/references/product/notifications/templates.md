# Templates

## What it is

Controls the shape of the webhook payload Tatum delivers. Pick a built-in template, or create a custom one to match a fixed downstream schema or a plain-text alerting channel. Currently available on EVM + TRON.

## When to use

- Default body shape doesn't match the downstream system's expected schema
- Downstream consumer wants a single-line string (Slack, SMS, plain logs)
- Need raw on-chain data alongside the structured/enriched fields
- Want consistent field names across multiple downstream pipelines

## Key concepts

- **Built-in templates:** Tatum provides a small set, including a recommended structured/enriched format and a legacy format used when no template is specified. Pick one by setting `templateId` on a subscription.
- **Custom templates — two formats:**
  - **String format:** handlebar-style interpolation, produces a single string per webhook (ideal for Slack/SMS).
  - **JSON format:** maps custom field names to Tatum-provided properties (ideal for fixed downstream schemas).
- **Default template per API key:** the API-key-level default applies when a subscription is created without an explicit `templateId`.
- **Lifecycle:** create, list, update, delete custom templates; read/update the per-key default.

## Relates to

- [subscriptions.md](subscriptions.md) — `templateId` is set when creating or updating a subscription.
- Also: [webhooks.md](webhooks.md)

## Get the details

- **tatum-docs MCP:** search `"notification template"`, `"enriched template"`, or follow the templates reference linked from the create-subscription guide.
- **Templates API:** `search-endpoints "notification template"`, or `list-endpoints "Blockchain Notifications"` (~240 tok). `get-endpoint` for the template schema and the interpolatable property names.
- **Web:** https://docs.tatum.io/reference/createnotificationtemplate
