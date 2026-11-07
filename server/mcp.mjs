// MCP server: lets Claude, Cursor or any MCP agent read what Invoice Chaser has learned.
// Stateless Streamable HTTP (a fresh server per request) so it runs on serverless. Read-only tools.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], ...(obj && typeof obj === 'object' ? { structuredContent: Array.isArray(obj) ? { items: obj } : obj } : {}) })
// errors carry text only: structuredContent would be validated against the success schema
const fail = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], isError: true })
// local derived state: closed world; only the Walrus recall search reaches out
const RO = { readOnlyHint: true, openWorldHint: false }
const RO_OPEN = { readOnlyHint: true, openWorldHint: true }
// outputSchema: clients get a declared shape for structuredContent (the SDK validates every result against it).
// Declared as passthrough objects: a raw shape becomes additionalProperties:false and strict clients reject extra fields.
const loose = (shape) => z.object(shape).passthrough()
const step = loose({ date: z.string(), tone: z.string(), reason: z.string() })
const OUT = {
  list: loose({ items: z.array(loose({ invoice: z.string(), client: z.string(), owedUsdc: z.string(), due: z.string(), status: z.string(), predictedPayDate: z.string().nullable(), nextReminder: step.nullable() })) }),
  profile: loose({ client: loose({ id: z.string(), name: z.string() }), profile: loose({ ewmaDelayDays: z.number(), totalPaidInvoices: z.number(), bestTone: z.string(), confidence: z.number() }) }),
  plan: loose({ type: z.string(), predictedPayDate: z.string().nullable(), steps: z.array(step), memoriesUsed: z.array(z.string()) }),
  search: loose({ items: z.array(z.object({}).passthrough()) }),
  terms: loose({ payTo: z.string(), amount: z.string(), asset: z.string(), network: z.string(), payPage: z.string(), protocols: z.object({}).passthrough() }),
}

