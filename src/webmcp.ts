// WebMCP (webmachinelearning.github.io/webmcp): the open page exposes its read actions to an AI agent
// running in the browser. Same data as the server MCP tools, through the same public API.
// Feature-detected: browsers without document/navigator.modelContext skip this entirely.
type Tool = { name: string; description: string; inputSchema: object; annotations?: object; execute: (input: Record<string, string>) => Promise<unknown> };
type ModelContext = { registerTool: (tool: Tool, opts?: { signal?: AbortSignal }) => unknown };

const api = async (path: string) => {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
// WebMCP execute() resolves to any value and the browser serializes it: return the object, not an MCP text envelope
const text = (data: unknown) => data;
const id = (desc: string) => ({ type: 'object', properties: { id: { type: 'string', description: desc, pattern: '^[A-Za-z0-9_-]{1,64}$' } }, required: ['id'] });
const RO = { readOnlyHint: true };
// memory text originates from clients: flag it so the agent treats it as data, not instructions
const RO_UNTRUSTED = { readOnlyHint: true, untrustedContentHint: true };

export function registerWebMcp(payOnly: string | null) {
  const mc = (document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (!mc?.registerTool) return () => {};
  const ctl = new AbortController();
  const tools: Tool[] = [
    { name: 'get_invoice_terms', description: 'Exact USDC amount, payee, sui:pay URI and status of an invoice, plus the MPP and x402 endpoints an agent can pay it through.', inputSchema: id('Invoice id, e.g. inv-101'), annotations: RO,
      execute: async ({ id: inv }) => text({ ...(await api(`/api/chaser/pay/${encodeURIComponent(inv)}`)), agentEndpoints: { mpp: `/api/chaser/mpp/${inv}`, x402: `/api/chaser/x402/${inv}`, live: `/api/chaser/pay/${inv}/live` } }) },
    { name: 'open_pay_page', description: 'Show the payer-facing page of an invoice in this tab.', inputSchema: id('Invoice id'),
      execute: async ({ id: inv }) => { window.location.search = `?pay=${encodeURIComponent(inv)}`; return text({ opened: inv }); } },
  ];
  // the owner dashboard (not a bare pay link) also exposes what the app learned
  if (!payOnly) tools.push(
    { name: 'list_invoices', description: 'All invoices with status, amount owed and due date.', inputSchema: { type: 'object', properties: {} }, annotations: RO, execute: async () => text(await api('/api/chaser/invoices')) },
    { name: 'client_profile', description: 'What Invoice Chaser learned about a client from Walrus Memory: typical delay, best reminder tone, rules it obeys.', inputSchema: id('Client id, e.g. c1'), annotations: RO_UNTRUSTED,
      execute: async ({ id: c }) => text(await api(`/api/chaser/clients/${encodeURIComponent(c)}`)) },
    { name: 'search_client_memory', description: "Semantic search (Walrus Memory recall) over one client's memories.", inputSchema: { type: 'object', properties: { id: { type: 'string' }, query: { type: 'string', minLength: 2, maxLength: 200 } }, required: ['id', 'query'] }, annotations: RO_UNTRUSTED,
      execute: async ({ id: c, query }) => text(await api(`/api/chaser/clients/${encodeURIComponent(c)}/search?q=${encodeURIComponent(query)}`)) },
  );
  for (const t of tools) {
    try { Promise.resolve(mc.registerTool(t, { signal: ctl.signal })).catch(() => {}); } catch { /* a browser with an older draft shape: skip that tool */ }
  }
  return () => ctl.abort();
}
