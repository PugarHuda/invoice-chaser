import { Router } from '../async-router.mjs'
import { Transaction } from '@mysten/sui/transactions'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import * as mem from '../memory.mjs'
import * as sui from '../sui.mjs'
import { usdRate } from '../rates.mjs'
import { screenAddress } from '../security.mjs'
import { mcpHandler } from '../mcp.mjs'
import { draftReminder } from '../drafter.mjs'
import { storeReceipt, receiptsEnabled, invoicePdf } from '../receipts.mjs'
import * as live from '../live.mjs'
import { ciiXml, seller } from '../facturx.mjs'
import { mpp, mppEnabled, credentialDigest } from '../mpp.mjs'
import { deriveState, computeProfile, plan, invoiceStatus, uniquePayAmount, isoDay, learningSummary, foldIcs, incentive, quoteAt, quotedAmounts, promiseDate, chaseAction } from '../engine.mjs'

const router = Router()
const PAYEE = () => process.env.SUI_PAYEE_ADDRESS
const DAY = 86_400_000

const PUBLIC_WRITES = new Set(['/verify-payment', '/pay-tx', '/pay-sponsored', '/pay-gasless', '/sync-payments', '/mcp'])

// Per-IP write budget so the public demo can't be used to flood Walrus or Tatum.
// ponytail: per-instance in-memory buckets; a shared store would make it global across instances
const buckets = new Map()
// sync has its own bucket: pages trigger it on load, and that must never use up a payer's payment budget
const LIMITS = { write: [30, 10 * 60_000], payment: [60, 10 * 60_000], expensive: [40, 10 * 60_000], sync: [120, 10 * 60_000] }
// GETs that call an external service on every request
const isExpensiveRead = (req) => (req.method === 'GET' && (/^\/clients\/[^/]+\/search$/.test(req.path) || /^\/pay\/[^/]+\/(live|invoice\.pdf)$/.test(req.path))) || req.path === '/mcp' || req.path === '/proof' || req.path === '/chase-queue' || /^\/clients\/[^/]+\/statement$/.test(req.path)
router.use((req, res, next) => {
  const isSync = req.path === '/sync-payments'
  const isPayment = (PUBLIC_WRITES.has(req.path) && req.path !== '/mcp' && !isSync) || req.path.startsWith('/x402/') || req.path.startsWith('/mpp/')
  const expensive = isExpensiveRead(req)
  if (req.method === 'GET' && !isPayment && !expensive) return next()
  const kind = isSync ? 'sync' : isPayment ? 'payment' : expensive ? 'expensive' : 'write'
  const [max, windowMs] = LIMITS[kind]
  // On Vercel the edge sets x-vercel-forwarded-for (clients can't spoof it). Elsewhere use req.ip,
  // which honours only the configured proxy hop ('trust proxy' = 1), never the client-supplied leftmost XFF.
  const ip = clientIp(req)
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
const passcodeMatches = (req) => {
  const pass = process.env.APP_PASSCODE
  if (!pass) return false
  const got = createHash('sha256').update(req.get('x-passcode') || '').digest()
  return timingSafeEqual(got, createHash('sha256').update(pass).digest())
}
// set once by the passcode gate below; every other owner check reads this flag, so no route can act as an un-throttled oracle
const isOwner = (req) => req.owner === true
// PRIVATE_READS=1 (with APP_PASSCODE set) also puts the owner's data behind the passcode: clients,
// invoices, memories, plans, exports and MCP. Payers and agents keep what they need: the pay page and its
// PDF/XML/live stream, x402, MPP, and aggregate-only /summary and /proof (the landing page's live stats).
// Failed passcode attempts per IP: 10 per 10 minutes, then 429, so the passcode can't be guessed at network speed.
const authFails = new Map()
const clientIp = (req) => (process.env.VERCEL && req.get('x-vercel-forwarded-for')) || req.ip || '?'
const AUTH_MAX_FAILS = 10
const authFail = (req) => {
  const f = authFails.get(clientIp(req))
  return f?.reset > Date.now() ? f : null
}
const tooManyFails = (res, f) => res.status(429).set('Retry-After', String(Math.ceil((f.reset - Date.now()) / 1000))).json({ error: 'Too many wrong passcodes, try again later' })
// checked BEFORE the passcode: a locked-out IP can't keep guessing, not even the right one
const lockedOut = (req, res) => {
  const f = authFail(req)
  return f && f.n >= AUTH_MAX_FAILS ? tooManyFails(res, f) : null
}
const denyOwner = (req, res, body = { error: 'Owner passcode required' }) => {
  const now = Date.now()
  if (authFails.size > 10_000) for (const [k, v] of authFails) if (v.reset <= now) authFails.delete(k)
  const f = authFail(req) || { n: 0, reset: now + 10 * 60_000 }
  f.n++
  authFails.set(clientIp(req), f)
  return f.n > AUTH_MAX_FAILS ? tooManyFails(res, f) : res.status(401).json(body)
}
// The one place a supplied passcode is checked: locked out -> 429, wrong -> counted failure, on every route
// (public reads included, since /summary etc. answer differently for the owner). No/empty header = not the owner.
router.use((req, res, next) => {
  req.owner = false
  if (!req.get('x-passcode')) return next()
  if (lockedOut(req, res)) return
  if (!passcodeMatches(req)) return denyOwner(req, res)
  req.owner = true
  next()
})
const privateReads = () => process.env.PRIVATE_READS === '1' && Boolean(process.env.APP_PASSCODE)
const PUBLIC_READS = [/^\/$/, /^\/pay\//, /^\/x402\//, /^\/mpp\//, /^\/proof$/, /^\/summary$/, /^\/cron\/sync$/]
const ownerView = (req) => !privateReads() || isOwner(req)
router.use((req, res, next) => {
  if (!privateReads() || isOwner(req)) return next()
  if ((req.method === 'GET' || req.method === 'HEAD') && !PUBLIC_READS.some((r) => r.test(req.path))) return denyOwner(req, res)
  if (req.path === '/mcp') return denyOwner(req, res, { jsonrpc: '2.0', error: { code: -32001, message: 'Owner passcode required (x-passcode header)' }, id: null })
  next()
})
// Owner-only writes. The payer-facing /verify-payment stays public; it only settles against verified chain data.
router.use((req, res, next) => {
  const pass = process.env.APP_PASSCODE
  if (req.method === 'GET' || PUBLIC_WRITES.has(req.path)) return next()
  // fail closed on a deploy that lost its passcode: Walrus memories can't be deleted, so open writes are permanent damage
  if (!pass) return process.env.VERCEL && process.env.ALLOW_OPEN_WRITES !== '1' ? res.status(503).json({ error: 'Owner writes are disabled: APP_PASSCODE is not set on this deployment' }) : next()
  if (!isOwner(req)) return denyOwner(req, res)
  next()
})

// After the rate limit and auth gates (a rejected request never triggers a Walrus load): the first request after boot rebuilds everything from Walrus Memory.
router.use(async (_req, res, next) => {
  await mem.ready()
  if (!mem.loadState.loaded) return res.status(503).set('Retry-After', '5').json({ error: 'Loading memory from Walrus failed; try again in a few seconds', detail: mem.loadState.error || null })
  next()
})

const state = () => deriveState(mem.store)
const memsFor = (clientId) => mem.clientMemories(clientId)
const profileOf = (clientId) => computeProfile(clientId, memsFor(clientId))
const clientName = (clients, id) => clients.find((c) => c.id === id)?.name || 'Unknown'
const withStatus = (inv) => ({ ...inv, status: invoiceStatus(inv) })
// time-ordered and collision-free even for concurrent requests
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
const takenAmounts = (invoices) => new Set(invoices.flatMap((i) => [i.payAmount, ...quotedAmounts(i)]))
const owed = (inv) => (inv.status === 'partial' && inv.remaining ? inv.remaining : inv.payAmount)

// API root: the api-catalog anchor (RFC 9727) resolves to an index of the machine-readable descriptions
router.get('/', (_req, res) => res.json({ name: 'Invoice Chaser API', openapi: '/openapi.json', apiCatalog: '/.well-known/api-catalog', llms: '/llms.txt', mcp: '/api/chaser/mcp', mcpServerCard: '/api/chaser/mcp/server-card', proof: '/api/chaser/proof', audit: '/api/chaser/audit', chaseQueue: '/api/chaser/chase-queue' }))

router.get('/summary', (req, res) => {
  const now = new Date()
  const horizon = isoDay(now.getTime() + 7 * DAY)
  const horizon30 = isoDay(now.getTime() + 30 * DAY)
  let expected30 = 0
  const today = isoDay(now)
  const { clients, invoices } = state()
  let expected = 0
  let overdue = 0
  // 7-day range from each client's learned delay spread: low = surely in by the horizon, high = possibly
  let expectedLow = 0
  let expectedHigh = 0
  const upcomingInflows = []
  const nextActions = []
  let hiddenSmall = 0
  for (const raw of invoices) {
    const inv = withStatus(raw)
    if (inv.status !== 'sent' && inv.status !== 'overdue' && !(inv.status === 'partial' && !inv.seed)) continue
    // invoices priced under 1 USDC are mainnet test payments (memories can't be deleted): kept everywhere
    // else, left out of Today's totals and lists
    if (Number(inv.baseAmount) < 1) { hiddenSmall++; continue }
    const profile = profileOf(inv.clientId)
    const p = plan(inv, profile)
    const predicted = p.predictedPayDate || inv.dueDate
    const t = inv.terms
    // what is still owed, terms included; a discount they are predicted to miss is forecast at full price
    const left = Number(t?.kind === 'early_discount' && !t.expired && inv.status !== 'partial' && predicted > t.until ? t.original : owed(inv))
    if (predicted <= horizon30) expected30 += left
    // a pay date can't be before today; an overdue invoice's window starts now
    const at = (d) => { const x = isoDay(new Date(`${inv.dueDate}T00:00:00Z`).getTime() + d * DAY); return x < today ? today : x }
    const earliest = at(profile.delayRange.low)
    const latest = at(profile.delayRange.high)
    if (latest <= horizon) expectedLow += left
    if (earliest <= horizon) expectedHigh += left
    if (predicted <= horizon) {
      expected += left
      upcomingInflows.push({ invoiceId: inv.id, clientName: clientName(clients, inv.clientId), payAmount: owed(inv), dueDate: inv.dueDate, predictedPayDate: predicted, earliest, latest, delayDays: p.predictedDelayDays ?? 0, status: inv.status })
    }
    if (inv.dueDate < today) overdue += left
    const step = p.steps.find((s) => s.date >= today) || p.steps.at(-1)
    nextActions.push({ invoiceId: inv.id, clientId: inv.clientId, clientName: clientName(clients, inv.clientId), amount: owed(inv), actionDate: step.date, recommendedTone: step.tone, reason: step.reason, underpayRisk: profile.underpayRate || null })
  }
  nextActions.sort((a, b) => a.actionDate.localeCompare(b.actionDate))
  res.json({
    expectedInflow7Days: expected.toFixed(2),
    expectedInflow7DaysRange: { low: expectedLow.toFixed(2), high: expectedHigh.toFixed(2) },
    expectedInflow30Days: expected30.toFixed(2),
    overdueAmount: overdue.toFixed(2),
    activeClientNamespaces: clients.length,
    // private mode, not the owner: totals only (the landing page's stats), no client names or amounts
    upcomingInflows: ownerView(req) ? upcomingInflows : [],
    nextActions: ownerView(req) ? nextActions : [],
    hiddenSmall,
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
  // memories are permanent on Walrus: contact is optional short text, nothing else
  const contact = req.body?.contact == null || req.body.contact === '' ? null : req.body.contact
  if (contact !== null && (typeof contact !== 'string' || contact.length > 120)) return res.status(400).json({ error: 'contact must be text of 120 characters or fewer' })
  const id = newId('c')
  const m = mem.remember(mem.writeNs(id), `New client ${name} added.`, { type: 'client_created', client: id, name, contact })
  res.json({ client: { id, name }, memory: m })
})

router.get('/clients/:id', (req, res) => {
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  res.json({ client: { ...client, email: client.contact, address: null }, profile: profileOf(client.id), memories: memsFor(client.id), namespace: mem.clientNs(client.id), namespaces: mem.clientShards(client.id) })
})

router.post('/clients/:id/preference', (req, res) => {
  const note = String(req.body?.preference || '').trim()
  if (!note) return res.status(400).json({ error: 'preference is required' })
  if (note.length > 300) return res.status(400).json({ error: 'keep rules under 300 characters' })
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const m = mem.remember(mem.writeNs(client.id), `Rule for ${client.name}: "${note}"`, { type: 'preference', client: client.id, note })
  res.json({ success: true, memory: m, profile: profileOf(client.id) })
})

// Walrus blobs can't be deleted, so "forget this rule" is itself a memory: the engine ignores
// any rule whose text was revoked after it was written.
router.post('/clients/:id/revoke', (req, res) => {
  const rule = String(req.body?.rule || '').trim()
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  if (!profileOf(client.id).preferences.includes(rule)) return res.status(400).json({ error: 'not an active rule for this client' })
  const m = mem.remember(mem.writeNs(client.id), `Rule revoked for ${client.name}: "${rule}" no longer applies.`, { type: 'rule_revoked', client: client.id, rule })
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
  const m = mem.remember(mem.writeNs(client.id), `${client.name} pays from ${name ? `${name} (${address.slice(0, 10)}…)` : address}${screen ? `; Tatum screening: ${screen.verdict}` : ''}.`, { type: 'payer_expected', client: client.id, payer: address, name, screen: screen?.verdict || null })
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
    const mode = mem.SEARCH_MODES[req.query.mode] ? String(req.query.mode) : 'relevance'
    res.json({ query: q, mode, results: await mem.search(client.id, q, 5, mode) })
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
  // when the email/call happened (YYYY-MM-DD or ISO); defaults to now
  const occurredAt = req.body?.receivedAt ? new Date(req.body.receivedAt) : new Date()
  if (Number.isNaN(occurredAt.getTime()) || occurredAt > new Date(Date.now() + DAY)) return res.status(400).json({ error: 'receivedAt must be a past date' })
  try {
    const ns = mem.writeNs(client.id, 41)
    const facts = await mem.ingestNotes(ns, text, occurredAt)
    // a promise to pay ("we'll pay next Friday"): the facts carry it as an absolute date; tie it to the
    // invoice named in the text, else the client's largest open invoice
    const date = facts.map(promiseDate).find(Boolean) || promiseDate(text)
    let promise = null
    if (date) {
      const open = state().invoices.filter((i) => i.clientId === client.id && i.status !== 'paid' && !i.seed)
      const inv = open.find((i) => text.includes(i.id)) || open.sort((a, b) => Number(b.baseAmount) - Number(a.baseAmount))[0]
      if (inv) {
        promise = { invoice: inv.id, date }
        mem.remember(ns, `${client.name} promised to pay ${inv.id} by ${date}.`, { type: 'promise', client: client.id, invoice: inv.id, date, source: 'notes' })
      }
    }
    res.json({ success: true, facts, promise, profile: profileOf(client.id) })
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
  if (description != null && typeof description !== 'string') return res.status(400).json({ error: 'description must be text' })
  if (description && description.length > 200) return res.status(400).json({ error: 'description must be 200 characters or fewer' })
  const id = newId('inv')
  const payAmount = uniquePayAmount(amount, takenAmounts(invoices))
  const m = mem.remember(mem.writeNs(clientId), `Invoice ${id} sent to ${client.name}: ${payAmount} USDC due ${dueDate}.`, { type: 'invoice_sent', client: clientId, invoice: id, base: Number(amount), pay_amount: payAmount, due: dueDate, description: description || '' })
  res.json({ invoice: { id, payAmount }, memory: m })
})

// Public, payer-facing view: only what a client needs to pay. Never the learned profile or plan.
router.get('/pay/:id', async (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const i = withStatus(inv)
  res.json({
    invoice: {
      id: i.id, clientId: i.clientId, clientName: clientName(clients, i.clientId), baseAmount: i.baseAmount, payAmount: owed(i), originalAmount: i.payAmount, remaining: i.remaining ?? null, status: i.status, dueDate: i.dueDate, issuedDate: i.issuedDate, description: i.description, digest: i.digest,
      payeeAddress: PAYEE(), coinType: sui.USDC_COIN_TYPE, network: sui.NETWORK, registry: sui.REGISTRY_NAME,
      paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(owed(i)), nonce: i.id, label: 'Invoice Chaser', message: `Invoice ${i.id}` }),
      slushPayUrl: sui.slushPayUrl({ payee: PAYEE(), micro: sui.toMicro(owed(i)), nonce: i.id, label: 'Invoice Chaser', message: `Invoice ${i.id}` }),
      explorerTx: i.digest ? `${sui.EXPLORER}/tx/${i.digest}` : null,
      paidOn: i.status === 'paid' ? i.settledAt || null : null,
      receipt: receiptOf(i),
      eInvoice: Boolean(seller()),
      // anti-fraud signal for the payer: the payee's SuiNS name (Tatum NameService, cached 1 h) and how many
      // payments to this exact address are already on record in Walrus Memory, with the first one's date
      payee: await (async () => {
        const paid = invoices.filter((x) => x.status === 'paid' && x.payments?.some((p) => p.digest)).map((x) => x.settledAt).filter(Boolean).sort()
        return { name: await sui.suinsName(PAYEE()), recordedPayments: paid.length, since: paid[0] || null }
      })(),
      terms: i.terms ? { kind: i.terms.kind, pct: i.terms.pct, until: i.terms.until, original: i.terms.original, expired: Boolean(i.terms.expired) } : null,
    },
  })
})

// Factur-X CII XML for an invoice, or null when the seller identity (SELLER_NAME / SELLER_COUNTRY) is not set.
const facturXOf = (i, clients) => {
  const s = seller()
  return s && ciiXml({ id: i.id, issuedDate: i.issuedDate || i.createdAt, client: clientName(clients, i.clientId), total: i.payAmount, due: i.status === 'paid' ? 0 : owed(i), seller: s })
}
router.get('/pay/:id/invoice.xml', (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const xml = facturXOf(withStatus(inv), clients)
  if (!xml) return res.status(501).json({ error: 'E-invoice export needs the seller identity: set SELLER_NAME and SELLER_COUNTRY (ISO 3166 alpha-2)' })
  res.type('application/xml').set({ 'Content-Disposition': `attachment; filename="factur-x-${inv.id}.xml"`, 'Cache-Control': 'no-store' }).send(xml)
})

// The invoice as a PDF (QR + pay link + agent endpoints), built on request; nothing is stored.
router.get('/pay/:id/invoice.pdf', async (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const i = withStatus(inv)
  const base = `${req.protocol}://${req.get('host')}`
  let pdf
  try {
    pdf = await invoicePdf({
    id: i.id, client: clientName(clients, i.clientId), description: i.description, issuedDate: i.issuedDate, dueDate: i.dueDate, amount: owed(i),
    payee: PAYEE(), network: sui.NETWORK, status: i.status, digest: i.digest, explorer: sui.EXPLORER,
    paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(owed(i)), nonce: i.id, label: 'Invoice Chaser', message: `Invoice ${i.id}` }),
    payUrl: `${base}/?pay=${i.id}`, mppUrl: `${base}/api/chaser/mpp/${i.id}`, x402Url: `${base}/api/chaser/x402/${i.id}`,
    facturX: facturXOf(i, clients),
    })
  } catch (e) {
    return res.status(500).json({ error: `Could not render the invoice PDF: ${e.message}` })
  }
  res.type('application/pdf').set({ 'Content-Disposition': `inline; filename="invoice-${i.id}.pdf"`, 'Cache-Control': 'no-store' }).send(Buffer.from(pdf))
})

// Live pay page: Server-Sent Events fed by Tatum's gRPC checkpoint stream. The moment a checkpoint
// moves this invoice's exact amount to the payee, the digest goes through the same verify/settle
// path as everything else, so a stream hit can never settle what a manual check would reject.
const LIVE_MS = 240_000 // ponytail: under Vercel's function limit; the page reconnects when it ends
const LIVE_SETTLE_TRIES = 4 // ~20 s of retries for a transient settle miss
const liveByIp = new Map() // ponytail: per-instance; ip -> (invoice -> finish) so one client can't take every slot
router.get('/pay/:id/live', (req, res) => {
  const inv = state().invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const ip = clientIp(req)
  // One stream per (address, invoice): a reload, a tab switch or a second tab REPLACES the older stream
  // (the platform may not report the old client's disconnect for minutes). Up to 4 invoices per address.
  const mine = liveByIp.get(ip) || new Map()
  mine.get(inv.id)?.('replaced')
  if (mine.size >= 4 && !mine.has(inv.id)) return res.status(429).set('Retry-After', '60').json({ error: 'Too many live streams from this address; close another pay page or try again in a minute' })
  liveByIp.set(ip, mine)
  const release = () => { if (mine.get(inv.id) === finishRef) mine.delete(inv.id); if (!mine.size) liveByIp.delete(ip) }
  let finishRef = null
  res.once('close', () => { finishRef?.(); release() })
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
  const finish = (reason) => {
    if (closed) return
    closed = true
    release()
    // the older tab is told why, so it stops instead of reconnecting and kicking the new one
    if (reason === 'replaced') send('replaced', { invoice: inv.id })
    stop()
    clearTimeout(timer)
    res.end()
  }
  finishRef = finish
  mine.set(inv.id, finish)
  const timer = setTimeout(() => (send('timeout', { after: LIVE_MS / 1000 }), finish()), LIVE_MS)
  try {
    stop = live.watch(PAYEE(), [...new Set([owed(inv), ...(inv.status === 'sent' || inv.status === 'overdue' ? quotedAmounts(inv) : [])])].map((a) => sui.toMicro(a)), async (digest, seq) => {
      send('seen', { digest, checkpoint: seq })
      // the tx shows up in exactly one checkpoint, so a transient miss (ledger lag 404, lock held 409,
      // gateway/memory 5xx) must be retried here or the stream never settles it
      let code, body
      for (let attempt = 1; ; attempt++) {
        ;[code, body] = await settleDigest(inv.id, digest, 'live-stream')
        const transient = code === 404 || code === 409 || code >= 500 || body?.retry
        if (closed || !transient || attempt === LIVE_SETTLE_TRIES) break
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
      if (closed) return
      if (code === 200) {
        send('paid', { invoice: inv.id, digest, checkpoint: seq, message: body.message, explorer: body.explorer })
        finish()
      } else send('rejected', { digest, error: body.error })
    }, (seq, error) => {
      if (error) return send('error', { error })
      if (Date.now() - lastSent > 2000) {
        lastSent = Date.now()
        send('checkpoint', { checkpoint: seq, provider: sui.provider() })
      }
    })
  } catch (e) {
    send('error', { error: String(e.message || e) })
    return finish()
  }
  send('watching', { invoice: inv.id, amount: owed(inv), payee: PAYEE(), provider: sui.provider(), via: sui.provider() === 'tatum' ? 'Tatum gRPC SubscriptionService.SubscribeCheckpoints' : `public Sui fullnode SubscribeCheckpoints (${sui.fallbackReason()})` })
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
        mem.remember(mem.writeNs(inv.clientId), `Stored a PDF receipt for ${inv.id} (${name}) on Walrus as blob ${r.blobId}.`, { type: 'receipt_stored', client: inv.clientId, invoice: inv.id, blob_id: r.blobId, object_id: r.objectId, url: r.url, end_epoch: r.endEpoch })
        return r
      })().finally(() => receiptInflight.delete(inv.id)))
    }
    res.json(await receiptInflight.get(inv.id))
  } catch (e) {
    res.status(502).json({ error: `Walrus: ${e.message}` })
  }
})

