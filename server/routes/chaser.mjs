import { Router } from 'express'
import { Transaction } from '@mysten/sui/transactions'
import { randomBytes } from 'node:crypto'
import * as mem from '../memory.mjs'
import * as sui from '../sui.mjs'
import { usdRate } from '../rates.mjs'
import { screenAddress } from '../security.mjs'
import { mcpHandler } from '../mcp.mjs'
import { draftReminder } from '../drafter.mjs'
import { storeReceipt, receiptsEnabled } from '../receipts.mjs'
import * as live from '../live.mjs'
import { mpp, mppEnabled, credentialDigest } from '../mpp.mjs'
import { deriveState, computeProfile, plan, invoiceStatus, uniquePayAmount, isoDay, learningSummary, foldIcs } from '../engine.mjs'

const router = Router()
const PAYEE = () => process.env.SUI_PAYEE_ADDRESS
const DAY = 86_400_000

// First request after boot rebuilds everything from Walrus Memory.
router.use(async (_req, _res, next) => {
  await mem.ready()
  next()
})

const PUBLIC_WRITES = new Set(['/verify-payment', '/pay-tx', '/pay-sponsored', '/sync-payments', '/mcp'])

// Per-IP write budget so the public demo can't be used to flood Walrus or Tatum.
// ponytail: per-instance in-memory buckets; a shared store would make it global across instances
const buckets = new Map()
const LIMITS = { write: [30, 10 * 60_000], payment: [60, 10 * 60_000], expensive: [40, 10 * 60_000] }
// GETs that call an external service on every request
const isExpensiveRead = (req) => (req.method === 'GET' && (/^\/clients\/[^/]+\/search$/.test(req.path) || /^\/pay\/[^/]+\/live$/.test(req.path))) || req.path === '/mcp'
router.use((req, res, next) => {
  const isPayment = (PUBLIC_WRITES.has(req.path) && req.path !== '/mcp') || req.path.startsWith('/x402/') || req.path.startsWith('/mpp/')
  const expensive = isExpensiveRead(req)
  if (req.method === 'GET' && !isPayment && !expensive) return next()
  const kind = isPayment ? 'payment' : expensive ? 'expensive' : 'write'
  const [max, windowMs] = LIMITS[kind]
  // On Vercel the edge sets x-vercel-forwarded-for (clients can't spoof it). Elsewhere use req.ip,
  // which honours only the configured proxy hop ('trust proxy' = 1), never the client-supplied leftmost XFF.
  const ip = (process.env.VERCEL && req.get('x-vercel-forwarded-for')) || req.ip || '?'
  const key = `${kind}:${ip}`
  const now = Date.now()
  const b = buckets.get(key)?.reset > now ? buckets.get(key) : { n: 0, reset: now + windowMs }
  b.n++
  buckets.set(key, b)
  if (b.n > max) {
    res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)))
    return res.status(429).json({ error: 'Too many requests from this address; try again later' })
  }
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
  next()
})
// Owner-only writes. The payer-facing /verify-payment stays public; it only settles against verified chain data.
router.use((req, res, next) => {
  const pass = process.env.APP_PASSCODE
  if (!pass || req.method === 'GET' || PUBLIC_WRITES.has(req.path)) return next()
  if (req.get('x-passcode') !== pass) return res.status(401).json({ error: 'Owner passcode required' })
  next()
})

const state = () => deriveState(mem.store)
const memsFor = (clientId) => mem.store.get(mem.clientNs(clientId)) || []
const profileOf = (clientId) => computeProfile(clientId, memsFor(clientId))
const clientName = (clients, id) => clients.find((c) => c.id === id)?.name || 'Unknown'
const withStatus = (inv) => ({ ...inv, status: invoiceStatus(inv) })
// time-ordered and collision-free even for concurrent requests
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
const owed = (inv) => (inv.status === 'partial' && inv.remaining ? inv.remaining : inv.payAmount)

router.get('/summary', (_req, res) => {
  const now = new Date()
  const horizon = isoDay(now.getTime() + 7 * DAY)
  const horizon30 = isoDay(now.getTime() + 30 * DAY)
  let expected30 = 0
  const today = isoDay(now)
  const { clients, invoices } = state()
  let expected = 0
  let overdue = 0
  const upcomingInflows = []
  const nextActions = []
  for (const raw of invoices) {
    const inv = withStatus(raw)
    if (inv.status !== 'sent' && inv.status !== 'overdue') continue
    const profile = profileOf(inv.clientId)
    const p = plan(inv, profile)
    const predicted = p.predictedPayDate || inv.dueDate
    if (predicted <= horizon30) expected30 += inv.baseAmount
    if (predicted <= horizon) {
      expected += inv.baseAmount
      upcomingInflows.push({ invoiceId: inv.id, clientName: clientName(clients, inv.clientId), payAmount: inv.payAmount, dueDate: inv.dueDate, predictedPayDate: predicted, delayDays: p.predictedDelayDays ?? 0, status: inv.status })
    }
    if (inv.dueDate < today) overdue += inv.baseAmount
    const step = p.steps.find((s) => s.date >= today) || p.steps.at(-1)
    nextActions.push({ invoiceId: inv.id, clientId: inv.clientId, clientName: clientName(clients, inv.clientId), amount: inv.payAmount, actionDate: step.date, recommendedTone: step.tone, reason: step.reason, underpayRisk: profile.underpayRate || null })
  }
  nextActions.sort((a, b) => a.actionDate.localeCompare(b.actionDate))
  res.json({
    expectedInflow7Days: expected.toFixed(2),
    expectedInflow30Days: expected30.toFixed(2),
    overdueAmount: overdue.toFixed(2),
    activeClientNamespaces: clients.length,
    upcomingInflows,
    nextActions,
    memory: { loadedAt: mem.loadState.loadedAt, pending: mem.pendingCount(), error: mem.loadState.error, namespacePrefix: mem.NS_PREFIX },
    network: sui.NETWORK,
    learning: learningSummary(clients.map((c) => profileOf(c.id))),
  })
})

router.get('/clients', (_req, res) => {
  res.json(state().clients.map((c) => ({ ...c, email: c.contact, profile: profileOf(c.id) })))
})

