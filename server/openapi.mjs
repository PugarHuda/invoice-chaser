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
      '/api/chaser/x402/{id}': payable('Pay invoice (x402)', 'x402 exact scheme on sui:mainnet. v1: retry with X-PAYMENT = base64 PaymentPayload { x402Version: 1, scheme: exact, network, payload: { signature, transaction } } (or a digest already executed). Failures carry a standard errorReason in a success:false payment response. v2: send PAYMENT-SIGNATURE with a signed, unexecuted Sui Payment Kit transaction (nonce = invoice id); the server simulates and broadcasts it through Tatum. The v2 challenge carries the x402 Bazaar discovery extension (input/output schema, routeTemplate /api/chaser/x402/:id).', [{ ...offer('x402', 'x402 v1/v2 exact scheme, Sui Payment Kit nonce = invoice id'), network: `sui:${sui.NETWORK}` }]),
      '/api/chaser/pay/{id}': { get: { operationId: 'invoice_terms', summary: 'Public invoice terms', parameters: [invoiceId], responses: { 200: { description: 'Amount, payee, Payment Kit URI and status' }, 404: { description: 'Unknown invoice', ...json(err) } } } },
      '/api/chaser/pay/{id}/live': { get: { operationId: 'invoice_live', summary: 'Live payment stream (SSE)', description: "Server-Sent Events fed by Tatum's Sui gRPC SubscribeCheckpoints: watching, checkpoint, seen, paid, timeout.", parameters: [invoiceId], responses: { 200: { description: 'text/event-stream' } } } },
      '/api/chaser/pay/{id}/invoice.pdf': { get: { operationId: 'invoice_pdf', summary: 'Invoice PDF', description: 'Exact amount, sui:pay QR, pay link and agent endpoints; stamped PAID once settled. Embeds a Factur-X (CII MINIMUM) XML when the seller identity is configured.', parameters: [invoiceId], responses: { 200: { description: 'application/pdf' }, 404: { description: 'Unknown invoice', ...json(err) } } } },
      '/api/chaser/pay/{id}/invoice.xml': { get: { operationId: 'invoice_einvoice', summary: 'E-invoice (Factur-X / ZUGFeRD CII XML)', parameters: [invoiceId], responses: { 200: { description: 'application/xml, MINIMUM profile' }, 501: { description: 'Seller identity not configured', ...json(err) } } } },
      '/api/chaser/pay-tx': { post: { operationId: 'build_payment', summary: 'Build the payment transaction for a wallet', description: 'Body { invoiceId, sender, amount?, withSui? }. Returns unsigned bytes: native gasless, sponsored gas, a Payment Kit payment, or (withSui) one transaction that swaps SUI to USDC on the Cetus aggregator and pays.', responses: { 200: { description: 'bytes (base64) and how the fee is paid' }, 400: { description: 'Cannot build', ...json(err) } } } },
      '/api/chaser/verify-payment': { post: { operationId: 'verify_payment', summary: 'Verify and settle a payment by digest', description: 'Body { invoiceId, digest }. Verified through Tatum (Sui gRPC), remembered in Walrus Memory.', responses: { 200: { description: 'Settled' }, 400: { description: 'Not a valid payment for this invoice', ...json(err) }, 409: { description: 'Already paid / digest used', ...json(err) } } } },
      '/api/chaser/proof': { get: { operationId: 'proof', summary: 'Live integration proof', description: 'Tatum gRPC latest checkpoint and provider, Walrus Memory relayer health, namespaces, sync mode and durability audit.', responses: { 200: { description: 'JSON' } } } },
      '/api/chaser/reminders.ics': { get: { operationId: 'reminders_ics', summary: 'Planned reminders as an iCalendar feed', responses: { 200: { description: 'text/calendar' } } } },
      '/api/chaser/mcp': { post: { operationId: 'mcp', summary: 'MCP server (Streamable HTTP)', description: 'Read-only tools (with output schemas) over the learned memory: list_open_invoices, client_profile, plan_reminder, search_client_memory, payment_terms, learning_summary. Resources invoice-chaser://clients/{clientId}/memories; prompt chase_invoice.', responses: { 200: { description: 'JSON-RPC response' } } } },
    },
  }
}