router.get('/invoices/:id', async (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const profile = profileOf(inv.clientId)
  res.json({
    invoice: {
      ...withStatus(inv),
      // same contract as /pay/:id: payAmount is what is still owed (a partial asks only for the rest)
      payAmount: owed(withStatus(inv)),
      originalAmount: inv.payAmount,
      clientName: clientName(clients, inv.clientId),
      payeeAddress: PAYEE(),
      coinType: sui.USDC_COIN_TYPE,
      network: sui.NETWORK,
      paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(owed(withStatus(inv))), nonce: inv.id, label: 'Invoice Chaser', message: `Invoice ${inv.id}` }),
      registry: sui.REGISTRY_NAME,
      explorerTx: inv.digest ? `${sui.EXPLORER}/tx/${inv.digest}` : null,
      receipt: receiptOf(inv),
      receiptsEnabled: receiptsEnabled(),
    },
    payerLiquidity: await payerLiquidityOf(inv),
    adaptivePlan: plan(inv, profile),
    incentive: incentive(withStatus(inv), profile),
    defaultPlan: plan(inv, profile, { ignoreMemory: true }),
    profile,
  })
})

// Apply the learned incentive (early-payment discount or late fee). The server recomputes it: the request
// only says which kind the owner approved, so a caller cannot pick its own percentage.
router.post('/invoices/:id/terms', async (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (inflight.has(inv.id) || x402Inflight.has(inv.id) || [...reservedDigests.values()].some((r) => r.invoiceId === inv.id && Date.now() - r.at < RESERVE_MS))
    return res.status(409).json({ error: 'A payment for this invoice is in progress; try again in a moment' })
  // a payment already on-chain under the current or an earlier amount must settle first, not be repriced
  const recs = await sui.findInvoicePayments(PAYEE(), quotedAmounts(inv).map((a) => ({ nonce: inv.id, micro: sui.toMicro(a) }))).catch(() => null)
  if (!recs) return res.status(502).json({ error: 'Payment Kit registry lookup failed; try again in a few seconds' })
  if (recs.size) return res.status(409).json({ error: `This invoice already has an on-chain payment (${[...recs.values()][0]}); run Sync payments first` })
  const rec = incentive(withStatus(inv), profileOf(inv.clientId))
  if (!rec.kind) return res.status(409).json({ error: rec.reason })
  if (req.body?.kind !== rec.kind) return res.status(409).json({ error: `The current recommendation is ${rec.kind.replace('_', ' ')}, not ${String(req.body?.kind || 'none').replace('_', ' ')}` })
  const payAmount = uniquePayAmount(rec.newBase, takenAmounts(invoices))
  const name = clientName(clients, inv.clientId)
  const sentence = rec.kind === 'early_discount'
    ? `Invoice ${inv.id} for ${name}: ${rec.pct}% early-payment discount, ${payAmount} USDC if paid by ${rec.until} (otherwise ${inv.payAmount} USDC).`
    : `Invoice ${inv.id} for ${name}: ${rec.pct}% late fee added, now ${payAmount} USDC (was ${inv.payAmount} USDC).`
  const m = mem.remember(mem.writeNs(inv.clientId), sentence, { type: 'invoice_terms', client: inv.clientId, invoice: inv.id, kind: rec.kind, pct: rec.pct, until: rec.until || null, pay_amount: payAmount, was: inv.payAmount })
  res.json({ invoice: { id: inv.id, payAmount }, terms: rec, memory: m })
})