router.post('/clients', (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ')
  if (!name) return res.status(400).json({ error: 'name is required' })
  if (name.length > 80) return res.status(400).json({ error: 'name must be 80 characters or fewer' })
  const id = newId('c')
  const m = mem.remember(mem.clientNs(id), `New client ${name} added.`, { type: 'client_created', client: id, name, contact: req.body?.contact || null })
  res.json({ client: { id, name }, memory: m })
})

router.get('/clients/:id', (req, res) => {
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  res.json({ client: { ...client, email: client.contact, address: null }, profile: profileOf(client.id), memories: memsFor(client.id), namespace: mem.clientNs(client.id) })
})

router.post('/clients/:id/preference', (req, res) => {
  const note = String(req.body?.preference || '').trim()
  if (!note) return res.status(400).json({ error: 'preference is required' })
  if (note.length > 300) return res.status(400).json({ error: 'keep rules under 300 characters' })
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const m = mem.remember(mem.clientNs(client.id), `Rule for ${client.name}: "${note}"`, { type: 'preference', client: client.id, note })
  res.json({ success: true, memory: m, profile: profileOf(client.id) })
})

// Walrus blobs can't be deleted, so "forget this rule" is itself a memory: the engine ignores
// any rule whose text was revoked after it was written.
router.post('/clients/:id/revoke', (req, res) => {
  const rule = String(req.body?.rule || '').trim()
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  if (!profileOf(client.id).preferences.includes(rule)) return res.status(400).json({ error: 'not an active rule for this client' })
  const m = mem.remember(mem.clientNs(client.id), `Rule revoked for ${client.name}: "${rule}" no longer applies.`, { type: 'rule_revoked', client: client.id, rule })
  res.json({ success: true, memory: m, profile: profileOf(client.id) })
})

// Expected payer wallet for a client: a 0x address or a SuiNS name resolved through Tatum.
// Payments from any other wallet are flagged; the wallet is screened with Tatum's Malicious Address API.
router.post('/clients/:id/payer', async (req, res) => {
  const input = String(req.body?.payer || '').trim().toLowerCase()
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  let address = input
  let name = null
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.sui$/.test(input) || /^@[a-z0-9-]+$/.test(input)) {
    name = input
    address = await sui.resolveSuins(input).catch(() => null)
    if (!address) return res.status(404).json({ error: `SuiNS name ${input} does not resolve` })
  }
  if (!sui.ADDRESS_RE.test(address)) return res.status(400).json({ error: 'Enter a Sui address (0x + 64 hex) or a SuiNS name (name.sui)' })
  const screen = await screenAddress(address).catch(() => null)
  const m = mem.remember(mem.clientNs(client.id), `${client.name} pays from ${name ? `${name} (${address.slice(0, 10)}…)` : address}${screen ? `; Tatum screening: ${screen.verdict}` : ''}.`, { type: 'payer_expected', client: client.id, payer: address, name, screen: screen?.verdict || null })
  res.json({ success: true, address, name, screen, memory: m })
})

// Accounting export (CSV) of every invoice with its on-chain receipt.
router.get('/export.csv', (_req, res) => {
  const { clients, invoices } = state()
  // a leading = + - @ (or tab/CR) would run as a formula in Excel/Sheets: neutralise it (OWASP CSV injection)
  const esc = (v) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, (c) => `'${c}`).replace(/"/g, '""')}"`
  const rows = [['invoice', 'client', 'description', 'amount_usdc', 'pay_amount', 'due', 'status', 'remaining', 'paid_on', 'tx', 'network'].join(',')]
  for (const raw of invoices) {
    const i = withStatus(raw)
    rows.push([i.id, clientName(clients, i.clientId), i.description, i.baseAmount, i.payAmount, i.dueDate, i.status, i.remaining ?? '', i.settledAt ?? '', i.digest ? `${sui.EXPLORER}/tx/${i.digest}` : '', sui.NETWORK].map(esc).join(','))
  }
  res.set('Content-Disposition', 'attachment; filename="invoice-chaser.csv"').type('text/csv').send(rows.join('\n'))
})

// Calendar export of every open invoice's memory-driven reminder plan (RFC 5545, all-day events).
router.get('/reminders.ics', (req, res) => {
  const { clients, invoices } = state()
  const esc = (v) => String(v).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const base = `${req.protocol}://${req.get('host')}`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Invoice Chaser//EN', 'X-WR-CALNAME:Invoice Chaser reminders']
  for (const raw of invoices) {
    const i = withStatus(raw)
    if (i.status === 'paid' || (i.seed && i.status === 'partial')) continue
    const name = clientName(clients, i.clientId)
    for (const st of plan(i, profileOf(i.clientId)).steps) {
      const day = st.date.replace(/-/g, '')
      const next = isoDayPlus(st.date, 1).replace(/-/g, '')
      lines.push('BEGIN:VEVENT', `UID:${i.id}-${day}-${st.tone}@invoice-chaser`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
        `SUMMARY:${esc(`Send ${st.tone} reminder to ${name} (${i.id})`)}`, `DESCRIPTION:${esc(`${st.reason}. Owed: ${owed(i)} USDC. Pay link: ${base}/?pay=${i.id}`)}`, `URL:${base}/?pay=${i.id}`, 'END:VEVENT')
    }
  }
  lines.push('END:VCALENDAR')
  res.set('Content-Disposition', 'attachment; filename="invoice-chaser-reminders.ics"').type('text/calendar').send(lines.map(foldIcs).join('\r\n') + '\r\n')
})
const isoDayPlus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

// Semantic search across a client's memories (Walrus recall ranks by meaning, not keywords).
router.get('/clients/:id/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2 || q.length > 200) return res.status(400).json({ error: 'query must be 2-200 characters' })
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  try {
    res.json({ query: q, results: await mem.search(mem.clientNs(client.id), q, 5) })
  } catch (e) {
    res.status(502).json({ error: `Walrus Memory recall: ${e.message}` })
  }
})

