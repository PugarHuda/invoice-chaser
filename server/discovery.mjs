// Agent discovery, all served from the same origin and generated from live config:
// robots.txt (+ Content Signals), sitemap.xml, llms.txt, /openapi.json (MPP discovery),
// /.well-known/api-catalog (RFC 9727), MCP server card (SEP-1649), Agent Skills index,
// RFC 8288 Link headers on pages, and Accept: text/markdown negotiation for pages and pay links.
import express from 'express'
import { createHash } from 'node:crypto'
import { openapi } from './openapi.mjs'

export const discovery = express.Router()
const origin = (req) => `${req.protocol}://${req.get('host')}`
const REPO = 'https://github.com/PugarHuda/invoice-chaser'

export const llms = (base) => `# Invoice Chaser

> Invoice tracker for freelancers paid in USDC on Sui. It learns how each client pays (Walrus Memory) and verifies every payment on Sui through Tatum's gRPC gateway.

## For paying agents (x402)
- \`GET ${base}/api/chaser/x402/{invoiceId}\` returns \`402 Payment Required\` with x402 terms: scheme \`exact\`, network \`sui:mainnet\`, USDC asset, \`maxAmountRequired\` (base units), \`payTo\`, and \`extra.paymentKit\` (Sui Payment Kit registry + nonce).
- Pay through the Payment Kit registry (nonce = invoice id) or with a USDC transfer of the exact amount, then repeat the request with header \`X-PAYMENT: <Sui transaction digest>\` to receive a receipt.
- x402 v2: the same 402 also carries a base64 \`PAYMENT-REQUIRED\` header; send \`PAYMENT-SIGNATURE\` (base64 \`{ x402Version: 2, accepted, payload: { signature, transaction } }\`) with a signed, unexecuted Payment Kit transaction (nonce = invoice id) and the server simulates and broadcasts it through Tatum, answering with \`PAYMENT-RESPONSE\`.
- [Reference x402 agent](https://github.com/PugarHuda/invoice-chaser/blob/main/scripts/ap-agent.mjs): reads the 402 terms, enforces a budget, pays through Payment Kit, retries with X-PAYMENT

## For paying agents (MPP)
- \`GET ${base}/api/chaser/mpp/{invoiceId}\` returns \`402\` with \`WWW-Authenticate: Payment method="sui", intent="charge"\` (Machine Payments Protocol, @suimpp/mpp). Pay the exact USDC amount, then retry with \`Authorization: Payment <credential>\` (digest + payer signature) for a 200 and a \`Payment-Receipt\`.
- [Reference MPP agent](https://github.com/PugarHuda/invoice-chaser/blob/main/scripts/mpp-agent.mjs)

## Discovery
- [OpenAPI with x-payment-info](${base}/openapi.json): MPP service discovery (draft-payment-discovery-01), every payable operation and its offers

## Gasless (no SUI needed)
- \`POST ${base}/api/chaser/pay-tx\` with \`{ invoiceId, sender, amount? }\` returns a native gasless USDC transfer (\`gasless.mac\`) when the sender's address balance qualifies (Sui Address Balances; gas price and budget 0). Sign it and \`POST ${base}/api/chaser/pay-gasless\` with \`{ invoiceId, bytes, signature, mac }\`.

## Live payment stream
- \`GET ${base}/api/chaser/pay/{invoiceId}/live\`: Server-Sent Events (\`watching\`, \`checkpoint\`, \`seen\`, \`paid\`) fed by Tatum's Sui gRPC \`SubscribeCheckpoints\` stream.

## MCP
- [MCP server](${base}/api/chaser/mcp): Streamable HTTP, read-only tools over the learned memory (list_open_invoices, client_profile, plan_reminder, search_client_memory, payment_terms, learning_summary)

## Receipts and calendar
- \`GET ${base}/api/chaser/pay/{invoiceId}/invoice.pdf\`: the invoice as a PDF (exact amount, Payment Kit sui:pay QR, pay link, MPP and x402 endpoints; stamped PAID with its transaction once settled).
- \`GET ${base}/api/chaser/pay/{invoiceId}/invoice.xml\`: the invoice as a Factur-X / ZUGFeRD CII XML (MINIMUM profile, USD settled 1:1 in USDC), also embedded in the PDF; 501 when the seller identity is not configured.
- \`GET ${base}/api/chaser/pay/{invoiceId}\`: includes \`slushPayUrl\` (Slush universal pay link with the same Payment Kit nonce) and any agreed \`terms\` (early-payment discount with its deadline, or late fee).
- Paid invoices can carry a PDF receipt stored on Walrus; \`GET ${base}/api/chaser/invoices/{invoiceId}\` returns \`receipt.url\` (Walrus aggregator).
- [Reminder calendar](${base}/api/chaser/reminders.ics): every open invoice's reminder plan as iCalendar.

## Docs
- [README](https://github.com/PugarHuda/invoice-chaser/blob/main/README.md): how it uses Walrus Memory, Tatum and Sui Payment Kit
- [Live proof](${base}/api/chaser/proof): current Sui checkpoint via Tatum, memory counts from the Walrus relayer
- [Client pay page](${base}/?pay=inv-101): example payer-facing page (replace the invoice id)
`

