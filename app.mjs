// The Express app (Vercel entry point; dev wraps it with Vite in server/index.mjs). Static UI is built into public/.
import './server/proxy-bootstrap.mjs'
import './server/credentials-store.mjs'
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import tatumRoutes from './server/routes/tatum.mjs'
import chaserRoutes from './server/routes/chaser.mjs'
import { credentialGuard } from './server/credential-guard.mjs'

const app = express()
// Vercel's edge is one proxy hop: trust it for X-Forwarded-Proto so URLs we publish are https
app.set('trust proxy', 1)
app.use(express.json())
// The same UI is also published on Walrus Sites (*.wal.app); let it call this API cross-origin.
app.use('/api', (req, res, next) => {
  const o = req.get('origin')
  if (o && /^https:\/\/[a-z0-9-]+\.wal\.app$/.test(o)) {
    res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'content-type, x-passcode, x-payment', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE' })
    if (req.method === 'OPTIONS') return res.sendStatus(204)
  }
  next()
})
// Redact the Tatum API key from every response before it leaves the process.
app.use(credentialGuard)
// Crawlers and AI agents: robots.txt and llms.txt (how an agent can pay an invoice over x402).
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\n'))
app.get('/llms.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`
  res.type('text/markdown').send(`# Invoice Chaser

> Invoice tracker for freelancers paid in USDC on Sui. It learns how each client pays (Walrus Memory) and verifies every payment on Sui through Tatum's gRPC gateway.

## For paying agents (x402)
- \`GET ${base}/api/chaser/x402/{invoiceId}\` returns \`402 Payment Required\` with x402 terms: scheme \`exact\`, network \`sui:mainnet\`, USDC asset, \`maxAmountRequired\` (base units), \`payTo\`, and \`extra.paymentKit\` (Sui Payment Kit registry + nonce).
- Pay through the Payment Kit registry (nonce = invoice id) or with a USDC transfer of the exact amount, then repeat the request with header \`X-PAYMENT: <Sui transaction digest>\` to receive a receipt.
- [Reference x402 agent](https://github.com/PugarHuda/invoice-chaser/blob/main/scripts/ap-agent.mjs): reads the 402 terms, enforces a budget, pays through Payment Kit, retries with X-PAYMENT

## For paying agents (MPP)
- \`GET ${base}/api/chaser/mpp/{invoiceId}\` returns \`402\` with \`WWW-Authenticate: Payment method="sui", intent="charge"\` (Machine Payments Protocol, @suimpp/mpp). Pay the exact USDC amount, then retry with \`Authorization: Payment <credential>\` (digest + payer signature) for a 200 and a \`Payment-Receipt\`.
- [Reference MPP agent](https://github.com/PugarHuda/invoice-chaser/blob/main/scripts/mpp-agent.mjs)

## Live payment stream
- \`GET ${base}/api/chaser/pay/{invoiceId}/live\`: Server-Sent Events (\`watching\`, \`checkpoint\`, \`seen\`, \`paid\`) fed by Tatum's Sui gRPC \`SubscribeCheckpoints\` stream.

## MCP
- [MCP server](${base}/api/chaser/mcp): Streamable HTTP, read-only tools over the learned memory (list_open_invoices, client_profile, plan_reminder, search_client_memory, payment_terms, learning_summary)

## Receipts and calendar
- Paid invoices can carry a PDF receipt stored on Walrus; \`GET ${base}/api/chaser/invoices/{invoiceId}\` returns \`receipt.url\` (Walrus aggregator).
- [Reminder calendar](${base}/api/chaser/reminders.ics): every open invoice's reminder plan as iCalendar.

## Docs
- [README](https://github.com/PugarHuda/invoice-chaser/blob/main/README.md): how it uses Walrus Memory, Tatum and Sui Payment Kit
- [Live proof](${base}/api/chaser/proof): current Sui checkpoint via Tatum, memory counts from the Walrus relayer
- [Client pay page](${base}/?pay=inv-101): example payer-facing page (replace the invoice id)
`)
})

app.use('/api/tatum', tatumRoutes)
app.use('/api/chaser', chaserRoutes)

// Production UI (vite build -> public/). In dev, server/index.mjs serves it through Vite instead.
const dist = path.join(process.cwd(), 'public')
if (fs.existsSync(path.join(dist, 'index.html'))) {
  // hashed assets never change; a missing one is a 404 (never index.html served as JavaScript)
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  // index.html must never be revalidated into a stale copy: bundle files can share size/mtime across
  // deploys, so an ETag 304 would keep an old index pointing at assets that no longer exist (blank page)
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.sendFile(path.join(dist, 'index.html'), { etag: false, lastModified: false })
  })
}

// JSON errors for the API (e.g. malformed request bodies), never an HTML stack page.
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(err)
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Internal error' })
})

export default app