// Free-form notes (an email from the client, a call summary): Walrus Memory's analyze() extracts the
// facts and stores each one as its own memory; rules found in them become hard constraints.
router.post('/clients/:id/notes', async (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (text.length < 10) return res.status(400).json({ error: 'Paste at least a sentence' })
  if (text.length > 4000) return res.status(400).json({ error: 'Keep notes under 4000 characters' })
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  try {
    const facts = await mem.ingestNotes(mem.clientNs(client.id), text)
    res.json({ success: true, facts, profile: profileOf(client.id) })
  } catch (e) {
    res.status(502).json({ error: `Walrus Memory analyze: ${e.message}` })
  }
})

// Total Recall: throw away local state and rebuild everything from Walrus Memory.
router.post('/clients/:id/rebuild', async (req, res) => {
  const t = Date.now()
  // deep: first ask the relayer to re-index any blob it lost (restore), then recall everything
  const restored = req.query.deep ? await mem.restoreAll() : null
  const r = await mem.loadAll()
  if (r.error) return res.status(502).json({ error: `Walrus Memory: ${r.error}` })
  res.json({ success: true, restored, message: `Rebuilt from Walrus Memory: ${r.recalled} memories across ${r.namespaces} namespaces in ${((Date.now() - t) / 1000).toFixed(1)} s${restored ? ` (restore re-indexed ${restored.restored}, skipped ${restored.skipped})` : ''}.` })
})
router.post('/rebuild', async (_req, res) => {
  const r = await mem.loadAll()
  if (r.error) return res.status(502).json({ error: `Walrus Memory: ${r.error}` })
  res.json({ success: true, recalled: r.recalled, namespaces: r.namespaces })
})

router.get('/invoices', (_req, res) => {
  const { clients, invoices } = state()
  res.json(invoices.map((i) => ({ ...withStatus(i), clientName: clientName(clients, i.clientId) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
})

router.post('/invoices', (req, res) => {
  const { clientId, amount, dueDate, description } = req.body || {}
  const { clients, invoices } = state()
  const client = clients.find((c) => c.id === clientId)
  if (!client) return res.status(400).json({ error: 'unknown clientId' })
  // amounts are priced in cents and capped well below u64 in base units; dates must be real calendar days
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') && isoDay(`${dueDate}T00:00:00Z`) === dueDate
  if (!/^\d+(\.\d{1,2})?$/.test(typeof amount === 'number' ? String(Math.round(amount * 100) / 100 === amount ? amount : 'x') : String(amount))) return res.status(400).json({ error: 'amount must be a number with at most 2 decimals' })
  if (!(Number(amount) >= 0.01 && Number(amount) <= 1_000_000) || !validDate) return res.status(400).json({ error: 'amount between 0.01 and 1,000,000 and a real dueDate (YYYY-MM-DD) are required' })
  if (description && String(description).length > 200) return res.status(400).json({ error: 'description must be 200 characters or fewer' })
  const id = newId('inv')
  const payAmount = uniquePayAmount(amount, new Set(invoices.map((i) => i.payAmount)))
  const m = mem.remember(mem.clientNs(clientId), `Invoice ${id} sent to ${client.name}: ${payAmount} USDC due ${dueDate}.`, { type: 'invoice_sent', client: clientId, invoice: id, base: Number(amount), pay_amount: payAmount, due: dueDate, description: description || '' })
  res.json({ invoice: { id, payAmount }, memory: m })
})

// Public, payer-facing view: only what a client needs to pay. Never the learned profile or plan.
router.get('/pay/:id', (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const i = withStatus(inv)
  res.json({
    invoice: {
      id: i.id, clientId: i.clientId, clientName: clientName(clients, i.clientId), baseAmount: i.baseAmount, payAmount: owed(i), originalAmount: i.payAmount, remaining: i.remaining ?? null, status: i.status, dueDate: i.dueDate, issuedDate: i.issuedDate, description: i.description, digest: i.digest,
      payeeAddress: PAYEE(), coinType: sui.USDC_COIN_TYPE, network: sui.NETWORK, registry: sui.REGISTRY_NAME,
      paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(owed(i)), nonce: i.id, label: 'Invoice Chaser', message: `Invoice ${i.id}` }),
      explorerTx: i.digest ? `${sui.EXPLORER}/tx/${i.digest}` : null,
      receipt: receiptOf(i),
    },
  })
})

// Live pay page: Server-Sent Events fed by Tatum's gRPC checkpoint stream. The moment a checkpoint
// moves this invoice's exact amount to the payee, the digest goes through the same verify/settle
// path as everything else, so a stream hit can never settle what a manual check would reject.
const LIVE_MS = 240_000 // ponytail: under Vercel's function limit; the page reconnects when it ends
const liveByIp = new Map() // ponytail: per-instance; 2 open streams per IP so one client can't take every slot
router.get('/pay/:id/live', (req, res) => {
  const inv = state().invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const ip = (process.env.VERCEL && req.get('x-vercel-forwarded-for')) || req.ip || '?'
  if ((liveByIp.get(ip) || 0) >= 2) return res.status(429).json({ error: 'Too many live streams from this address' })
  liveByIp.set(ip, (liveByIp.get(ip) || 0) + 1)
  res.once('close', () => (liveByIp.get(ip) > 1 ? liveByIp.set(ip, liveByIp.get(ip) - 1) : liveByIp.delete(ip)))
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const send = (event, data) => res.write(`event: ${event}
data: ${JSON.stringify(data)}

`)
  if (inv.status === 'paid') {
    send('paid', { invoice: inv.id, digest: inv.digest, already: true })
    return res.end()
  }
  let closed = false
  let lastSent = 0
  let stop = () => {}
  const finish = () => {
    if (closed) return
    closed = true
    stop()
    clearTimeout(timer)
    res.end()
  }
  const timer = setTimeout(() => (send('timeout', { after: LIVE_MS / 1000 }), finish()), LIVE_MS)
  try {
    stop = live.watch(PAYEE(), sui.toMicro(owed(inv)), async (digest, seq) => {
      send('seen', { digest, checkpoint: seq })
      const [code, body] = await settleDigest(inv.id, digest, 'live-stream')
      if (closed) return
      if (code === 200) {
        send('paid', { invoice: inv.id, digest, checkpoint: seq, message: body.message, explorer: body.explorer })
        finish()
      } else send('rejected', { digest, error: body.error })
    }, (seq, error) => {
      if (error) return send('error', { error })
      if (Date.now() - lastSent > 2000) {
        lastSent = Date.now()
        send('checkpoint', { checkpoint: seq })
      }
    })
  } catch (e) {
    send('error', { error: String(e.message || e) })
    return finish()
  }
  send('watching', { invoice: inv.id, amount: owed(inv), payee: PAYEE(), via: 'Tatum gRPC SubscriptionService.SubscribeCheckpoints' })
  req.on('close', finish)
})

// Receipt PDFs live on Walrus; the blob id is remembered in the client's Walrus Memory namespace.
const receiptOf = (inv) => {
  const m = memsFor(inv.clientId).find((x) => x.tag?.type === 'receipt_stored' && x.tag.invoice === inv.id)
  return m ? { blobId: m.tag.blob_id, objectId: m.tag.object_id, url: m.tag.url, at: m.tag.at } : null
}
const receiptInflight = new Map()
router.post('/invoices/:id/receipt', async (req, res) => {
  const { clients, invoices } = state()
  const raw = invoices.find((i) => i.id === req.params.id)
  if (!raw) return res.status(404).json({ error: 'Invoice not found' })
  const inv = withStatus(raw)
  if (inv.status !== 'paid' || !(inv.payments || []).some((p) => p.digest)) return res.status(409).json({ error: 'Only invoices paid on-chain get a receipt' })
  const existing = receiptOf(inv)
  if (existing) return res.json({ ...existing, existing: true })
  if (!receiptsEnabled()) return res.status(503).json({ error: 'Walrus receipt storage is not configured on this server' })
  try {
    if (!receiptInflight.has(inv.id)) {
      receiptInflight.set(inv.id, (async () => {
        const name = clientName(clients, inv.clientId)
        const r = await storeReceipt({ invoiceId: inv.id, client: name, description: inv.description, amount: inv.payAmount, dueDate: inv.dueDate, paidOn: inv.settledAt, payee: PAYEE(), network: sui.NETWORK, explorer: sui.EXPLORER, payments: inv.payments.filter((p) => p.digest) })
        mem.remember(mem.clientNs(inv.clientId), `Stored a PDF receipt for ${inv.id} (${name}) on Walrus as blob ${r.blobId}.`, { type: 'receipt_stored', client: inv.clientId, invoice: inv.id, blob_id: r.blobId, object_id: r.objectId, url: r.url, end_epoch: r.endEpoch })
        return r
      })().finally(() => receiptInflight.delete(inv.id)))
    }
    res.json(await receiptInflight.get(inv.id))
  } catch (e) {
    res.status(502).json({ error: `Walrus: ${e.message}` })
  }
})

router.get('/invoices/:id', (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const profile = profileOf(inv.clientId)
  res.json({
    invoice: {
      ...withStatus(inv),
      clientName: clientName(clients, inv.clientId),
      payeeAddress: PAYEE(),
      coinType: sui.USDC_COIN_TYPE,
      network: sui.NETWORK,
      paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(inv.payAmount), nonce: inv.id, label: 'Invoice Chaser', message: `Invoice ${inv.id}` }),
      registry: sui.REGISTRY_NAME,
      explorerTx: inv.digest ? `${sui.EXPLORER}/tx/${inv.digest}` : null,
      receipt: receiptOf(inv),
      receiptsEnabled: receiptsEnabled(),
    },
    adaptivePlan: plan(inv, profile),
    defaultPlan: plan(inv, profile, { ignoreMemory: true }),
    profile,
  })
})