// Record a promise to pay by a date (owner): the plan holds reminders until then and the profile
// learns whether this client keeps promises.
router.post('/invoices/:id/promise', (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (inv.status === 'paid') return res.status(409).json({ error: 'Invoice is already paid' })
  const date = String(req.body?.date || '')
  if (isoDay(`${date}T00:00:00Z`) !== date) return res.status(400).json({ error: 'date must be a real calendar day (YYYY-MM-DD)' })
  const name = clientName(clients, inv.clientId)
  const m = mem.remember(mem.writeNs(inv.clientId), `${name} promised to pay ${inv.id} by ${date}.`, { type: 'promise', client: inv.clientId, invoice: inv.id, date, source: 'owner' })
  res.json({ promise: { invoice: inv.id, date }, memory: m })
})

router.post('/invoices/:id/remind', async (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const p = plan(inv, profileOf(inv.clientId))
  const tone = ['friendly', 'formal', 'firm'].includes(req.body?.tone) ? req.body.tone : p.steps[0].tone
  const name = clientName(clients, inv.clientId)
  const offset = Math.round((Date.now() - new Date(`${inv.dueDate}T00:00:00Z`)) / DAY)
  // a fresh Walrus recall for this client and tone, under a token budget, joins the plan's own citations
  const ctx = await mem.contextFor(inv.clientId, `how ${name} responds to ${tone} payment reminders and when they pay`, 400).catch((e) => ({ sentences: [], error: e.message }))
  // the LLM writes the words; tone, amount, dates and the facts it may use come from the engine + Walrus
  const draft = await draftReminder({
    client: name,
    tone,
    invoice: { id: inv.id, owed: owed(inv), dueDate: inv.dueDate, description: inv.description },
    payLink: `${req.protocol}://${req.get('host')}/?pay=${inv.id}`,
    facts: [...new Set([...(p.cites || []).map((c) => c.sentence), ...ctx.sentences])],
  })
  const m = mem.remember(mem.writeNs(inv.clientId), `Sent a ${tone} reminder to ${name} for ${inv.id} (due ${offset >= 0 ? '+' : ''}${offset}d).`, { type: 'reminder_sent', client: inv.clientId, invoice: inv.id, tone, day_offset: offset, planned_tone: p.steps[0].tone, cites: (p.cites || []).map((c) => c.blobId).filter(Boolean), drafted_by: draft.source === 'llm' ? draft.model : 'template' })
  // agreed terms are stated by the server, never left to the model
  const t = inv.terms && !inv.terms.expired ? inv.terms : null
  const termsLine = !t ? '' : t.kind === 'early_discount' ? `\nThis includes a ${t.pct}% early-payment discount if paid by ${t.until}; after that the full ${t.original} USDC applies.` : `\nThis includes a ${t.pct}% late fee (the original amount was ${t.original} USDC).`
  res.json({ memoryContext: { hits: ctx.hits ?? 0, tokenEstimate: ctx.tokenEstimate ?? 0, truncated: Boolean(ctx.truncated), dropped: ctx.dropped ?? 0, error: ctx.error || null }, text: draft.text + termsLine, draftedBy: draft.source, model: draft.model || null, fallbackReason: draft.reason || null, memory: m })
})

