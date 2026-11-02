// The Express app without Vite: used by server/index.mjs in dev and by Vercel (../app.mjs) in production.
import './proxy-bootstrap.mjs'
import './credentials-store.mjs'
import express from 'express'
import tatumRoutes from './routes/tatum.mjs'
import chaserRoutes from './routes/chaser.mjs'
import { credentialGuard } from './credential-guard.mjs'

const app = express()
app.use(express.json())
// Redact the Tatum API key from every response before it leaves the process.
app.use(credentialGuard)
app.use('/api/tatum', tatumRoutes)
app.use('/api/chaser', chaserRoutes)

export default app