router.post('/invoices/:id/remind', async (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const p = plan(inv, profileOf(inv.clientId))
  const tone = ['friendly', 'formal', 'firm'].includes(req.body?.tone) ? req.body.tone : p.steps[0].tone
  const name = clientName(clients, inv.clientId)
  const offset = Math.round((Date.now() - new Date(`${inv.dueDate}T00:00:00Z`)) / DAY)
  // the LLM writes the words; tone, amount, dates and the facts it may use come from the engine + Walrus
  const draft = await draftReminder({
    client: name,
    tone,
    invoice: { id: inv.id, owed: owed(inv), dueDate: inv.dueDate, description: inv.description },
    payLink: `${req.protocol}://${req.get('host')}/?pay=${inv.id}`,
    facts: (p.cites || []).map((c) => c.sentence),
  })
  const m = mem.remember(mem.clientNs(inv.clientId), `Sent a ${tone} reminder to ${name} for ${inv.id} (due ${offset >= 0 ? '+' : ''}${offset}d).`, { type: 'reminder_sent', client: inv.clientId, invoice: inv.id, tone, day_offset: offset, planned_tone: p.steps[0].tone, cites: (p.cites || []).map((c) => c.blobId).filter(Boolean), drafted_by: draft.source === 'llm' ? draft.model : 'template' })
  res.json({ text: draft.text, draftedBy: draft.source, model: draft.model || null, fallbackReason: draft.reason || null, memory: m })
})

// ---- Payments ------------------------------------------------------------------------------
// Every path (pasted digest, wallet, x402 agent, Payment Kit auto-sync) ends in settleDigest():
// verify on Sui through Tatum, then remember the outcome in Walrus Memory.
const inflight = new Set()
// Grows only: digests this process has settled. No reload can clear it.
const settledDigests = new Set()
const NET = sui.NETWORK === 'mainnet' ? 'Sui Mainnet' : 'Sui Testnet'

