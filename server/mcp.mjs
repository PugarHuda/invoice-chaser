// MCP server: lets Claude, Cursor or any MCP agent read what Invoice Chaser has learned.
// Stateless Streamable HTTP (a fresh server per request) so it runs on serverless. Read-only tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] })
const RO = { readOnlyHint: true, openWorldHint: true }

/** deps: { state, profileOf, plan, owed, search, terms, learning, baseUrl } */
function build(deps) {
  const s = new McpServer({ name: 'invoice-chaser', version: '1.0.0' })
  const findInvoice = (id) => deps.state().invoices.find((i) => i.id === id)
  const findClient = (id) => deps.state().clients.find((c) => c.id === id)
  const nameOf = (id) => findClient(id)?.name || id

  s.registerTool('list_open_invoices', { title: 'Open invoices', description: 'Unpaid or partially paid USDC invoices with what is owed, the predicted pay date and the next planned reminder.', inputSchema: {}, annotations: RO }, async () =>
    text(deps.state().invoices.filter((i) => i.status !== 'paid' && !(i.seed && i.status === 'partial')).map((i) => {
      const p = deps.plan(i, deps.profileOf(i.clientId))
      return { invoice: i.id, client: nameOf(i.clientId), clientId: i.clientId, owedUsdc: deps.owed(i), due: i.dueDate, status: i.status, predictedPayDate: p.predictedPayDate, nextReminder: p.steps[0] }
    })))

  s.registerTool('client_profile', { title: 'Learned client profile', description: 'What Invoice Chaser learned about a client from Walrus Memory: typical delay, reminders needed, best tone, underpay rate, rules, expected payer, prediction history.', inputSchema: { clientId: z.string().describe('client id, e.g. c1') }, annotations: RO }, async ({ clientId }) => {
    const c = findClient(clientId)
    if (!c) return { ...text({ error: `unknown client ${clientId}`, clients: deps.state().clients.map((x) => ({ id: x.id, name: x.name })) }), isError: true }
    const { evidence, ...p } = deps.profileOf(clientId)
    return text({ client: c, profile: p })
  })

  s.registerTool('plan_reminder', { title: 'Reminder plan', description: 'The memory-driven reminder plan for an invoice (or the default plan with ignoreMemory) and the memories it cites.', inputSchema: { invoiceId: z.string(), ignoreMemory: z.boolean().optional() }, annotations: RO }, async ({ invoiceId, ignoreMemory }) => {
    const i = findInvoice(invoiceId)
    if (!i) return { ...text({ error: `unknown invoice ${invoiceId}` }), isError: true }
    return text(deps.plan(i, deps.profileOf(i.clientId), { ignoreMemory: Boolean(ignoreMemory) }))
  })

  s.registerTool('search_client_memory', { title: 'Search client memory', description: "Semantic search (Walrus Memory recall) over one client's memories, e.g. 'when do they usually pay?'.", inputSchema: { clientId: z.string(), query: z.string().min(2).max(200) }, annotations: RO }, async ({ clientId, query }) => {
    if (!findClient(clientId)) return { ...text({ error: `unknown client ${clientId}` }), isError: true }
    return text(await deps.search(clientId, query))
  })

  s.registerTool('payment_terms', { title: 'How to pay an invoice', description: 'x402 payment terms (Sui USDC, Payment Kit registry + nonce), the sui:pay URI and the human pay link for an invoice.', inputSchema: { invoiceId: z.string() }, annotations: RO }, async ({ invoiceId }) => {
    const i = findInvoice(invoiceId)
    if (!i) return { ...text({ error: `unknown invoice ${invoiceId}` }), isError: true }
    return text({ ...deps.terms(i), payPage: `${deps.baseUrl}/?pay=${i.id}`, x402: `${deps.baseUrl}/api/chaser/x402/${i.id}` })
  })

  s.registerTool('learning_summary', { title: 'Is it learning?', description: "Mean prediction error on each client's first invoice vs their latest, across the whole book.", inputSchema: {}, annotations: RO }, async () => text(deps.learning() || { note: 'needs a client with 2+ paid invoices' }))
  return s
}

export function mcpHandler(makeDeps) {
  return async (req, res) => {
    const server = build(makeDeps(req))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }
}
