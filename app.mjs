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
app.use('/api/tatum', tatumRoutes)
app.use('/api/chaser', chaserRoutes)

// Production UI (vite build -> public/). In dev, server/index.mjs serves it through Vite instead.
const dist = path.join(process.cwd(), 'public')
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

export default app