async function settleDigest(invoiceId, requested, channel) {
  const { invoices } = state()
  const inv0 = invoices.find((i) => i.id === invoiceId)
  if (!inv0) return [404, { error: 'Invoice not found' }]
  if (inv0.status === 'paid') return [409, { error: 'Invoice is already paid' }]
  if (mem.loadState.truncated?.length) return [503, { error: 'Memory recall is incomplete; refusing to settle until every namespace is fully loaded' }]
  // Reserve digest + invoice synchronously so two concurrent requests cannot both settle.
  if (inflight.has(requested) || inflight.has(invoiceId)) return [409, { error: 'This payment is already being verified' }]
  inflight.add(requested).add(invoiceId)
  try {
    let tx
    try {
      tx = await sui.usdcReceived(requested, PAYEE())
    } catch (e) {
      // a just-executed transaction can take a moment to reach the gateway: retriable, not a server error
      if (/not found|NOT_FOUND/i.test(e.message)) return [404, { error: `Transaction not visible on ${NET} yet; try again in a few seconds`, retry: true }]
      return [502, { error: `Tatum Sui gRPC: ${e.message}` }]
    }
    // Key everything on the chain's canonical digest, not on what the client sent.
    const digest = tx.digest
    if (!digest) return [400, { error: `Transaction not found on ${NET}` }]
    // Re-read state after the await: anything settled meanwhile wins.
    const { clients, invoices: now, usedDigests } = state()
    const inv = now.find((i) => i.id === invoiceId)
    if (inv.status === 'paid') return [409, { error: 'Invoice is already paid' }]
    if (usedDigests.has(digest) || settledDigests.has(digest)) return [409, { error: 'This transaction has already settled an invoice' }]
    if (!tx.ok) return [400, { error: `Transaction did not succeed on ${NET}` }]
    if (tx.received <= 0n) return [400, { error: 'Transaction sent no USDC to the payee address' }]
    if (tx.timestamp && tx.timestamp < inv.createdAt) return [400, { error: 'Transaction is older than the invoice' }]
    const expected = sui.toMicro(owed(inv)) // the full amount, or what's left after a partial payment
    // A transfer that exactly matches another open invoice's unique amount belongs to that one.
    // A Payment Kit payment names its invoice (nonce): it must be THIS invoice's registry record.
    if (tx.paymentKit) {
      const bound = await sui.findInvoicePayment(PAYEE(), tx.received, inv.id).catch(() => null)
      if (bound !== digest) return [409, { error: `This Payment Kit payment was made for a different invoice, not ${inv.id}` }]
    } else {
      // Plain transfer: the unique amount is the fingerprint, including what's left on partially paid invoices.
      const other = now.find((i) => i.id !== inv.id && i.status !== 'paid' && (sui.toMicro(i.payAmount) === tx.received || sui.toMicro(owed(i)) === tx.received))
      if (other) return [409, { error: `This transfer matches ${other.id}'s exact amount, not ${inv.id}` }]
    }

    const full = tx.received >= expected
    const totalReceived = sui.toMicro(inv.payAmount) - expected + tx.received
    const paid = isoDay(tx.timestamp || Date.now())
    const delay = Math.max(0, Math.round((new Date(paid) - new Date(inv.dueDate)) / DAY))
    const ms = memsFor(inv.clientId)
    const last = ms.find((m) => m.tag?.type === 'reminder_sent' && m.tag.invoice === inv.id)
    // Payer recognition: who paid, their SuiNS name, and whether this client has paid from it before.
    const payer = await sui.txSender(digest).catch(() => null)
    const payerName = payer ? await sui.suinsName(payer) : null
    const knownPayers = new Set(ms.map((m) => m.tag?.payer).filter(Boolean))
    const newPayer = Boolean(payer && knownPayers.size && !knownPayers.has(payer))
    const screen = payer ? await screenAddress(payer).catch(() => null) : null
    // the client told us which wallet pays: anything else is flagged even if it paid before
    const expectedPayer = clients.find((c) => c.id === inv.clientId)?.expectedPayer?.address || null
    const unexpectedPayer = Boolean(payer && expectedPayer && payer.toLowerCase() !== expectedPayer.toLowerCase())
    const name = clientName(clients, inv.clientId)
    const received = sui.fromMicro(tx.received)
    const who = payer ? ` from ${payerName || `${payer.slice(0, 8)}…`}${unexpectedPayer ? ' (NOT the wallet this client said it pays from)' : newPayer ? ' (a wallet this client never paid from before)' : ''}${screen?.verdict === 'flagged' ? ' [FLAGGED by Tatum malicious-address screening]' : ''}` : ''
    settledDigests.add(digest)
    // money above what was owed is a credit for this client, remembered with the payment (not silently absorbed)
    const over = tx.received > expected ? sui.fromMicro(tx.received - expected) : null
    const m = mem.remember(
      mem.clientNs(inv.clientId),
      full
        ? `${name} paid ${inv.id} in full (${received} USDC) on ${paid}, ${delay} day(s) after due, after ${inv.reminders} reminder(s)${last ? `; last tone ${last.tag.tone}` : ''}${who}${over ? `; overpaid by ${over} USDC (credit)` : ''}.`
        : `${name} underpaid ${inv.id}: ${received} of ${owed(inv)} USDC on ${paid}; ${sui.fromMicro(expected - tx.received)} still owed${who}.`,
      { type: full ? 'invoice_paid' : 'invoice_partial', client: inv.clientId, invoice: inv.id, due: inv.dueDate, paid, delay_days: delay, reminders: inv.reminders, last_tone: last?.tag.tone || null, expected: inv.payAmount, received, digest, checkpoint: tx.checkpoint, channel, network: sui.NETWORK, payer, payer_name: payerName, new_payer: newPayer, unexpected_payer: unexpectedPayer, payer_screen: screen?.verdict || null, total_received: sui.fromMicro(totalReceived), overpaid: over },
    )
    return [200, { success: true, verifiedOnChain: true, received, full, payer, payerName, newPayer, unexpectedPayer, payerScreen: screen, memory: m, explorer: `${sui.EXPLORER}/tx/${digest}`, invoice: { ...inv, status: full ? 'paid' : 'partial', digest }, overpaid: over, message: `Verified on ${NET} via Tatum: ${received} USDC received${over ? ` (${over} more than owed, kept as a credit)` : ''}${unexpectedPayer ? ' from an UNEXPECTED payer wallet' : newPayer ? ' from a NEW payer wallet' : ''}.` }]
  } finally {
    inflight.delete(requested)
    inflight.delete(invoiceId)
  }
}