// A real, usable skill: how an agent pays one of these invoices end to end.
const paySkill = (base) => `---
name: pay-invoice
description: Pay an Invoice Chaser USDC invoice on Sui from an agent, over MPP or x402, and get a verified receipt.
---

# Pay an Invoice Chaser invoice

1. Read the terms: \`GET ${base}/api/chaser/pay/{invoiceId}\` gives the exact amount (unique micro-USDC suffix), the payee and the Payment Kit \`sui:pay\` URI. Pay that exact amount, never a rounded one.
2. Pick a protocol (both are listed in \`${base}/openapi.json\` under \`x-payment-info\`):
   - **MPP**: \`GET ${base}/api/chaser/mpp/{invoiceId}\` answers 402 with \`WWW-Authenticate: Payment method="sui", intent="charge"\`. Pay the USDC, then retry with \`Authorization: Payment <credential>\`. A 200 carries \`Payment-Receipt\`.
   - **x402 v2**: \`GET ${base}/api/chaser/x402/{invoiceId}\` answers 402 with a base64 \`PAYMENT-REQUIRED\` header. Build a Sui Payment Kit \`process_registry_payment\` transaction (nonce = invoice id, exact amount, payee from the terms), sign it without executing, and retry with \`PAYMENT-SIGNATURE\`. The server simulates it through Tatum, broadcasts it and answers with \`PAYMENT-RESPONSE\`.
   - **x402 v1**: pay first, then retry with \`X-PAYMENT: <transaction digest>\`.
3. Optional: watch \`${base}/api/chaser/pay/{invoiceId}/live\` (Server-Sent Events) for \`paid\` the moment the payment lands in a checkpoint.

Rules: enforce your own budget before paying. A 409 means the invoice is already paid or the digest was already used, so do not pay again. Reference agents: ${REPO}/blob/main/scripts/mpp-agent.mjs and ${REPO}/blob/main/scripts/ap-agent.mjs
`