// ---- Payments ------------------------------------------------------------------------------
// Every path (pasted digest, wallet, x402 agent, Payment Kit auto-sync) ends in settleDigest():
// verify on Sui through Tatum, then remember the outcome in Walrus Memory.
const inflight = new Set()
// Grows only: digests this process has settled. No reload can clear it.
const settledDigests = new Set()
const NET = sui.NETWORK === 'mainnet' ? 'Sui Mainnet' : 'Sui Testnet'

// Gasless transfers carry no on-chain nonce, so the digest (known from the bytes before signing) is
// reserved for its invoice at build time: no endpoint may settle it against a different invoice.
// ponytail: per instance, 30 min TTL; a reservation shared across instances would need a store
const reservedDigests = new Map()
const RESERVE_MS = 30 * 60_000
function reserveDigest(digest, invoiceId) {
  for (const [d, r] of reservedDigests) if (Date.now() - r.at > RESERVE_MS) reservedDigests.delete(d)
  reservedDigests.set(digest, { invoiceId, at: Date.now() })
}
// extraTag: protocol fields remembered with the payment (e.g. the x402 payment-identifier and its fingerprint)
// opts.allowInexact: settle a plain transfer whose amount isn't exactly this invoice's (owner, or a transfer
// the server built for this invoice). Public callers can't: anyone could aim someone else's payment at it.
async function settleDigest(invoiceId, requested, channel, extraTag = {}, opts = {}) {
  const held = reservedDigests.get(requested)
  if (held && held.invoiceId !== invoiceId && Date.now() - held.at < RESERVE_MS) return [409, { error: 'This payment was built for a different invoice' }]
  const { invoices } = state()
  const inv0 = invoices.find((i) => i.id === invoiceId)
  if (!inv0) return [404, { error: 'Invoice not found' }]
  if (inv0.status === 'paid') return [409, { error: 'Invoice is already paid' }]
  // global on purpose: spent digests are checked across every client, so any missing namespace could hide one
  if (mem.loadState.truncated?.length) return [503, { error: 'Memory recall is incomplete; refusing to settle until every namespace is fully loaded' }]
  // the last Walrus sync failed: spent digests from other instances may be missing, so don't settle on stale state
  if (mem.loadState.error) { mem.loadAll().catch(() => {}); return [503, { error: 'Memory sync from Walrus failed; retrying, try again in a few seconds', retry: true }] }
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
    // The discount deadline is judged by when the chain says it was paid, not when we verify it: an
    // on-time payment of the discounted amount that is only seen after the deadline still settles in full.
    // (and an amount quoted before a late fee was added pays it in full if it was paid before that)
    const quoted = inv.status === 'sent' && tx.timestamp ? quoteAt(inv, new Date(tx.timestamp).toISOString()) : null
    const discountHonored = Boolean(quoted && quoted !== inv.payAmount && tx.received === sui.toMicro(quoted))
    const expected = discountHonored ? sui.toMicro(quoted) : sui.toMicro(owed(inv)) // the full amount, or what's left after a partial payment
    // A transfer that exactly matches another open invoice's unique amount belongs to that one.
    // A Payment Kit payment names its invoice (nonce): it must be THIS invoice's registry record.
    if (tx.paymentKit) {
      const bound = await sui.findInvoicePayment(PAYEE(), tx.received, inv.id).catch(() => undefined)
      if (bound === undefined) return [502, { error: 'Payment Kit registry lookup failed; try again in a few seconds', retry: true }]
      if (bound !== digest) return [409, { error: `This Payment Kit payment was made for a different invoice, not ${inv.id}` }]
    } else {
      // Plain transfer: the unique amount is the fingerprint, including what's left on partially paid invoices.
      // Another open invoice's unique amount always wins (it is the designed fingerprint). A partial's remainder
      // only blocks when the transfer is not exactly what THIS invoice owes, so two equal remainders can't block
      // each other while a remainder can never capture another invoice's unique amount.
      // Same rule as settling: an open invoice also claims the amount it was quoted at the payment's chain time.
      const txAt = tx.timestamp ? new Date(tx.timestamp).toISOString() : null
      const claims = (i) => sui.toMicro(i.payAmount) === tx.received || (i.status === 'sent' && txAt && quoteAt(i, txAt) && sui.toMicro(quoteAt(i, txAt)) === tx.received)
      const other = now.find((i) => i.id !== inv.id && i.status !== 'paid' && (claims(i) || (tx.received !== expected && i.status === 'partial' && sui.toMicro(owed(i)) === tx.received)))
      if (other) return [409, { error: `This transfer matches ${other.id}'s exact amount, not ${inv.id}` }]
      // the unique amount is the only thing tying a plain transfer to this invoice: anything else needs the
      // owner (or a transfer the server built and reserved for this invoice, e.g. a gasless partial)
      const exact = new Set([expected, ...(inv.status === 'sent' ? quotedAmounts(inv).map((a) => sui.toMicro(a)) : [])])
      const builtForThis = held && held.invoiceId === inv.id
      if (!exact.has(tx.received) && !opts.allowInexact && !builtForThis)
        return [400, { error: `This transfer (${sui.fromMicro(tx.received)} USDC) isn't exactly what ${inv.id} asks (${owed(inv)} USDC), so it can't be matched automatically. Pay the exact amount, or ask the invoice owner to settle it.` }]
    }

    const full = tx.received >= expected
    // a dust transfer named against someone else's invoice must not write a permanent "underpaid" memory
    // ponytail: 1% floor; exact-amount-only would also block real underpayments, which the profile learns from
    if (!full && tx.received * 100n < expected) return [400, { error: `A partial payment must be at least 1% of what is owed (${sui.fromMicro(expected / 100n)} USDC)` }]
    const totalReceived = (discountHonored ? 0n : sui.toMicro(inv.payAmount) - expected) + tx.received
    const paid = isoDay(tx.timestamp || Date.now())
    // negative = paid early; kept as-is so the profile can learn early payers (plans still clamp at due)
    const delay = Math.round((new Date(paid) - new Date(inv.dueDate)) / DAY)
    const ms = memsFor(inv.clientId)
    const last = ms.find((m) => m.tag?.type === 'reminder_sent' && m.tag.invoice === inv.id)
    // Payer recognition: who paid, their SuiNS name, and whether this client has paid from it before.
    const payer = tx.sender || (await sui.txSender(digest).catch(() => null))
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
      mem.writeNs(inv.clientId),
      full
        ? `${name} paid ${inv.id} in full (${received} USDC) on ${paid}, ${delay < 0 ? `${-delay} day(s) before due` : `${delay} day(s) after due`}, after ${inv.reminders} reminder(s)${last ? `; last tone ${last.tag.tone}` : ''}${who}${over ? `; overpaid by ${over} USDC (credit)` : ''}.`
        : `${name} underpaid ${inv.id}: ${received} of ${owed(inv)} USDC on ${paid}; ${sui.fromMicro(expected - tx.received)} still owed${who}.`,
      { ...extraTag, type: full ? 'invoice_paid' : 'invoice_partial', client: inv.clientId, invoice: inv.id, due: inv.dueDate, paid, delay_days: delay, reminders: inv.reminders, last_tone: last?.tag.tone || null, expected: discountHonored ? quoted : inv.payAmount, received, digest, checkpoint: tx.checkpoint, channel, network: sui.NETWORK, payer, payer_name: payerName, new_payer: newPayer, unexpected_payer: unexpectedPayer, payer_screen: screen?.verdict || null, total_received: sui.fromMicro(totalReceived), overpaid: over, verified_via: sui.provider() },
    )
    return [200, { success: true, verifiedOnChain: true, received, full, payer, payerName, newPayer, unexpectedPayer, payerScreen: screen, memory: m, explorer: `${sui.EXPLORER}/tx/${digest}`, invoice: { ...inv, status: full ? 'paid' : 'partial', digest }, overpaid: over, message: `Verified on ${NET} via ${sui.provider() === 'tatum' ? 'Tatum' : `the public Sui fullnode (${sui.fallbackReason()})`}: ${received} USDC received${over ? ` (${over} more than owed, kept as a credit)` : ''}${unexpectedPayer ? ' from an UNEXPECTED payer wallet' : newPayer ? ' from a NEW payer wallet' : ''}.` }]
  } finally {
    inflight.delete(requested)
    inflight.delete(invoiceId)
  }
}

