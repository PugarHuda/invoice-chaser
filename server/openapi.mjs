// GET /openapi.json: MPP service discovery (draft-payment-discovery-01). Agents learn which
// operations are payable and how before the first request; the runtime 402 stays authoritative.
// amount is null (dynamic pricing): every invoice carries its own unique micro-USDC amount.
import * as sui from './sui.mjs'

const invoiceId = { name: 'id', in: 'path', required: true, description: 'Invoice id, e.g. inv-mw1iflmeba52e5', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } }
const json = (schema) => ({ content: { 'application/json': { schema } } })
const err = { type: 'object', properties: { error: { type: 'string' } } }
const receipt = { type: 'object', properties: { success: { type: 'boolean' }, invoice: { type: 'string' }, digest: { type: 'string' }, explorer: { type: 'string' } } }

export function openapi(base) {
  const offer = (method, description) => ({ intent: 'charge', method, amount: null, currency: sui.USDC_COIN_TYPE, description })
  const payable = (summary, description, offers, extra = {}) => ({
    get: {
      operationId: summary.replace(/\W+/g, '_').toLowerCase(),
      summary,
      description,
      parameters: [invoiceId, ...(extra.parameters || [])],
      // multi-offer form (SHOULD) plus the first offer inline, for clients that only read the shorthand
      'x-payment-info': { ...offers[0], offers },
      responses: {
        200: { description: 'Paid: receipt for the settled invoice', ...json(receipt) },
        402: { description: 'Payment Required: challenge for the exact amount still owed' },
        404: { description: 'Unknown invoice', ...json(err) },
        409: { description: 'Already paid, or the payment was already used', ...json(err) },
      },
    },
  })
  return {
    openapi: '3.1.0',
    info: { title: 'Invoice Chaser', version: '1.0.0', description: `USDC invoices on Sui ${sui.NETWORK}. Each invoice is payable by an agent over MPP or x402; every payment is verified on Sui through Tatum's gRPC gateway and remembered in Walrus Memory.` },
    servers: [{ url: base }],
    'x-service-info': { categories: ['payments', 'invoicing', 'developer-tools'], docs: { homepage: base, llms: `${base}/llms.txt`, apiReference: 'https://github.com/PugarHuda/invoice-chaser#readme' } },
    paths: {
      '/api/chaser/mpp/{id}': payable('Pay invoice (MPP)', 'Machine Payments Protocol charge. 402 carries WWW-Authenticate: Payment method="sui"; retry with Authorization: Payment <credential> for a Payment-Receipt.', [offer('sui', 'Exact unique USDC amount of the invoice, paid to the payee on Sui')]),
      '/api/chaser/x402/{id}': payable('Pay invoice (x402)', 'x402 exact scheme on sui:mainnet. v1: pay, then retry with X-PAYMENT: <digest>. v2: send PAYMENT-SIGNATURE with a signed, unexecuted Sui Payment Kit transaction (nonce = invoice id); the server simulates and broadcasts it through Tatum. The v2 challenge carries the x402 Bazaar discovery extension (input/output schema, routeTemplate /api/chaser/x402/:id).', [{ ...offer('x402', 'x402 v1/v2 exact scheme, Sui Payment Kit nonce = invoice id'), network: `sui:${sui.NETWORK}` }]),
      '/api/chaser/pay/{id}': { get: { operationId: 'invoice_terms', summary: 'Public invoice terms', parameters: [invoiceId], responses: { 200: { description: 'Amount, payee, Payment Kit URI and status' }, 404: { description: 'Unknown invoice', ...json(err) } } } },
      '/api/chaser/pay/{id}/live': { get: { operationId: 'invoice_live', summary: 'Live payment stream (SSE)', description: "Server-Sent Events fed by Tatum's Sui gRPC SubscribeCheckpoints: watching, checkpoint, seen, paid, timeout.", parameters: [invoiceId], responses: { 200: { description: 'text/event-stream' } } } },
      '/api/chaser/mcp': { post: { operationId: 'mcp', summary: 'MCP server (Streamable HTTP)', description: 'Read-only tools over the learned memory: list_open_invoices, client_profile, plan_reminder, search_client_memory, payment_terms, learning_summary.', responses: { 200: { description: 'JSON-RPC response' } } } },
    },
  }
}