router.post('/verify-payment', async (req, res) => {
  const { invoiceId, digest } = req.body || {}
  if (typeof invoiceId !== 'string' || typeof digest !== 'string' || !sui.DIGEST_RE.test(digest)) return res.status(400).json({ error: 'invoiceId and a valid Sui transaction digest are required' })
  const [code, body] = await settleDigest(invoiceId, digest, req.body.channel === 'wallet' ? 'wallet' : 'pay-page')
  res.status(code).json(body)
})

// Payment Kit auto-sync: look every open invoice up in the on-chain PaymentRegistry (nonce = invoice id).
// Payers never have to report a digest; anything paid through the registry settles itself.
let lastSync = 0
let syncing = null
async function syncPayments() {
  const open = state().invoices.filter((i) => i.status === 'sent' || (i.status === 'partial' && !i.seed))
  const settled = []
  for (const inv of open) {
    const digest = await sui.findInvoicePayment(PAYEE(), sui.toMicro(owed(inv)), inv.id)
    if (!digest) continue
    const [code, body] = await settleDigest(inv.id, digest, 'payment-kit')
    settled.push({ invoice: inv.id, digest, code, message: body.message || body.error })
  }
  lastSync = Date.now()
  return { checked: open.length, settled, at: new Date(lastSync).toISOString() }
}
router.post('/sync-payments', async (_req, res) => {
  // ponytail: one sync per instance per 10 s; each open invoice costs one gRPC lookup
  if (Date.now() - lastSync < 10_000 && !syncing) return res.json({ checked: 0, settled: [], cached: true })
  try {
    syncing ??= syncPayments().finally(() => (syncing = null))
    res.json(await syncing)
  } catch (e) {
    res.status(502).json({ error: `Tatum Sui gRPC: ${e.message}` })
  }
})

// Vercel Cron (daily): settle Payment Kit payments nobody reported. Vercel sends "Bearer $CRON_SECRET".
router.get('/cron/sync', async (req, res) => {
  if (!process.env.CRON_SECRET || req.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'cron only' })
  try {
    syncing ??= syncPayments().finally(() => (syncing = null))
    res.json(await syncing)
  } catch (e) {
    res.status(502).json({ error: `Tatum Sui gRPC: ${e.message}` })
  }
})

const paymentTerms = (req, inv) => ({
  scheme: 'exact',
  network: `sui:${sui.NETWORK}`,
  asset: sui.USDC_COIN_TYPE,
  maxAmountRequired: sui.toMicro(owed(inv)).toString(),
  amount: owed(inv),
  payTo: PAYEE(),
  resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  description: `Invoice ${inv.id} (${inv.description || 'services'})`,
  mimeType: 'application/json',
  maxTimeoutSeconds: 600,
  // Pay through Sui Payment Kit so the chain itself rejects a second payment for this invoice.
  extra: { paymentKit: { registry: sui.REGISTRY_NAME, registryId: sui.registryId(), nonce: inv.id }, paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(owed(inv)), nonce: inv.id, label: 'Invoice Chaser', message: `Invoice ${inv.id}` }) },
})

