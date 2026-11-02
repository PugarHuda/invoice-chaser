# MCP troubleshooting

Verify current specifics via `tatum-docs` MCP; values change.

## tatum-docs MCP not connected

**Symptom:** Agent cannot answer endpoint-detail questions. Says "I would need to check the docs" without acting.

**Cause:** `tatum-docs` MCP server is not configured in the user's harness.

**Fix:** Tell user to add the MCP server. Hosted at `https://docs.tatum.io/mcp`. Without it, this skill still routes to the right product but cannot resolve endpoint params.
