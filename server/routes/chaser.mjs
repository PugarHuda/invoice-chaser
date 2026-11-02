import { Router } from 'express'
import * as mem from '../memory.mjs'
import * as sui from '../sui.mjs'
import { deriveState, computeProfile, plan, invoiceStatus, uniquePayAmount, isoDay } from '../engine.mjs'

const router = Router()
const PAYEE = () => process.env.SUI_PAYEE_ADDRESS
const DAY = 86_400_000

// First request after boot rebuilds everything from Walrus Memory.
router.use(async (_req, _res, next) => {
  if (!mem.loadState.loaded && !mem.loadState.loading) await mem.loadAll()
  next()
})

// Owner-only writes. The payer-facing /verify-payment stays public; it only settles against verified chain data.
router.use((req, res, next) => {
  const pass = process.env.APP_PASSCODE
  if (!pass || req.method === 'GET' || req.path === '/verify-payment') return next()
  if (req.get('x-passcode') !== pass) return res.status(401).json({ error: 'Owner passcode required' })
  next()
})

const state = () => deriveState(mem.store)
const memsFor = (clientId) => mem.store.get(mem.clientNs(clientId)) || []
const profileOf = (clientId) => computeProfile(clientId, memsFor(clientId))
const clientName = (clients, id) => clients.find((c) => c.id === id)?.name || 'Unknown'
const withStatus = (inv) => ({ ...inv, status: invoiceStatus(inv) })

router.get('/summary', (_req, res) => {
  const now = new Date()
  const horizon = isoDay(now.getTime() + 7 * DAY)
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
    overdueAmount: overdue.toFixed(2),
    activeClientNamespaces: clients.length,
    upcomingInflows,
    nextActions,
    memory: { loadedAt: mem.loadState.loadedAt, pending: mem.pendingCount(), error: mem.loadState.error },
  })
})

router.get('/clients', (_req, res) => {
  res.json(state().clients.map((c) => ({ ...c, email: c.contact, profile: profileOf(c.id) })))
})

router.post('/clients', (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const id = `c-${Date.now().toString(36)}`
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
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const m = mem.remember(mem.clientNs(client.id), `Rule for ${client.name}: "${note}"`, { type: 'preference', client: client.id, note })
  res.json({ success: true, memory: m, profile: profileOf(client.id) })
})

