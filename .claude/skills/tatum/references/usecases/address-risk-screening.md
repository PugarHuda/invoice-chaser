# Address risk screening

**Products:** [data/malicious-address-api](../product/data/malicious-address-api.md), [data/wallet-api](../product/data/wallet-api.md), [notifications/subscriptions](../product/notifications/subscriptions.md)

## Problem

User wants to gate transfers — pre-send check on a counterparty, pre-receive check on inbound deposits, or batch compliance review of historic addresses. The signal must be more than a guess but doesn't require enterprise sanctions tooling.

## Recommended approach

- **Step 1:** Hard check first. Call the **malicious-address lookup** capability in [malicious-address-api](../product/data/malicious-address-api.md). If flagged, block / hold / escalate.
- **Step 2:** If not flagged, fetch reputation via the **wallet reputation** capability in [wallet-api](../product/data/wallet-api.md). Reputation is graded — apply your own threshold.
- **Step 3:** For high-risk flows (large value, new counterparty), compose with [transactions-api](../product/data/transactions-api.md) to inspect the counterparty's recent activity before approving.
- **Step 4 (optional, cross-product):** For "alert me when this risky address pays my wallet", use [notifications/subscriptions](../product/notifications/subscriptions.md) to set up incoming-transfer notifications with a sender-address filter.

## Decision points

- **Block vs warn?** Malicious flag = hard block. Reputation below threshold = warn + manual review. Define thresholds in your policy, not in code.
- **One-shot or recurring screening?** Recurring (compliance pipeline) needs caching to avoid re-paying for repeat addresses. Cache TTL is a policy call — reflect real risk volatility.
- **Sanctions compliance?** Data API is a signal, not a legal opinion. Layer dedicated tooling where regulation requires it.

## Anti-patterns

- Don't rely on reputation alone — the malicious flag is the hard gate.
- Don't cache "safe" verdicts indefinitely — addresses can be re-classified.
- Don't expose raw verdict reasons to end users without redaction — some category names are sensitive.

## Next steps

→ Read [data/malicious-address-api](../product/data/malicious-address-api.md), [data/wallet-api](../product/data/wallet-api.md).
→ Query `tatum-docs` MCP:
  - `get-endpoint` `GET /v3/security/address/{address}` — response category enum.
  - `get-endpoint` `GET /v4/data/wallet/reputation` — score range, signal components.
