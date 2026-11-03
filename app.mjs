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
app.use(express.json())
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
- Reference agent: https://github.com/PugarHuda/invoice-chaser/blob/main/scripts/ap-agent.mjs

## For people
- Pay page for a client: \`${base}/?pay={invoiceId}\`
- Source and docs: https://github.com/PugarHuda/invoice-chaser
`)
})

app.use('/api/tatum', tatumRoutes)
app.use('/api/chaser', chaserRoutes)

// Production UI (vite build -> public/). In dev, server/index.mjs serves it through Vite instead.
const dist = path.join(process.cwd(), 'public')
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

// JSON errors for the API (e.g. malformed request bodies), never an HTML stack page.
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(err)
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Internal error' })
})

export default app