/** deps: { state, profileOf, plan, owed, statusOf, search, terms, learning, memories, aggregator, baseUrl } */
function build(deps) {
  const s = new McpServer({ name: 'invoice-chaser', version: '1.0.0' })
  const findInvoice = (id) => deps.state().invoices.find((i) => i.id === id)
  const findClient = (id) => deps.state().clients.find((c) => c.id === id)
  const nameOf = (id) => findClient(id)?.name || id

  s.registerTool('list_open_invoices', { title: 'Open invoices', description: 'Unpaid or partially paid USDC invoices with what is owed, the predicted pay date and the next planned reminder.', inputSchema: {}, outputSchema: OUT.list, annotations: RO }, async () =>
    text(deps.state().invoices.filter((i) => i.status !== 'paid' && !(i.seed && i.status === 'partial')).map((i) => {
      const p = deps.plan(i, deps.profileOf(i.clientId))
      const today = new Date().toISOString().slice(0, 10)
      // same view as the dashboard: derived status (overdue) and the next reminder still ahead
      return { invoice: i.id, client: nameOf(i.clientId), clientId: i.clientId, owedUsdc: deps.owed(i), due: i.dueDate, status: deps.statusOf(i), predictedPayDate: p.predictedPayDate, nextReminder: p.steps.find((s) => s.date >= today) || null, terms: i.terms || null }
    })))

  s.registerTool('client_profile', { title: 'Learned client profile', description: 'What Invoice Chaser learned about a client from Walrus Memory: typical delay, reminders needed, best tone, underpay rate, rules, expected payer, prediction history.', inputSchema: { clientId: z.string().describe('client id, e.g. c1') }, outputSchema: OUT.profile, annotations: RO }, async ({ clientId }) => {
    const c = findClient(clientId)
    if (!c) return fail({ error: `unknown client ${clientId}`, clients: deps.state().clients.map((x) => ({ id: x.id, name: x.name })) })
    const { evidence, ...p } = deps.profileOf(clientId)
    return text({ client: c, profile: p })
  })

  s.registerTool('plan_reminder', { title: 'Reminder plan', description: 'The memory-driven reminder plan for an invoice (or the default plan with ignoreMemory) and the memories it cites.', inputSchema: { invoiceId: z.string(), ignoreMemory: z.boolean().optional() }, outputSchema: OUT.plan, annotations: RO }, async ({ invoiceId, ignoreMemory }) => {
    const i = findInvoice(invoiceId)
    if (!i) return fail({ error: `unknown invoice ${invoiceId}` })
    return text(deps.plan(i, deps.profileOf(i.clientId), { ignoreMemory: Boolean(ignoreMemory) }))
  })

  s.registerTool('search_client_memory', { title: 'Search client memory', description: "Semantic search (Walrus Memory recall) over one client's memories, e.g. 'when do they usually pay?'.", inputSchema: { clientId: z.string(), query: z.string().min(2).max(200), mode: z.enum(['relevance', 'recent', 'weighted']).optional().describe('relevance = closest by meaning (default), recent = newest among matches, weighted = meaning blended with recency') }, outputSchema: OUT.search, annotations: RO_OPEN }, async ({ clientId, query, mode }) => {
    if (!findClient(clientId)) return fail({ error: `unknown client ${clientId}` })
    return text(await deps.search(clientId, query, mode))
  })

  s.registerTool('payment_terms', { title: 'How to pay an invoice', description: 'Payment terms (Sui USDC, Payment Kit registry + nonce), the sui:pay URI, the human pay link, and the agent endpoints: x402 v1/v2, MPP and the live payment stream.', inputSchema: { invoiceId: z.string() }, outputSchema: OUT.terms, annotations: RO }, async ({ invoiceId }) => {
    const i = findInvoice(invoiceId)
    if (!i) return fail({ error: `unknown invoice ${invoiceId}` })
    const api = `${deps.baseUrl}/api/chaser`
    return text({
      ...deps.terms(i),
      payPage: `${deps.baseUrl}/?pay=${i.id}`,
      // every way an agent can settle this invoice, all verified through Tatum and remembered in Walrus
      protocols: {
        x402v1: { url: `${api}/x402/${i.id}`, flow: 'retry with X-PAYMENT: base64 { x402Version: 1, scheme: exact, network, payload: { signature, transaction } } (or a digest you already executed)' },
        x402v2: { url: `${api}/x402/${i.id}`, flow: 'read PAYMENT-REQUIRED, send PAYMENT-SIGNATURE with the signed unexecuted Payment Kit transaction; server simulates and broadcasts' },
        mpp: { url: `${api}/mpp/${i.id}`, flow: 'WWW-Authenticate: Payment challenge, pay, retry with Authorization: Payment <credential>' },
        live: { url: `${api}/pay/${i.id}/live`, flow: 'Server-Sent Events: watching, seen, paid (Tatum gRPC checkpoint stream)' },
      },
      x402: `${api}/x402/${i.id}`,
    })
  })

  // Walrus Memory as MCP resources: every client's memories, each with its Walrus blob id
  s.registerResource('client_memories', new ResourceTemplate('invoice-chaser://clients/{clientId}/memories', {
    list: async () => ({ resources: deps.state().clients.map((c) => ({ uri: `invoice-chaser://clients/${c.id}/memories`, name: `${c.name}: Walrus memories`, mimeType: 'application/json' })) }),
  }), { title: 'Client memories (Walrus)', description: 'Every memory Invoice Chaser holds about one client: the sentence, its event type, when, and the Walrus blob that stores it (SEAL-encrypted).', mimeType: 'application/json' }, async (uri, { clientId }) => {
    const c = findClient(String(clientId))
    // resource not found = invalid params (-32602, the code the 2026-07-28 spec settles on), not an internal error
    if (!c) throw new McpError(ErrorCode.InvalidParams, `unknown client ${clientId}`)
    const items = deps.memories(c.id).map((m) => ({ at: m.timestamp, type: m.tag?.type || 'note', sentence: m.sentence, blobId: m.blobId || null, walrus: m.blobId ? `${deps.aggregator}/v1/blobs/${m.blobId}` : null }))
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ client: { id: c.id, name: c.name }, count: items.length, memories: items }, null, 2) }] }
  })

  // a ready-made prompt: chase one invoice with the plan and the memories it rests on
  s.registerPrompt('chase_invoice', { title: 'Chase an invoice', description: 'Draft the next reminder for an invoice from its memory-driven plan and cited Walrus memories.', argsSchema: { invoiceId: z.string() } }, ({ invoiceId }) => {
    const i = findInvoice(invoiceId)
    if (!i) throw new Error(`unknown invoice ${invoiceId}`)
    const p = deps.plan(i, deps.profileOf(i.clientId))
    const next = p.steps.find((x) => x.date >= new Date().toISOString().slice(0, 10)) || p.steps.at(-1)
    return { messages: [{ role: 'user', content: { type: 'text', text: [
      `Draft a ${next?.tone || 'friendly'} payment reminder to ${nameOf(i.clientId)} for invoice ${i.id}: ${deps.owed(i)} USDC, due ${i.dueDate}, pay link ${deps.baseUrl}/?pay=${i.id}.`,
      `Planned for ${next?.date || 'now'}: ${next?.reason || ''}`,
      'What the memory says (cite nothing else, mention no predictions or scores):',
      ...p.memoriesUsed.map((m) => `- ${m}`),
      ...(p.cites || []).slice(0, 6).map((c) => `- ${c.sentence}${c.blobId ? ` [Walrus ${c.blobId}]` : ''}`),
    ].join('\n') } }] }
  })

  // an agent can check the memory it reads is true before relying on it: every payment memory re-checked on Sui
  s.registerTool('memory_chain_audit', { title: 'Audit memory against the chain', description: 'Two-way reconciliation of Walrus Memory and Sui through Tatum: every payment memory (digest, USDC amount, checkpoint) re-checked with BatchGetTransactions, and every USDC transfer to the payee in the last 30 days (ListTransactions) that no memory records.', inputSchema: {}, outputSchema: loose({ verified: z.number(), withTransaction: z.number(), mismatched: z.array(z.object({}).passthrough()), service: z.string() }), annotations: RO_OPEN }, async () => text(await deps.audit()))

  s.registerTool('verify_payment', { title: 'Check a payment digest', description: 'A client says "we paid, here is the tx". Checks the digest on Sui through Tatum (success, USDC that reached the payee, checkpoint, sender and its SuiNS name) and whether Walrus Memory already records it, and for which invoice.', inputSchema: { digest: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/).describe('Sui transaction digest (base58)') }, outputSchema: loose({ digest: z.string(), verdict: z.string(), chain: z.object({}).passthrough(), memory: z.array(z.object({}).passthrough()) }), annotations: RO_OPEN }, async ({ digest }) => text(await deps.verifyPayment(digest)))

  s.registerTool('payer_readiness', { title: 'Can the payer pay now?', description: "The wallet this client pays from (learned from Walrus Memory: the owner's rule, a wallet the client proved by signing, or the last payment), read live on Sui through Tatum ListBalances: USDC and SUI on hand and whether it covers what is owed. Chase a payer who can pay; wait for one who can't.", inputSchema: { invoiceId: z.string() }, annotations: RO_OPEN }, async ({ invoiceId }) => {
    const inv = findInvoice(invoiceId)
    if (!inv) return fail({ error: `unknown invoice ${invoiceId}` })
    return text((await deps.payerReadiness(inv)) || { invoice: invoiceId, note: 'no known payer wallet for this client yet, or the invoice is paid' })
  })

  s.registerTool('chase_queue', { title: 'Who to chase today', description: "Every open invoice ranked chase_now / nudge / wait / scheduled, joining what Walrus Memory learned about the client (delay spread, promises kept, underpayment) with the payer wallet live on Sui through Tatum (USDC on hand vs owed, last activity, USDC sent to others this week). Each line lists its reasons from both sides.", inputSchema: {}, outputSchema: loose({ counts: z.object({}).passthrough(), items: z.array(loose({ invoiceId: z.string(), action: z.string(), why: z.array(z.string()) })) }), annotations: RO_OPEN }, async () => text(await deps.chaseQueue()))

  s.registerTool('client_statement', { title: 'Statement of account', description: "One client's statement: every invoice and payment from Walrus Memory, each payment re-proven on Sui through Tatum BatchGetTransactions (verified / not found / amount mismatch), with explorer and Walrus blob links and invoiced/paid/outstanding totals.", inputSchema: { clientId: z.string() }, annotations: RO_OPEN }, async ({ clientId }) => {
    const st = await deps.statement(clientId)
    return st ? text(st) : fail({ error: `unknown client ${clientId}` })
  })

  s.registerTool('chain_facts', { title: 'Sui facts via Tatum', description: 'What the app checked on Sui through Tatum gRPC before trusting it: chain id, epoch, gas price, the USDC coin metadata, the Payment Kit Move function and package versions, plus how many gRPC calls this instance made per service.', inputSchema: {}, annotations: RO_OPEN }, async () => text(await deps.chain()))

  s.registerTool('learning_summary', { title: 'Is it learning?', description: "Mean prediction error on each client's first invoice vs their latest, across the whole book.", inputSchema: {}, annotations: RO }, async () => text(deps.learning() || { note: 'needs a client with 2+ paid invoices' }))
  return s
}

export function mcpHandler(makeDeps) {
  return async (req, res) => {
    const deps = makeDeps(req)
    const server = build(deps)
    // MCP 2025-11-25 transports: a browser Origin other than our own gets 403 (DNS rebinding); server-side clients send none
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedOrigins: [deps.baseUrl] })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }
}