router.post('/verify-payment', async (req, res) => {
  const { invoiceId, digest } = req.body || {}
  if (typeof invoiceId !== 'string' || typeof digest !== 'string' || !sui.DIGEST_RE.test(digest)) return res.status(400).json({ error: 'invoiceId and a valid Sui transaction digest are required' })
  const [code, body] = await settleDigest(invoiceId, digest, req.body.channel === 'wallet' ? 'wallet' : 'pay-page', {}, { allowInexact: isOwner(req) })
  res.status(code).json(body)
})

// Payment Kit auto-sync: look every open invoice up in the on-chain PaymentRegistry (nonce = invoice id).
// Payers never have to report a digest; anything paid through the registry settles itself.
let lastSync = 0
let syncing = null
let lastReconcile = 0
let reconcileBalance = null // payee USDC balance at the last clean reconcile scan (per instance)
async function syncPayments() {
  const open = state().invoices.filter((i) => i.status === 'sent' || (i.status === 'partial' && !i.seed))
  const settled = []
  // every (invoice, amount) a payment could be keyed by, including amounts quoted under earlier terms,
  // looked up in one BatchGetObjects call through Tatum
  const wanted = open.flatMap((inv) => [...new Set([owed(inv), ...(inv.status === 'sent' ? quotedAmounts(inv) : [])])].map((a) => ({ inv, nonce: inv.id, micro: sui.toMicro(a) })))
  const records = wanted.length ? await sui.findInvoicePayments(PAYEE(), wanted) : new Map()
  for (const inv of open) {
    const hit = wanted.find((w) => w.inv === inv && records.has(`${w.nonce}|${w.micro}`))
    const digest = hit ? records.get(`${hit.nonce}|${hit.micro}`) : null
    if (!digest) continue
    const [code, body] = await settleDigest(inv.id, digest, 'payment-kit')
    settled.push({ invoice: inv.id, digest, code, message: body.message || body.error })
  }
  // Plain USDC transfers (an exchange withdrawal, any wallet) carry no nonce: match the newest
  // transactions that touched the payee by the invoice's unique micro-amount, never older than the
  // invoice. Only full unsent amounts are matched (a remaining balance is not unique). settleDigest
  // re-verifies every candidate through Tatum and refuses reused digests.
  const unpaid = state().invoices.filter((i) => i.status === 'sent' && !i.seed && !settled.some((x) => x.invoice === i.id && x.code === 200))
  let reconciled = 0
  let scanned = 0
  // the ListTransactions scan is the costly part: at most once per 5 minutes per instance, and only when
  // one cheap StateService.GetBalance shows the payee's USDC changed since the last clean scan
  let skippedByBalance = false
  if (unpaid.length && Date.now() - lastReconcile > 5 * 60_000) {
    lastReconcile = Date.now()
    const bal = await sui.usdcBalance(PAYEE()).catch(() => null)
    if (bal !== null && bal === reconcileBalance) skippedByBalance = true
    else {
      const { usedDigests } = state()
      const since = unpaid.map((i) => i.createdAt).filter(Boolean).sort()[0] || null
      const incoming = await sui.recentIncoming(PAYEE(), { since })
      scanned = incoming.scanned
      let clean = true
      for (const inv of unpaid) {
        const want = new Set(quotedAmounts(inv).map((a) => sui.toMicro(a)))
        const hit = incoming.find((t) => want.has(t.received) && !usedDigests.has(t.digest) && (!t.timestamp || !inv.createdAt || t.timestamp >= inv.createdAt))
        if (!hit) continue
        const [code, body] = await settleDigest(inv.id, hit.digest, 'reconcile')
        if (code === 200) reconciled++
        if (code >= 500 || body.retry) clean = false // try again next round even if the balance doesn't move
        settled.push({ invoice: inv.id, digest: hit.digest, code, message: body.message || body.error, via: 'reconcile' })
      }
      if (clean) reconcileBalance = bal
    }
  }
  lastSync = Date.now()
  return { checked: open.length, settled, reconciled, scannedTransactions: scanned, skippedByBalance, at: new Date(lastSync).toISOString() }
}
router.post('/sync-payments', async (req, res) => {
  // ponytail: one sync per instance per 60 s whoever asks; each open invoice costs one gRPC lookup
  // (at 10 s, a few open pay pages alone burned through the Tatum plan's credits)
  if (Date.now() - lastSync < 60_000 && !syncing) return res.json({ checked: 0, settled: [], cached: true })
  try {
    syncing ??= syncPayments().finally(() => (syncing = null))
    const r = await syncing
    // private mode, not the owner: counts only (no invoice ids, digests or messages naming clients)
    res.json(ownerView(req) ? r : { checked: r.checked, settled: r.settled.filter((x) => x.code === 200).length, at: r.at })
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
  extensions: {
    bazaar: bazaarV2(inv),
    // x402 payment-identifier extension: an agent may send an idempotency id; a retry of the same payment
    // gets the original result back (looked up in Walrus Memory, so it holds across instances and restarts)
    'payment-identifier': { info: { required: false }, schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { required: { type: 'boolean' }, id: { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' } }, required: ['required'] } },
  },
})
// x402 Bazaar discovery extension (coinbase/x402 specs/extensions/bazaar.md): tells x402 catalogs and
// agents what this resource takes and returns; routeTemplate keys every invoice to one catalog entry.
export const bazaarV2 = (inv) => ({
  info: {
    input: { type: 'http', method: 'GET', pathParams: { id: inv.id } },
    output: { type: 'json', example: { success: true, invoice: inv.id, digest: '<sui tx digest>', explorer: `${sui.EXPLORER}/tx/<digest>` } },
  },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      input: { type: 'object', properties: { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: ['GET'] }, pathParams: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['type', 'method'], additionalProperties: false },
      output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] },
    },
    required: ['input'],
  },
  routeTemplate: '/api/chaser/x402/:id',
})
// Failures follow the x402 v2 HTTP transport: a standard errorReason (detail in errorMessage) in a
// PAYMENT-RESPONSE with success:false, and fresh PAYMENT-REQUIRED terms on a 402.
const X402_REASON = { invalid_transaction: 'invalid_payload', invalid_signature: 'invalid_payload', signer_is_not_sender: 'invalid_payload', simulation_failed: 'invalid_transaction_state', payment_kit_required: 'invalid_payment_requirements' }
const x402Fail = (req, res, inv, version) => (errorReason, status = 402, errorMessage, transaction = '') => {
  const network = `sui:${sui.NETWORK}`
  if (status === 402) res.set('PAYMENT-REQUIRED', b64json(paymentRequiredV2(req, inv, errorMessage || errorReason)))
  const pr = b64json({ success: false, errorReason, ...(errorMessage ? { errorMessage } : {}), transaction, network })
  res.set(version === 1 ? 'X-PAYMENT-RESPONSE' : 'PAYMENT-RESPONSE', pr)
  return res.status(status).json({ x402Version: version, error: errorReason, ...(errorMessage ? { errorMessage } : {}), ...(transaction ? { transaction } : {}) })
}
// v2: PAYMENT-SIGNATURE = base64 { x402Version: 2, accepted, payload: { signature, transaction } }
async function x402v2(req, res, inv, header) {
  const fail = x402Fail(req, res, inv, 2)
  let p
  try {
    p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  } catch {
    return fail('invalid_payload', 400, 'PAYMENT-SIGNATURE is not base64 JSON')
  }
  if (p?.x402Version !== 2) return fail('invalid_x402_version', 400)
  const want = requirementsV2(inv)
  const a = p?.accepted || {}
  if (a.scheme !== 'exact') return fail('invalid_scheme')
  if (a.network !== want.network) return fail('invalid_network')
  if (a.asset !== want.asset || a.amount !== want.amount || sui.normAddr(a.payTo) !== sui.normAddr(want.payTo)) return fail('invalid_payment_requirements', 402, 'accepted does not match the current requirements of this invoice')
  // idempotency: same id + same payment = the original success; same id + anything else = 409
  const pid = p.extensions?.['payment-identifier']?.info?.id
  let idem = {}
  if (pid !== undefined) {
    if (typeof pid !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(pid)) return fail('invalid_payload', 400, 'payment-identifier id must be 16-128 characters [A-Za-z0-9_-]')
    const fp = createHash('sha256').update(JSON.stringify([a.scheme, a.network, a.asset, a.amount, sui.normAddr(a.payTo), req.baseUrl + req.path, p.payload?.transaction || ''])).digest('hex').slice(0, 32)
    const seen = [...mem.store.values()].flat().find((m) => m.tag?.payment_id === pid)
    if (seen) {
      if (seen.tag.payment_fp !== fp) return fail('invalid_payload', 409, 'payment-identifier was already used for a different payment')
      res.set('PAYMENT-RESPONSE', b64json({ success: true, transaction: seen.tag.digest, network: want.network, payer: seen.tag.payer || undefined, amount: want.amount }))
      return res.status(200).json({ success: true, replayed: true, invoice: seen.tag.invoice, digest: seen.tag.digest, explorer: `${sui.EXPLORER}/tx/${seen.tag.digest}`, protocol: 'x402-v2' })
    }
    idem = { payment_id: pid, payment_fp: fp }
  }
  return x402Signed(req, res, inv, want, p.payload, fail, 2, idem)
}
// Shared facilitator path for v2 and standard v1 signed payloads: verify, simulate, broadcast, settle.
async function x402Signed(req, res, inv, want, payload, fail, version, idem = {}) {
  const { signature, transaction } = payload || {}
  if (typeof signature !== 'string' || typeof transaction !== 'string' || transaction.length > 20_000) return fail('invalid_payload', 400, 'payload needs signature and transaction (base64)')
  // one settlement per invoice at a time (per instance), held from inspection through settlement
  if (x402Inflight.has(inv.id)) return fail('invalid_transaction_state', 409, 'a payment for this invoice is already being settled')
  if (mem.loadState.truncated?.length) return fail('unexpected_verify_error', 503, 'memory is not fully loaded; retry shortly')
  x402Inflight.add(inv.id)
  try {
    return await x402v2Settle(req, res, inv, want, signature, transaction, fail, version, idem)
  } finally {
    x402Inflight.delete(inv.id)
  }
}
const x402Inflight = new Set()
async function x402v2Settle(req, res, inv, want, signature, transaction, fail, version = 2, idem = {}) {
  if (state().invoices.find((i) => i.id === inv.id)?.status === 'paid') return fail('invalid_transaction_state', 409, 'invoice is already paid')
  let check
  try {
    check = await sui.inspectSignedPayment(transaction, signature, PAYEE(), inv.id, want.amount)
  } catch (e) {
    return fail('unexpected_verify_error', 500, e.message)
  }
  if (!check.ok) return fail(X402_REASON[check.reason] || 'invalid_payload', 402, check.reason + (check.detail ? `: ${check.detail}` : ''))
  if (check.received !== BigInt(want.amount)) return fail('invalid_payload', 402, `simulated ${sui.fromMicro(check.received)} USDC to payTo, invoice needs ${owed(inv)}`)
  let digest
  try {
    const ex = sui.executed(await sui.executeSigned(transaction, signature))
    if (ex.failed) return fail('invalid_transaction_state', 402, ex.failed)
    if (!ex.digest) return fail('unexpected_settle_error', 502, 'execution returned no digest')
    digest = ex.digest
  } catch (e) {
    return fail('unexpected_settle_error', 500, e.message)
  }
  let code, body
  for (let i = 0; i < 6; i++) {
    ;[code, body] = await settleDigest(inv.id, digest, version === 2 ? 'x402-v2' : 'x402', idem)
    if (!body.retry) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  // broadcast but not visible yet: the agent should poll, not pay again
  if (code !== 200 && body.retry) return fail('settlement_pending', 202, body.error, digest)
  if (code !== 200) return fail('unexpected_settle_error', code >= 500 ? code : 500, body.error, digest)
  res.set(version === 1 ? 'X-PAYMENT-RESPONSE' : 'PAYMENT-RESPONSE', b64json({ success: true, transaction: digest, network: want.network, payer: check.sender, amount: want.amount }))
  res.status(200).json({ ...body, protocol: version === 2 ? 'x402-v2' : 'x402' })
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
  if (!sui.DIGEST_RE.test(payment)) {
    // standard v1: X-PAYMENT = base64 { x402Version: 1, scheme: 'exact', network, payload: { signature, transaction } }
    const fail = x402Fail(req, res, inv, 1)
    if (inv.status === 'paid') return fail('invalid_transaction_state', 409, 'invoice is already paid')
    let p
    try {
      p = JSON.parse(Buffer.from(payment, 'base64').toString('utf8'))
    } catch {
      return fail('invalid_payload', 400, 'X-PAYMENT is neither a base64 PaymentPayload nor a Sui transaction digest')
    }
    if (p?.x402Version !== 1) return fail('invalid_x402_version', 400)
    if (p.scheme !== 'exact') return fail('invalid_scheme')
    if (p.network !== `sui:${sui.NETWORK}` && p.network !== `sui-${sui.NETWORK}`) return fail('invalid_network')
    return x402Signed(req, res, inv, requirementsV2(inv), p.payload, fail, 1)
  }
  // project extension: a digest the agent already executed itself
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
  // mppx wraps res.json to attach a success Payment-Receipt; MPP sends receipts only on success, so
  // failures go out as RFC 9457 problem+json through res.send (no receipt), like mppx's own errors.
  const problem = (status, detail) =>
    res.status(status).type('application/problem+json').send(JSON.stringify({ type: `https://paymentauth.org/problems/${status === 409 ? 'payment-already-used' : status >= 500 ? 'verification-unavailable' : 'verification-failed'}`, title: status === 409 ? 'Payment not applicable' : 'Payment verification failed', status, detail, protocol: 'mpp' }))
  const digest = credentialDigest(req)
  if (!digest || !sui.DIGEST_RE.test(digest)) return problem(400, 'MPP credential carries no Sui digest')
  const [code, body] = await settleDigest(req.params.id, digest, 'mpp')
  if (code !== 200) return problem(code, body.error)
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
  statusOf: (i) => invoiceStatus(i),
  search: (clientId, q, mode) => mem.search(clientId, q, 5, mode),
  terms: (inv) => paymentTerms(req, inv),
  learning: () => learningSummary(state().clients.map((c) => profileOf(c.id))),
  memories: (clientId) => memsFor(clientId),
  audit: () => auditMemories(),
  verifyPayment: (d) => verifyPayment(d),
  chaseQueue: () => chaseQueue(),
  statement: (id) => clientStatement(id),
  payerReadiness: (inv) => payerLiquidityOf(inv),
  chain: async () => ({ facts: await sui.chainFacts(), provider: sui.providerStatus(), callsThisInstance: sui.grpcCalls }),
  aggregator: process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-mainnet.walrus.space',
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
  // optional partial payment from the wallet: any amount up to what is still owed
  let micro = sui.toMicro(owed(inv))
  if (req.body.amount != null) {
    if (!/^\d+(\.\d{1,6})?$/.test(String(req.body.amount))) return res.status(400).json({ error: 'amount must be a USDC amount with at most 6 decimals' })
    const want = sui.toMicro(String(req.body.amount))
    if (want <= 0n || want > micro) return res.status(400).json({ error: `amount must be more than 0 and at most ${owed(inv)} USDC` })
    micro = want
  }
  const amount = sui.fromMicro(micro)
  try {
    // 0) Payer holds SUI, not USDC: one transaction swaps SUI -> USDC (Cetus aggregator) and pays the
    //    exact amount through Payment Kit. The payer's wallet pays gas; settled by digest like any wallet pay.
    if (req.body.withSui === true) {
      const s = await (await import('../swap.mjs')).buildSwapAndPay(sender, PAYEE(), micro, inv.id) // aggregator SDK loads only here
      const [fee, rate] = await Promise.all([sui.estimateFee(s.bytes).catch(() => null), usdRate('SUI').catch(() => null)])
      return res.json({ bytes: s.bytes, amount, payee: PAYEE(), network: sui.NETWORK, swap: { suiIn: (Number(s.suiIn) / 1e9).toFixed(4), maxSuiIn: (Number(s.maxSuiIn) / 1e9).toFixed(4), via: s.providers }, fee: fee && { ...fee, usd: rate ? Math.round(fee.sui * rate.usd * 1e5) / 1e5 : null } })
    }
    // 1) Native gasless (Sui Address Balances): zero gas for everyone, when the payer's address
    //    balance qualifies. It is a plain transfer (Payment Kit is not allowed gasless), settled by digest.
    if (req.body.gasless !== false && sui.gaslessRelayEnabled()) {
      const plan = await sui.gaslessPlan(sender, micro).catch((e) => ({ eligible: false, reason: e.message }))
      if (plan.eligible) {
        const g = await sui.buildGaslessUsdcTransfer(sender, PAYEE(), micro, inv.id)
        reserveDigest(g.digest, inv.id)
        return res.json({ bytes: g.bytes, amount, payee: PAYEE(), network: sui.NETWORK, gasless: { mac: g.mac, addressBalance: plan.addressBalance } })
      }
      res.set('x-gasless-skipped', String(plan.reason || '').slice(0, 200))
    }
    // 2) Gas-free for the payer when the server's gas wallet can sponsor; otherwise the wallet pays gas.
    //    Sponsored gas is spent only on a payment that settles the invoice in full (no dust partials).
    if (req.body.sponsored !== false && sui.sponsor() && micro === sui.toMicro(owed(inv))) {
      const sp = await sui.buildSponsoredInvoicePayment(sender, PAYEE(), micro, inv.id).catch((e) => ({ error: e.message }))
      if (sp && !sp.error) return res.json({ bytes: sp.bytes, amount, payee: PAYEE(), network: sui.NETWORK, sponsored: { sponsor: sp.sponsor, mac: sp.mac, gasBudgetMist: sp.gasBudgetMist } })
      if (/EDuplicatePayment|duplicate/i.test(sp?.error || '')) throw new Error(sp.error)
    }
    const bytes = await sui.buildInvoicePayment(sender, PAYEE(), micro, inv.id)
    // simulate through Tatum for the real fee, priced in USD with Tatum's rate API (best effort)
    const [fee, rate] = await Promise.all([sui.estimateFee(bytes).catch(() => null), usdRate('SUI').catch(() => null)])
    res.json({ bytes, amount, payee: PAYEE(), network: sui.NETWORK, fee: fee && { ...fee, usd: rate ? Math.round(fee.sui * rate.usd * 1e5) / 1e5 : null } })
  } catch (e) {
    const msg = e.message || ''
    res.status(400).json({ error: /EDuplicatePayment|duplicate/i.test(msg) ? 'This invoice was already paid on-chain' : /insufficient|balance|coin/i.test(msg) && req.body.withSui === true ? `Not enough SUI in ${sender.slice(0, 10)}… to swap for ${amount} USDC plus gas on ${NET}` : /no route/i.test(msg) ? 'No SUI → USDC route available right now; try again or pay in USDC' : /insufficient|balance|coin/i.test(msg) ? `Not enough USDC or SUI for gas in ${sender.slice(0, 10)}… on ${NET}` : `Could not build transaction: ${msg}` })
  }
})

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
    const { failed, digest } = sui.executed(await sui.executeSigned(bytes, [signature, sponsorSignature]))
    if (failed) return res.status(400).json({ error: `Sponsored payment ${failed}`, digest })
    if (!digest) return res.status(502).json({ error: 'Execution returned no digest' })
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