// x402: an invoice is a payable HTTP resource. Without X-PAYMENT you get 402 + terms; with a Sui
// transaction digest in X-PAYMENT the server verifies it through Tatum and returns a receipt.
// x402 v2 (spec: x402-foundation/x402, exact scheme on Sui): requirements travel base64-encoded in
// PAYMENT-REQUIRED; the agent answers with PAYMENT-SIGNATURE = { x402Version: 2, accepted, payload:
// { signature, transaction } }. We act as the facilitator through Tatum: verify, simulate, broadcast.
const b64json = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const requirementsV2 = (inv) => ({
  scheme: 'exact', network: `sui:${sui.NETWORK}`, amount: sui.toMicro(owed(inv)).toString(), asset: sui.USDC_COIN_TYPE, payTo: PAYEE(), maxTimeoutSeconds: 600,
  extra: { paymentKit: { registry: sui.REGISTRY_NAME, registryId: sui.registryId(), nonce: inv.id } },
})
const paymentRequiredV2 = (req, inv, error = 'Payment required') => ({
  x402Version: 2, error,
  resource: { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`, description: `Invoice ${inv.id} (${inv.description || 'services'})`, mimeType: 'application/json', serviceName: 'Invoice Chaser' },
  accepts: [requirementsV2(inv)],
})
async function x402v2(req, res, inv, header) {
  const fail = (reason, status = 402) => {
    res.set('PAYMENT-REQUIRED', b64json(paymentRequiredV2(req, inv, reason)))
    return res.status(status).json({ x402Version: 2, error: reason })
  }
  let p
  try {
    p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  } catch {
    return fail('invalid_payload', 400)
  }
  const want = requirementsV2(inv)
  const a = p?.accepted || {}
  if (p?.x402Version !== 2 || a.scheme !== 'exact' || a.network !== want.network || a.asset !== want.asset || a.amount !== want.amount || sui.normAddr(a.payTo) !== sui.normAddr(want.payTo)) return fail('payment_requirements_mismatch')
  const { signature, transaction } = p.payload || {}
  if (typeof signature !== 'string' || typeof transaction !== 'string' || transaction.length > 20_000) return fail('invalid_payload', 400)
  // one v2 settlement per invoice at a time (per instance), held from inspection through settlement
  if (x402Inflight.has(inv.id)) return fail('payment_in_progress', 409)
  if (mem.loadState.truncated?.length) return fail('memory_not_fully_loaded', 503)
  x402Inflight.add(inv.id)
  try {
    return await x402v2Settle(req, res, inv, want, signature, transaction, fail)
  } finally {
    x402Inflight.delete(inv.id)
  }
}
const x402Inflight = new Set()
async function x402v2Settle(req, res, inv, want, signature, transaction, fail) {
  if (state().invoices.find((i) => i.id === inv.id)?.status === 'paid') return fail('invoice_already_paid', 409)
  let check
  try {
    check = await sui.inspectSignedPayment(transaction, signature, PAYEE(), inv.id)
  } catch (e) {
    return fail(`verify_error: ${e.message}`, 502)
  }
  if (!check.ok) return fail(check.reason + (check.detail ? `: ${check.detail}` : ''))
  if (check.received !== BigInt(want.amount)) return fail(`amount_mismatch: simulated ${sui.fromMicro(check.received)} USDC to payTo, invoice needs ${owed(inv)}`)
  let digest
  try {
    const out = await sui.executeSigned(transaction, signature)
    digest = out?.Transaction?.digest || out?.transaction?.digest || out?.digest
  } catch (e) {
    return fail(`settlement_failed: ${e.message}`, 502)
  }
  let code, body
  for (let i = 0; i < 6; i++) {
    ;[code, body] = await settleDigest(inv.id, digest, 'x402-v2')
    if (!body.retry) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  res.set('PAYMENT-RESPONSE', b64json({ success: code === 200, transaction: digest, network: want.network, payer: check.sender, amount: want.amount, ...(code === 200 ? {} : { errorReason: body.error }) }))
  res.status(code).json({ ...body, protocol: 'x402-v2' })
}

router.get('/x402/:id', async (req, res) => {
  const inv = state().invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const v2 = req.get('payment-signature')
  if (v2 && inv.status !== 'paid') return x402v2(req, res, inv, v2)
  const payment = req.get('x-payment')
  if (!payment) {
    if (inv.status === 'paid') return res.json({ status: 'paid', invoice: inv.id, digest: inv.digest })
    res.set('Cache-Control', 'no-store')
    // v1 terms in the body, v2 in the PAYMENT-REQUIRED header: either kind of client can pay
    res.set('PAYMENT-REQUIRED', b64json(paymentRequiredV2(req, inv)))
    return res.status(402).json({ x402Version: 1, error: 'Payment required', accepts: [paymentTerms(req, inv)] })
  }
  if (!sui.DIGEST_RE.test(payment)) return res.status(400).json({ error: 'X-PAYMENT must be a Sui transaction digest' })
  const [code, body] = await settleDigest(inv.id, payment, 'x402')
  if (code === 200) res.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, transaction: inv.digest || payment, network: `sui:${sui.NETWORK}` })).toString('base64'))
  res.status(code).json(body)
})

// MPP (Machine Payments Protocol): the same invoice as an MPP charge. No credential -> 402 with a
// WWW-Authenticate: Payment challenge bound to this invoice; with one, @suimpp/mpp checks the transfer
// and the payer's signature, then the digest is verified again through Tatum and settled into Walrus.
router.get('/mpp/:id', (req, res, next) => {
  if (!mppEnabled()) return res.status(503).json({ error: 'MPP is not configured on this server' })
  const inv = state().invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (inv.status === 'paid') return res.json({ status: 'paid', invoice: inv.id, digest: inv.digest })
  res.set('Cache-Control', 'no-store')
  mpp(() => state().usedDigests).charge({ amount: owed(inv), description: `Invoice ${inv.id}`, meta: { invoice: inv.id } })(req, res, next)
}, async (req, res) => {
  const digest = credentialDigest(req)
  if (!digest || !sui.DIGEST_RE.test(digest)) return res.status(400).json({ error: 'MPP credential carries no Sui digest' })
  const [code, body] = await settleDigest(req.params.id, digest, 'mpp')
  res.status(code).json({ ...body, protocol: 'mpp' })
})

// MCP (Streamable HTTP, stateless): read-only tools over the learned memory for Claude/Cursor/agents.
// One JSON-RPC message per request so each tool call is charged to the rate-limit bucket; small bodies only.
router.post('/mcp', (req, res, next) => {
  if (Array.isArray(req.body)) return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Batch requests are not supported' }, id: null })
  if (Number(req.get('content-length') || 0) > 16_384) return res.status(413).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null })
  next()
})
router.post('/mcp', mcpHandler((req) => ({
  state,
  profileOf,
  plan,
  owed,
  search: (clientId, q) => mem.search(mem.clientNs(clientId), q, 5),
  terms: (inv) => paymentTerms(req, inv),
  learning: () => learningSummary(state().clients.map((c) => profileOf(c.id))),
  baseUrl: `${req.protocol}://${req.get('host')}`,
})))
router.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'MCP endpoint: POST JSON-RPC (Streamable HTTP, stateless)' }))

// Payer-facing: build the Payment Kit registry payment for the payer's wallet to sign.
router.post('/pay-tx', async (req, res) => {
  const { invoiceId, sender } = req.body || {}
  if (typeof sender !== 'string' || !sui.ADDRESS_RE.test(sender)) return res.status(400).json({ error: 'A valid Sui sender address is required' })
  const inv = state().invoices.find((i) => i.id === invoiceId)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (inv.status === 'paid') return res.status(409).json({ error: 'Invoice is already paid' })
  if (sender.toLowerCase() === PAYEE().toLowerCase()) return res.status(400).json({ error: 'Pay from a different wallet than the payee' })
  try {
    // Gas-free for the payer when the server's gas wallet can sponsor; otherwise the wallet pays gas.
    if (req.body.sponsored !== false && sui.sponsor()) {
      const sp = await sui.buildSponsoredInvoicePayment(sender, PAYEE(), sui.toMicro(owed(inv)), inv.id).catch((e) => ({ error: e.message }))
      if (sp && !sp.error) return res.json({ bytes: sp.bytes, amount: owed(inv), payee: PAYEE(), network: sui.NETWORK, sponsored: { sponsor: sp.sponsor, mac: sp.mac, gasBudgetMist: sp.gasBudgetMist } })
      if (/EDuplicatePayment|duplicate/i.test(sp?.error || '')) throw new Error(sp.error)
    }
    const bytes = await sui.buildInvoicePayment(sender, PAYEE(), sui.toMicro(owed(inv)), inv.id)
    // simulate through Tatum for the real fee, priced in USD with Tatum's rate API (best effort)
    const [fee, rate] = await Promise.all([sui.estimateFee(bytes).catch(() => null), usdRate('SUI').catch(() => null)])
    res.json({ bytes, amount: owed(inv), payee: PAYEE(), network: sui.NETWORK, fee: fee && { ...fee, usd: rate ? Math.round(fee.sui * rate.usd * 1e5) / 1e5 : null } })
  } catch (e) {
    const msg = e.message || ''
    res.status(400).json({ error: /EDuplicatePayment|duplicate/i.test(msg) ? 'This invoice was already paid on-chain' : /insufficient|balance|coin/i.test(msg) ? `Not enough USDC or SUI for gas in ${sender.slice(0, 10)}… on ${NET}` : `Could not build transaction: ${msg}` })
  }
})

