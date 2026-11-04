// The Express app (Vercel entry point; dev wraps it with Vite in server/index.mjs). Static UI is built into public/.
import './server/proxy-bootstrap.mjs'
import './server/credentials-store.mjs'
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import tatumRoutes from './server/routes/tatum.mjs'
import chaserRoutes from './server/routes/chaser.mjs'
import { credentialGuard } from './server/credential-guard.mjs'
import { discovery } from './server/discovery.mjs'

const app = express()
// Vercel's edge is one proxy hop: trust it for X-Forwarded-Proto so URLs we publish are https
app.set('trust proxy', 1)
app.use(express.json())
// The same UI is also published on Walrus Sites (*.wal.app); let it call this API cross-origin.
app.use('/api', (req, res, next) => {
  const o = req.get('origin')
  if (o && /^https:\/\/[a-z0-9-]+\.wal\.app$/.test(o)) {
    res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'content-type, x-passcode, x-payment, payment-signature, authorization', 'Access-Control-Expose-Headers': 'payment-required, payment-response, x-payment-response, www-authenticate, payment-receipt', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE' })
    if (req.method === 'OPTIONS') return res.sendStatus(204)
  }
  next()
})
// Redact the Tatum API key from every response before it leaves the process.
app.use(credentialGuard)
// Agent discovery: robots, sitemap, llms.txt, /openapi.json, /.well-known/*, Link headers, markdown negotiation.
app.use(discovery)

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
  // a missing file (/auth.md, /x.png) is a 404 too; only extensionless app routes get the shell
  app.get(/^(?!\/api(\/|$)|\/\.well-known\/)(?!.*\.[A-Za-z0-9]+$).*/, (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.sendFile(path.join(dist, 'index.html'), { etag: false, lastModified: false })
  })
}

// Unknown API or well-known paths: a real 404, never the SPA's HTML (agents read that as a soft-404).
app.use((req, res, next) => (/^\/(api|\.well-known)(\/|$)|\.[A-Za-z0-9]+$/.test(req.path) ? res.status(404).json({ error: 'Not found' }) : next()))

// JSON errors for the API (e.g. malformed request bodies), never an HTML stack page.
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(err)
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Internal error' })
})

export default app