// Native gasless payment: the payer signed bytes this server built (MAC-checked); nobody pays gas.
router.post('/pay-gasless', async (req, res) => {
  const { invoiceId, bytes, signature, mac } = req.body || {}
  if (![invoiceId, bytes, signature, mac].every((x) => typeof x === 'string' && x.length < 20_000)) return res.status(400).json({ error: 'invoiceId, bytes, signature and mac are required' })
  if (!sui.gaslessMacOk(bytes, mac, invoiceId)) return res.status(400).json({ error: 'These bytes were not built by this server for this invoice' })
  const inv = state().invoices.find((i) => i.id === invoiceId)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  // checked BEFORE executing: a second tab or double click must not send USDC that no invoice will record
  if (withStatus(inv).status === 'paid') return res.status(409).json({ error: 'Invoice is already paid; nothing was sent' })
  if (inflight.has(inv.id)) return res.status(409).json({ error: 'A payment for this invoice is already being verified; nothing was sent' })
  try {
    const { failed, digest } = sui.executed(await sui.executeSigned(bytes, signature))
    if (failed || !digest) return res.status(400).json({ error: `Gasless ${failed || 'transfer returned no digest'}`, digest })
    let code, body
    for (let i = 0; i < 6; i++) {
      ;[code, body] = await settleDigest(invoiceId, digest, 'wallet-gasless', {}, { allowInexact: true })
      if (code === 409 && state().invoices.find((x) => x.id === invoiceId)?.payments?.some((p) => p.digest === digest)) {
        ;[code, body] = [200, { success: true, verifiedOnChain: true, message: 'Paid: settled the moment it reached a checkpoint (live Tatum stream).', explorer: `${sui.EXPLORER}/tx/${digest}` }]
        break
      }
      if (!body.retry && code !== 409) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    res.status(code).json({ ...body, digest, gasless: true })
  } catch (e) {
    res.status(400).json({ error: `Gasless execution failed: ${e.message}` })
  }
})

// Statement of account for one client: every invoice and payment from Walrus Memory, and every payment line
// that names a transaction re-proven on Sui (Tatum BatchGetTransactions, one call per 50). Something a freelancer
// can send to the client's AP team: each paid line links to the chain and to the Walrus blob that remembers it.
async function clientStatement(clientId) {
  const client = state().clients.find((c) => c.id === clientId)
  if (!client) return null
  const invs = state().invoices.filter((i) => i.clientId === clientId).map(withStatus).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const pays = invs.flatMap((i) => (i.payments || []).map((p) => ({ invoice: i.id, ...p })))
  const digests = [...new Set(pays.map((p) => p.digest).filter(Boolean))]
  const facts = digests.length ? await sui.transactionsFacts(digests, PAYEE()) : new Map()
  const blobOf = (d) => memsFor(clientId).find((m) => m.tag?.digest === d)?.blobId || null
  const payments = pays.map((p) => {
    const f = p.digest ? facts.get(p.digest) : null
    const claimed = p.received != null ? sui.toMicro(p.received) : null
    const verified = !p.digest ? 'no transaction (seeded history)' : !f?.found ? 'not found on chain' : !f.ok ? 'failed on chain' : claimed != null && f.received !== claimed ? `chain moved ${sui.fromMicro(f.received)} USDC` : 'verified on Sui'
    return { date: p.paid || null, invoice: p.invoice, usdc: p.received ?? null, digest: p.digest, verified, checkpoint: f?.checkpoint != null ? String(f.checkpoint) : null, explorer: p.digest ? `${sui.EXPLORER}/tx/${p.digest}` : null, walrusBlob: p.digest ? blobOf(p.digest) : null }
  })
  const sum = (xs) => xs.reduce((a, b) => a + sui.toMicro(b || '0'), 0n)
  const invoiced = sum(invs.map((i) => i.payAmount))
  const paid = sum(payments.map((p) => p.usdc))
  const open = invs.filter((i) => i.status !== 'paid')
  return {
    client: { id: client.id, name: client.name }, generatedAt: new Date().toISOString(), network: sui.NETWORK, payee: PAYEE(),
    totals: { invoicedUsdc: sui.fromMicro(invoiced), paidUsdc: sui.fromMicro(paid), outstandingUsdc: sui.fromMicro(sum(open.map((i) => owed(i)))), invoices: invs.length, open: open.length, paymentsVerifiedOnChain: payments.filter((p) => p.verified === 'verified on Sui').length, paymentsWithTransaction: payments.filter((p) => p.digest).length },
    invoices: invs.map((i) => ({ id: i.id, description: i.description || '', due: i.dueDate, amountUsdc: i.payAmount, status: i.status, owedUsdc: i.status === 'paid' ? '0.000000' : owed(i) })),
    payments,
    services: ['Walrus Memory (invoices, payments)', 'LedgerService.BatchGetTransactions (Tatum)'],
  }
}
router.get('/clients/:id/statement', async (req, res) => {
  try {
    const st = await clientStatement(req.params.id)
    if (!st) return res.status(404).json({ error: 'Client not found' })
    if (req.query.format !== 'csv') return res.json(st)
    const esc = (v) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, (c) => `'${c}`).replace(/"/g, '""')}"`
    const rows = [['type', 'date', 'invoice', 'description', 'usdc', 'status', 'transaction', 'checkpoint', 'walrus_blob'].join(',')]
    for (const i of st.invoices) rows.push(['invoice', i.due, i.id, i.description, i.amountUsdc, i.status, '', '', ''].map(esc).join(','))
    for (const p of st.payments) rows.push(['payment', p.date, p.invoice, '', p.usdc, p.verified, p.explorer, p.checkpoint, p.walrusBlob].map(esc).join(','))
    rows.push(['total', '', '', 'invoiced / paid / outstanding', `${st.totals.invoicedUsdc} / ${st.totals.paidUsdc} / ${st.totals.outstandingUsdc}`, `${st.totals.paymentsVerifiedOnChain}/${st.totals.paymentsWithTransaction} payments verified on Sui`, '', '', ''].map(esc).join(','))
    res.set('Content-Disposition', `attachment; filename="statement-${st.client.name.replace(/[^A-Za-z0-9-]+/g, '-')}.csv"`).type('text/csv').send(rows.join('\n'))
  } catch (e) {
    res.status(502).json({ error: `Tatum Sui gRPC: ${e.message}` })
  }
})

// Chase queue: who to chase today, from what Walrus Memory learned about each client (delay spread, promises
// kept, underpayment) joined with what their payer wallet shows on Sui right now through Tatum (ListBalances:
// can they pay? ListTransactions: are they active, paying others?). Each line says why, from both sides.
let queueCache = null
let queueP = null
function chaseQueue() {
  if (queueCache && Date.now() - queueCache.at < 120_000) return Promise.resolve(queueCache.value)
  return (queueP ||= buildQueue().finally(() => (queueP = null)))
}
const RANK = { chase_now: 0, nudge: 1, wait: 2, scheduled: 3 }
async function buildQueue() {
  const today = isoDay(new Date())
  const { clients, invoices } = state()
  const items = []
  for (const raw of invoices) {
    const inv = withStatus(raw)
    if (inv.status !== 'sent' && inv.status !== 'overdue' && !(inv.status === 'partial' && !inv.seed)) continue
    if (Number(inv.baseAmount) < 1) continue
    const profile = profileOf(inv.clientId)
    const p = plan(inv, profile)
    const next = p.steps.find((x) => x.date >= today) || p.steps.at(-1)
    const late = Math.round((Date.parse(today) - Date.parse(inv.dueDate)) / DAY)
    const ps = profile.promiseStats || { kept: 0, broken: 0 }
    const wallet = await payerLiquidityOf(inv).catch(() => null)
    const activity = wallet ? await sui.walletActivity(wallet.owner, PAYEE()).catch(() => null) : null
    const { action, why } = chaseAction({ today, inv, late, profile, wallet, activity, owedUsdc: owed(inv), predicted: p.predictedPayDate })
    if (profile.underpayRate) why.push(`underpaid ${Math.round(profile.underpayRate)}% of past invoices: ask for the exact amount`)
    items.push({ invoiceId: inv.id, clientId: inv.clientId, clientName: clientName(clients, inv.clientId), owedUsdc: owed(inv), dueDate: inv.dueDate, daysLate: late, action, tone: next?.tone || null, nextReminder: next?.date || null, why, memory: { ewmaDelayDays: profile.ewmaDelayDays, delayRange: profile.delayRange, promises: ps, underpayRate: profile.underpayRate || 0 }, chain: wallet ? { wallet: wallet.owner, name: wallet.name, usdc: wallet.usdc, covers: wallet.covers, source: wallet.source, lastActivity: activity?.lastActivity?.at || null, usdcSent7d: activity?.usdcSent7d ?? null, paymentsToUs7d: activity?.paymentsToUs7d ?? null } : null })
  }
  items.sort((a, b) => RANK[a.action] - RANK[b.action] || Number(b.owedUsdc) - Number(a.owedUsdc))
  const value = { generatedAt: new Date().toISOString(), counts: Object.fromEntries(Object.keys(RANK).map((k) => [k, items.filter((i) => i.action === k).length])), items, services: ['Walrus Memory (learned profile, promises)', 'StateService.ListBalances (Tatum)', 'LedgerService.ListTransactions (Tatum)'] }
  queueCache = { at: Date.now(), value }
  return value
}
router.get('/chase-queue', async (_req, res) => {
  try {
    res.json(await chaseQueue())
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// the payer wallet this client said it pays from, else the last one it paid from (Walrus Memory),
// read through Tatum: can they pay this invoice right now?
async function payerLiquidityOf(inv) {
  const client = state().clients.find((c) => c.id === inv.clientId)
  const last = memsFor(inv.clientId).find((m) => m.tag?.payer)?.tag
  const owner = client?.expectedPayer?.address || last?.payer
  if (!owner || invoiceStatus(inv) === 'paid') return null
  const w = await sui.walletBalances(owner).catch(() => null)
  if (!w) return null
  const need = sui.toMicro(owed(withStatus(inv)))
  return { ...w, source: client?.expectedPayer?.address ? 'expected payer (client rule)' : 'last wallet this client paid from', name: client?.expectedPayer?.name || last?.payer_name || null, covers: BigInt(w.usdcMicro) >= need, owedUsdc: owed(withStatus(inv)), service: 'StateService.ListBalances' }
}

// Memory <-> chain audit ("Total Recall" both ways): every payment memory in Walrus claims a digest, an
// amount and a checkpoint. All claims are re-checked against Sui through Tatum in batches; a memory that
// the chain doesn't back (wrong amount, failed or missing tx, other checkpoint) is listed, never hidden.
let auditCache = null
let auditP = null // one audit in flight: concurrent callers share it instead of each hitting Tatum
function auditMemories() {
  if (auditCache && Date.now() - auditCache.at < 600_000) return Promise.resolve(auditCache.value)
  return (auditP ||= runAudit().finally(() => (auditP = null)))
}
async function runAudit() {
  const pays = [...mem.store.values()].flat().filter((m) => (m.tag?.type === 'invoice_paid' || m.tag?.type === 'invoice_partial'))
  const claims = pays.filter((m) => m.tag.digest && m.tag.received)
  const facts = await sui.transactionsFacts([...new Set(claims.map((m) => m.tag.digest))], PAYEE())
  const mismatched = []
  for (const m of claims) {
    const f = facts.get(m.tag.digest)
    const why = !f?.found ? 'transaction not found on chain' : !f.ok ? 'transaction failed on chain' : f.received !== sui.toMicro(m.tag.received) ? `chain moved ${sui.fromMicro(f.received)} USDC, memory says ${m.tag.received}` : m.tag.checkpoint && String(m.tag.checkpoint) !== String(f.checkpoint) ? `checkpoint ${f.checkpoint}, memory says ${m.tag.checkpoint}` : null
    if (why) mismatched.push({ invoice: m.tag.invoice, digest: m.tag.digest, blobId: m.blobId || null, why })
  }
  // the other direction: every USDC that reached the payee wallet in the last 30 days (LedgerService.ListTransactions,
  // affected-address filter) that no Walrus memory accounts for. Money the agent never learned about shows up here.
  let chainToMemory
  try {
    const known = new Set([...mem.store.values()].flat().map((m) => m.tag?.digest).filter(Boolean))
    const incoming = await sui.recentIncoming(PAYEE(), { since: new Date(Date.now() - 30 * 86_400_000).toISOString(), limit: 200 })
    const unrecorded = incoming.filter((t) => !known.has(t.digest)).map((t) => ({ digest: t.digest, usdc: sui.fromMicro(t.received), sender: t.sender, timestamp: t.timestamp }))
    chainToMemory = { windowDays: 30, incomingTransfers: incoming.length, recordedInMemory: incoming.length - unrecorded.length, unrecorded, scannedTransactions: incoming.scanned, service: 'LedgerService.ListTransactions (Tatum)' }
  } catch (e) {
    chainToMemory = { error: e.message }
  }
  const value = { checkedAt: new Date().toISOString(), paymentMemories: pays.length, withTransaction: claims.length, verified: claims.length - mismatched.length, mismatched, demoHistoryWithoutTransaction: pays.length - claims.length, gatewayCalls: Math.ceil(new Set(claims.map((m) => m.tag.digest)).size / 50), service: 'LedgerService.BatchGetTransactions (Tatum)', chainToMemory }
  auditCache = { at: Date.now(), value }
  return value
}
// One transaction, both sides: what Sui says it did (Tatum BatchGetTransactions + sender + SuiNS name)
// and what Walrus Memory says it paid. Read-only, so an agent can check a digest a client sends before trusting it.
async function verifyPayment(digest) {
  const f = (await sui.transactionsFacts([digest], PAYEE())).get(digest)
  const recorded = [...mem.store.values()].flat().filter((m) => m.tag?.digest === digest).map((m) => ({ invoice: m.tag.invoice, type: m.tag.type, usdc: m.tag.received || null, blobId: m.blobId || null }))
  const reserved = state().invoices.find((i) => i.digest === digest || (i.payments || []).some((p) => p.digest === digest))
  const sender = f?.found ? await sui.txSender(digest).catch(() => null) : null
  const name = sender ? await sui.suinsName(sender) : null
  const chain = f?.found ? { found: true, success: f.ok, usdcToPayee: sui.fromMicro(f.received), checkpoint: String(f.checkpoint ?? ''), sender, senderName: name } : { found: false, error: f?.error || 'not found' }
  const verdict = !f?.found ? 'not on chain' : !f.ok ? 'failed on chain' : f.received <= 0n ? 'moved no USDC to the payee' : recorded.length ? 'on chain and recorded in memory' : 'on chain but not recorded in memory: settle it with POST /api/chaser/verify-payment'
  return { digest, verdict, chain, memory: recorded, invoice: reserved?.id || null, explorer: `${sui.EXPLORER}/tx/${digest}`, services: ['LedgerService.BatchGetTransactions', 'LedgerService.GetTransaction', 'NameService.ReverseLookupName'] }
}

router.get('/audit', async (_req, res) => {
  try {
    res.json(await auditMemories())
  } catch (e) {
    res.status(502).json({ error: `Tatum Sui gRPC: ${e.message}` })
  }
})

let proofCache = null
router.get('/proof', async (req, res, next) => {
  res.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60')
  if (proofCache && Date.now() - proofCache.at < 15_000) return res.json(proofCache.body)
  const json = res.json.bind(res)
  res.json = (body) => { if (res.statusCode === 200) proofCache = { at: Date.now(), body }; return json(body) }
  next()
})
router.get('/proof', async (_req, res) => {
  const [cp, bal, h, nss, rSui, rUsdc, dur, chain, audit] = await Promise.allSettled([sui.latestCheckpoint(), sui.usdcBalance(PAYEE()), mem.health(), mem.namespaceCounts(), usdRate('SUI'), usdRate('USDC'), mem.durability(), sui.chainFacts(), auditMemories()])
  const counts = nss.status === 'fulfilled' ? nss.value : []
  res.json({
    tatumSuiGrpc: {
      endpoint: sui.GRPC_HOST,
      protocol: 'gRPC over TLS (sui.rpc.v2)',
      apiKeyConfigured: Boolean(process.env.TATUM_API_KEY),
      // 'connected' only when Tatum itself answered; a public-fullnode fallback is reported as such
      gatewayStatus: cp.status !== 'fulfilled' ? 'error' : sui.provider() === 'tatum' ? 'connected' : process.env.TATUM_API_KEY ? 'quota_fallback' : 'no_api_key',
      provider: sui.providerStatus(),
      latestCheckpoint: cp.status === 'fulfilled' ? cp.value.sequence : null,
      latencyMs: cp.status === 'fulfilled' ? cp.value.latencyMs : null,
      payeeAddress: PAYEE(),
      payeeBalance: bal.status === 'fulfilled' ? `${sui.fromMicro(bal.value)} USDC` : null,
      usdcCoinType: sui.USDC_COIN_TYPE,
      network: sui.NETWORK,
      rates: { SUI: rSui.status === 'fulfilled' ? rSui.value : null, USDC: rUsdc.status === 'fulfilled' ? rUsdc.value : null, api: 'Tatum Data API /v4/data/rate/symbol' },
      paymentKit: { registry: sui.REGISTRY_NAME, registryId: sui.registryId(), explorer: `${sui.EXPLORER}/object/${sui.registryId()}` },
      // verified on-chain through Tatum, not trusted from config
      chain: chain.status === 'fulfilled' ? chain.value : { error: chain.reason?.message || 'unavailable' },
      // every gRPC call this instance made, per service.method and provider (counted by a transport interceptor)
      callsThisInstance: sui.grpcCalls,
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
      // how this instance last synced from Walrus: full recall, or incremental (listMemories watermark, only changed namespaces)
      lastSync: mem.loadState.lastSync || null,
      // writes this instance made: batched rememberBulk calls (items per call) vs single remember calls
      writes: mem.writeStats,
      // every payment memory re-checked against Sui through Tatum (counts; details at /api/chaser/audit)
      chainAudit: audit.status === 'fulfilled' ? { ...audit.value, mismatched: audit.value.mismatched.length, chainToMemory: audit.value.chainToMemory?.error ? audit.value.chainToMemory : { ...audit.value.chainToMemory, unrecorded: audit.value.chainToMemory?.unrecorded?.length ?? 0 } } : { error: audit.reason?.message || 'unavailable' },
      durability: dur.status === 'fulfilled' ? dur.value : { ok: false, error: dur.reason?.message || 'audit failed' },
      // private mode: none, even for the owner -- /proof is CDN-cached for everyone (s-maxage)
      sampleMemories: privateReads() ? [] : [...mem.store.entries()].map(([namespace, ms]) => ({ namespace, count: ms.length, latest: ms[0]?.sentence || '', blobId: ms.find((m) => m.blobId)?.blobId || null })),
    },
  })
})

export default router