// Balance watcher: a balance increase that equals an open invoice's unique amount flags that invoice.
let lastBalance = null
const likely = new Map()
// Sponsored payment: the payer signed the bytes the server built (and already co-signed as gas owner).
// Both signatures cover exactly those bytes, so this endpoint can only ever submit that payment.
router.post('/pay-sponsored', async (req, res) => {
  const { invoiceId, bytes, signature, mac } = req.body || {}
  if (![invoiceId, bytes, signature, mac].every((x) => typeof x === 'string' && x.length < 20_000)) return res.status(400).json({ error: 'invoiceId, bytes, signature and mac are required' })
  const kp = sui.sponsor()
  if (!kp) return res.status(503).json({ error: 'Gas sponsorship is not configured' })
  let data
  try {
    data = Transaction.from(Buffer.from(bytes, 'base64')).getData()
  } catch {
    return res.status(400).json({ error: 'Unreadable transaction bytes' })
  }
  if (sui.normAddr(data.gasData.owner) !== sui.normAddr(kp.getPublicKey().toSuiAddress())) return res.status(400).json({ error: 'Not a transaction this server sponsors' })
  const sponsorSignature = await sui.cosignSponsored(bytes, mac).catch(() => null)
  if (!sponsorSignature) return res.status(400).json({ error: 'These bytes were not built by this server' })
  try {
    const out = await sui.executeSigned(bytes, [signature, sponsorSignature])
    const digest = out?.Transaction?.digest || out?.transaction?.digest || out?.digest
    if (!digest) return res.status(502).json({ error: 'Execution returned no digest', out })
    let code, body
    for (let i = 0; i < 6; i++) {
      ;[code, body] = await settleDigest(invoiceId, digest, 'wallet-sponsored')
      // the live stream can see the checkpoint first and settle it: that's our payment, report success
      if (code === 409 && state().invoices.find((i) => i.id === invoiceId)?.digest === digest) {
        ;[code, body] = [200, { success: true, verifiedOnChain: true, message: `Paid: settled the moment it reached a checkpoint (live Tatum stream).`, explorer: `${sui.EXPLORER}/tx/${digest}` }]
        break
      }
      if (!body.retry && code !== 409) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    res.status(code).json({ ...body, digest, sponsored: true })
  } catch (e) {
    res.status(400).json({ error: `Sponsored execution failed: ${e.message}` })
  }
})

router.get('/cron-check', async (_req, res) => {
  try {
    const bal = await sui.usdcBalance(PAYEE())
    const delta = lastBalance === null ? 0n : bal - lastBalance
    lastBalance = bal
    const open = state().invoices.filter((i) => i.status === 'sent')
    const match = delta > 0n ? open.find((i) => sui.toMicro(i.payAmount) === delta) : null
    if (match) likely.set(match.id, new Date().toISOString())
    res.json({ timestamp: new Date().toISOString(), service: 'StateService.GetBalance', payeeAddress: PAYEE(), balance: sui.fromMicro(bal), delta: sui.fromMicro(delta < 0n ? 0n : delta), likelyPaid: match?.id || null, checkedInvoicesCount: open.length, status: 'ok' })
  } catch (e) {
    res.status(502).json({ status: 'error', error: e.message })
  }
})

router.get('/proof', async (_req, res) => {
  const [cp, bal, h, nss, rSui, rUsdc] = await Promise.allSettled([sui.latestCheckpoint(), sui.usdcBalance(PAYEE()), mem.health(), mem.namespaceCounts(), usdRate('SUI'), usdRate('USDC')])
  const counts = nss.status === 'fulfilled' ? nss.value : []
  res.json({
    tatumSuiGrpc: {
      endpoint: sui.GRPC_HOST,
      protocol: 'gRPC over TLS (sui.rpc.v2)',
      apiKeyConfigured: Boolean(process.env.TATUM_API_KEY),
      gatewayStatus: cp.status === 'fulfilled' ? 'connected' : 'error',
      latestCheckpoint: cp.status === 'fulfilled' ? cp.value.sequence : null,
      latencyMs: cp.status === 'fulfilled' ? cp.value.latencyMs : null,
      payeeAddress: PAYEE(),
      payeeBalance: bal.status === 'fulfilled' ? `${sui.fromMicro(bal.value)} USDC` : null,
      usdcCoinType: sui.USDC_COIN_TYPE,
      network: sui.NETWORK,
      rates: { SUI: rSui.status === 'fulfilled' ? rSui.value : null, USDC: rUsdc.status === 'fulfilled' ? rUsdc.value : null, api: 'Tatum Data API /v4/data/rate/symbol' },
      paymentKit: { registry: sui.REGISTRY_NAME, registryId: sui.registryId(), explorer: `${sui.EXPLORER}/object/${sui.registryId()}` },
      errorDetail: [cp, bal].find((x) => x.status === 'rejected')?.reason?.message || null,
    },
    walrusMemory: {
      relayerUrl: mem.RELAYER,
      sdk: '@mysten-incubation/memwal',
      relayerStatus: h.status === 'fulfilled' ? h.value.status : 'error',
      relayerLatencyMs: h.status === 'fulfilled' ? h.value.latencyMs : null,
      accountId: process.env.MEMWAL_ACCOUNT_ID,
      totalMemories: counts.reduce((s, n) => s + n.count, 0),
      namespaceCount: counts.length,
      namespaces: Object.fromEntries(counts.map((n) => [n.namespace, n.count])),
      pendingMemoriesCount: mem.pendingCount(),
      loadedAt: mem.loadState.loadedAt,
      sampleMemories: [...mem.store.entries()].map(([namespace, ms]) => ({ namespace, count: ms.length, latest: ms[0]?.sentence || '', blobId: ms.find((m) => m.blobId)?.blobId || null })),
    },
  })
})

export default router