// Total Recall: throw away local state and rebuild everything from Walrus Memory.
router.post('/clients/:id/rebuild', async (_req, res) => {
  const t = Date.now()
  const r = await mem.loadAll()
  if (r.error) return res.status(502).json({ error: `Walrus Memory: ${r.error}` })
  res.json({ success: true, message: `Rebuilt from Walrus Memory: ${r.recalled} memories across ${r.namespaces} namespaces in ${((Date.now() - t) / 1000).toFixed(1)} s.` })
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
  if (!(Number(amount) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return res.status(400).json({ error: 'amount > 0 and dueDate (YYYY-MM-DD) are required' })
  const id = `inv-${Date.now().toString(36)}`
  const payAmount = uniquePayAmount(amount, new Set(invoices.map((i) => i.payAmount)))
  const m = mem.remember(mem.clientNs(clientId), `Invoice ${id} sent to ${client.name}: ${payAmount} USDC due ${dueDate}.`, { type: 'invoice_sent', client: clientId, invoice: id, base: Number(amount), pay_amount: payAmount, due: dueDate, description: description || '' })
  res.json({ invoice: { id, payAmount }, memory: m })
})

router.get('/invoices/:id', (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const profile = profileOf(inv.clientId)
  res.json({
    invoice: { ...withStatus(inv), clientName: clientName(clients, inv.clientId), payeeAddress: PAYEE(), coinType: sui.USDC_COIN_TYPE },
    adaptivePlan: plan(inv, profile),
    defaultPlan: plan(inv, profile, { ignoreMemory: true }),
    profile,
  })
})

const TEMPLATES = {
  friendly: (n, inv) => `Hi ${n}, just a friendly reminder that invoice ${inv.id} (${inv.payAmount} USDC) was due on ${inv.dueDate}. Thanks!`,
  formal: (n, inv) => `Dear ${n}, our records show invoice ${inv.id} for ${inv.payAmount} USDC, due ${inv.dueDate}, is outstanding. Kindly arrange payment at your earliest convenience.`,
  firm: (n, inv) => `${n}, invoice ${inv.id} (${inv.payAmount} USDC) is now significantly overdue. Please settle it within 2 business days.`,
}
router.post('/invoices/:id/remind', (req, res) => {
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const tone = ['friendly', 'formal', 'firm'].includes(req.body?.tone) ? req.body.tone : plan(inv, profileOf(inv.clientId)).steps[0].tone
  const name = clientName(clients, inv.clientId)
  const offset = Math.round((Date.now() - new Date(`${inv.dueDate}T00:00:00Z`)) / DAY)
  const m = mem.remember(mem.clientNs(inv.clientId), `Sent a ${tone} reminder to ${name} for ${inv.id} (due ${offset >= 0 ? '+' : ''}${offset}d).`, { type: 'reminder_sent', client: inv.clientId, invoice: inv.id, tone, day_offset: offset })
  res.json({ text: TEMPLATES[tone](name, inv), memory: m })
})

// Settle an invoice from a Sui transaction digest, verified on Mainnet through Tatum gRPC.
router.post('/verify-payment', async (req, res) => {
  const { invoiceId, digest } = req.body || {}
  if (typeof invoiceId !== 'string' || typeof digest !== 'string' || !sui.DIGEST_RE.test(digest)) return res.status(400).json({ error: 'invoiceId and a valid Sui transaction digest are required' })
  const { clients, invoices } = state()
  const inv = invoices.find((i) => i.id === invoiceId)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (inv.status === 'paid') return res.status(409).json({ error: 'Invoice is already paid' })
  if (mem.loadState.truncated?.length) return res.status(503).json({ error: 'Memory recall is incomplete; refusing to settle until every namespace is fully loaded' })
  // Reserve digest + invoice synchronously so two concurrent requests cannot both settle.
  if (inflight.has(digest) || inflight.has(inv.id)) return res.status(409).json({ error: 'This payment is already being verified' })
  inflight.add(digest).add(inv.id)
  try {
    return await settle(req, res, inv, digest)
  } finally {
    inflight.delete(digest)
    inflight.delete(inv.id)
  }
})

const inflight = new Set()
async function settle(_req, res, inv0, requested) {
  let tx
  try {
    tx = await sui.usdcReceived(requested, PAYEE())
  } catch (e) {
    return res.status(502).json({ error: `Tatum Sui gRPC: ${e.message}` })
  }
  // Key everything on the chain's canonical digest, not on what the client sent.
  const digest = tx.digest
  if (!digest) return res.status(400).json({ error: 'Transaction not found on Sui Mainnet' })
  // Re-read state after the await: anything settled meanwhile wins.
  const { clients, invoices, usedDigests } = state()
  const inv = invoices.find((i) => i.id === inv0.id)
  if (inv.status === 'paid') return res.status(409).json({ error: 'Invoice is already paid' })
  if (usedDigests.has(digest)) return res.status(409).json({ error: 'This transaction has already settled an invoice' })
  if (!tx.ok) return res.status(400).json({ error: 'Transaction did not succeed on Sui Mainnet' })
  if (tx.received <= 0n) return res.status(400).json({ error: 'Transaction sent no USDC to the payee address' })
  if (tx.timestamp && tx.timestamp < inv.createdAt) return res.status(400).json({ error: 'Transaction is older than the invoice' })

  const expected = sui.toMicro(inv.payAmount)
  // The unique amount is the invoice's fingerprint: a transfer that exactly matches another open invoice belongs to that one.
  const other = invoices.find((i) => i.id !== inv.id && i.status !== 'paid' && sui.toMicro(i.payAmount) === tx.received)
  if (other) return res.status(409).json({ error: `This transfer matches ${other.id}'s exact amount, not ${inv.id}` })
  const full = tx.received >= expected
  const paid = isoDay(tx.timestamp || Date.now())
  const delay = Math.max(0, Math.round((new Date(paid) - new Date(inv.dueDate)) / DAY))
  const last = memsFor(inv.clientId).find((m) => m.tag?.type === 'reminder_sent' && m.tag.invoice === inv.id)
  const name = clientName(clients, inv.clientId)
  const received = sui.fromMicro(tx.received)
  const m = mem.remember(
    mem.clientNs(inv.clientId),
    full
      ? `${name} paid ${inv.id} in full (${received} USDC) on ${paid}, ${delay} day(s) after due, after ${inv.reminders} reminder(s)${last ? `; last tone ${last.tag.tone}` : ''}.`
      : `${name} underpaid ${inv.id}: ${received} of ${inv.payAmount} USDC on ${paid}.`,
    { type: full ? 'invoice_paid' : 'invoice_partial', client: inv.clientId, invoice: inv.id, due: inv.dueDate, paid, delay_days: delay, reminders: inv.reminders, last_tone: last?.tag.tone || null, expected: inv.payAmount, received, digest, checkpoint: tx.checkpoint },
  )
  res.json({ success: true, verifiedOnChain: true, received, full, memory: m, invoice: { ...inv, status: full ? 'paid' : 'partial', digest }, message: `Verified on Sui Mainnet via Tatum: ${received} USDC received.` })
}

// Balance watcher: a balance increase that equals an open invoice's unique amount flags that invoice.
let lastBalance = null
const likely = new Map()
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
  const [cp, bal, h, nss] = await Promise.allSettled([sui.latestCheckpoint(), sui.usdcBalance(PAYEE()), mem.health(), mem.namespaceCounts()])
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