const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`
const tokens = (s) => String(Math.ceil(s.length / 4)) // ponytail: chars/4 estimate, no tokenizer dependency
const cors = { 'Access-Control-Allow-Origin': '*' }

discovery.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: /\nAllow: /api/chaser/mcp\nAllow: /api/chaser/pay/\nAllow: /api/chaser/x402/\nAllow: /api/chaser/mpp/\nAllow: /api/chaser/proof\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`))
discovery.get('/sitemap.xml', (req, res) => {
  const b = origin(req)
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', '/llms.txt', '/openapi.json'].map((p) => `  <url><loc>${b}${p}</loc></url>`).join('\n')}\n</urlset>\n`)
})
discovery.get('/llms.txt', (req, res) => res.type('text/markdown').send(llms(origin(req))))
discovery.get('/openapi.json', (req, res) => res.set(cors).json(openapi(origin(req))))
discovery.get('/.well-known/api-catalog', (req, res) => {
  const b = origin(req)
  // RFC 9727 §2/§4.2: a Link header on the catalog itself (GET and HEAD) and the profile on the media type
  res.type('application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"').set({ ...cors, Link: '</.well-known/api-catalog>; rel="api-catalog"' }).send(JSON.stringify({
    linkset: [{
      anchor: `${b}/api/chaser`,
      'service-desc': [{ href: `${b}/openapi.json`, type: 'application/json' }],
      'service-doc': [{ href: `${REPO}#readme`, type: 'text/html' }, { href: `${b}/llms.txt`, type: 'text/markdown' }],
      status: [{ href: `${b}/api/chaser/proof`, type: 'application/json' }],
    }],
  }))
})
// MCP server card, SEP-2127 shape: reverse-DNS name, remotes[], no tool list, the versions the server negotiates
const serverCard = (req) => ({
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: `${new URL(origin(req)).hostname.split('.').reverse().join('.')}/invoice-chaser`,
  version: '1.0.0',
  title: 'Invoice Chaser',
  description: 'Read-only tools (with output schemas) over what Invoice Chaser learned in Walrus Memory: open invoices, client profiles, reminder plans, semantic memory search, payment terms (MPP, x402), learning summary. Resources: the Walrus memories of every client (invoice-chaser://clients/{clientId}/memories). Prompt: chase_invoice.',
  websiteUrl: origin(req),
  repository: { url: REPO, source: 'github' },
  remotes: [{ type: 'streamable-http', url: `${origin(req)}/api/chaser/mcp`, supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26'] }],
})
discovery.get(['/api/chaser/mcp/server-card', '/.well-known/mcp/server-card.json', '/.well-known/mcp.json'], (req, res) => res.type('application/mcp-server-card+json').set(cors).send(JSON.stringify(serverCard(req))))
// AI Catalog: the discovery document that points agents at the server card
discovery.get('/.well-known/ai-catalog.json', (req, res) => res.type('application/ai-catalog+json').set(cors).send(JSON.stringify({
  specVersion: '1.0',
  entries: [{ identifier: `urn:air:${new URL(origin(req)).hostname}:mcp:invoice-chaser`, type: 'application/mcp-server-card+json', url: `${origin(req)}/api/chaser/mcp/server-card` }],
})))
discovery.get('/.well-known/agent-skills/index.json', (req, res) => {
  res.set(cors).json({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [{ name: 'pay-invoice', type: 'skill-md', description: 'Pay an Invoice Chaser USDC invoice on Sui over MPP or x402 and get a verified receipt.', url: '/.well-known/agent-skills/pay-invoice/SKILL.md', digest: sha(paySkill(origin(req))) }],
  })
})
discovery.get('/.well-known/agent-skills/pay-invoice/SKILL.md', (req, res) => res.type('text/markdown').set(cors).send(paySkill(origin(req))))

// Pages: Link headers for discovery; Accept: text/markdown gets markdown instead of the SPA shell.
// A pay link (/?pay=<id>) answers with that invoice's agent endpoints.
discovery.get(/^(?!\/api(\/|$)|\/\.well-known\/|\/assets\/).*/, (req, res, next) => {
  res.set('Link', ['</.well-known/api-catalog>; rel="api-catalog"', '</openapi.json>; rel="service-desc"; type="application/json"', '</llms.txt>; rel="describedby"; type="text/markdown"', `<${REPO}#readme>; rel="service-doc"`].join(', '))
  res.vary('Accept')
  // only app pages (no file extension): /auth.md or /x.json must not get a made-up markdown body
  if (!/text\/markdown/.test(req.get('accept') || '') || /\.[a-z0-9]+$/i.test(req.path)) return next()
  const b = origin(req)
  const id = typeof req.query.pay === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(req.query.pay) ? req.query.pay : null
  const md = id
    ? `# Pay invoice ${id}\n\nUSDC on Sui, verified through Tatum and remembered in Walrus Memory.\n\n- Terms (exact amount, payee, sui:pay URI): ${b}/api/chaser/pay/${id}\n- MPP: \`GET ${b}/api/chaser/mpp/${id}\` (402, WWW-Authenticate: Payment)\n- x402 v1/v2: \`GET ${b}/api/chaser/x402/${id}\` (402, PAYMENT-REQUIRED)\n- Live status (SSE): ${b}/api/chaser/pay/${id}/live\n- How to pay as an agent: ${b}/.well-known/agent-skills/pay-invoice/SKILL.md\n`
    : llms(b)
  res.type('text/markdown').set({ 'x-markdown-tokens': tokens(md), 'Cache-Control': 'no-store' }).send(md)
})
