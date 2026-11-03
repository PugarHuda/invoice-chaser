import { Router } from 'express'
import * as mem from '../memory.mjs'
import * as sui from '../sui.mjs'
import { deriveState, computeProfile, plan, invoiceStatus, uniquePayAmount, isoDay } from '../engine.mjs'

const router = Router()
const PAYEE = () => process.env.SUI_PAYEE_ADDRESS
const DAY = 86_400_000

// First request after boot rebuilds everything from Walrus Memory.
router.use(async (_req, _res, next) => {
  await mem.ready()
  next()
})

const PUBLIC_WRITES = new Set(['/verify-payment', '/pay-tx', '/sync-payments'])
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
  })
})

router.get('/clients', (_req, res) => {
  res.json(state().clients.map((c) => ({ ...c, email: c.contact, profile: profileOf(c.id) })))
})

router.post('/clients', (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ')
  if (!name) return res.status(400).json({ error: 'name is required' })
  if (name.length > 80) return res.status(400).json({ error: 'name must be 80 characters or fewer' })
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
  if (note.length > 300) return res.status(400).json({ error: 'keep rules under 300 characters' })
  const client = state().clients.find((c) => c.id === req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const m = mem.remember(mem.clientNs(client.id), `Rule for ${client.name}: "${note}"`, { type: 'preference', client: client.id, note })
  res.json({ success: true, memory: m, profile: profileOf(client.id) })
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
  const id = `inv-${Date.now().toString(36)}`
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
      id: i.id, clientId: i.clientId, clientName: clientName(clients, i.clientId), baseAmount: i.baseAmount, payAmount: i.payAmount, status: i.status, dueDate: i.dueDate, issuedDate: i.issuedDate, description: i.description, digest: i.digest,
      payeeAddress: PAYEE(), coinType: sui.USDC_COIN_TYPE, network: sui.NETWORK, registry: sui.REGISTRY_NAME,
      paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(i.payAmount), nonce: i.id, label: 'Invoice Chaser', message: `Invoice ${i.id}` }),
      explorerTx: i.digest ? `${sui.EXPLORER}/tx/${i.digest}` : null,
    },
  })
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
    },
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
  const p = plan(inv, profileOf(inv.clientId))
  const tone = ['friendly', 'formal', 'firm'].includes(req.body?.tone) ? req.body.tone : p.steps[0].tone
  const name = clientName(clients, inv.clientId)
  const offset = Math.round((Date.now() - new Date(`${inv.dueDate}T00:00:00Z`)) / DAY)
  const m = mem.remember(mem.clientNs(inv.clientId), `Sent a ${tone} reminder to ${name} for ${inv.id} (due ${offset >= 0 ? '+' : ''}${offset}d).`, { type: 'reminder_sent', client: inv.clientId, invoice: inv.id, tone, day_offset: offset, planned_tone: p.steps[0].tone, cites: (p.cites || []).map((c) => c.blobId).filter(Boolean) })
  res.json({ text: TEMPLATES[tone](name, inv), memory: m })
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
    const expected = sui.toMicro(inv.payAmount)
    // A transfer that exactly matches another open invoice's unique amount belongs to that one.
    const other = now.find((i) => i.id !== inv.id && i.status !== 'paid' && sui.toMicro(i.payAmount) === tx.received)
    if (other) return [409, { error: `This transfer matches ${other.id}'s exact amount, not ${inv.id}` }]

    const full = tx.received >= expected
    const paid = isoDay(tx.timestamp || Date.now())
    const delay = Math.max(0, Math.round((new Date(paid) - new Date(inv.dueDate)) / DAY))
    const ms = memsFor(inv.clientId)
    const last = ms.find((m) => m.tag?.type === 'reminder_sent' && m.tag.invoice === inv.id)
    // Payer recognition: who paid, their SuiNS name, and whether this client has paid from it before.
    const payer = await sui.txSender(digest).catch(() => null)
    const payerName = payer ? await sui.suinsName(payer) : null
    const knownPayers = new Set(ms.map((m) => m.tag?.payer).filter(Boolean))
    const newPayer = Boolean(payer && knownPayers.size && !knownPayers.has(payer))
    const name = clientName(clients, inv.clientId)
    const received = sui.fromMicro(tx.received)
    const who = payer ? ` from ${payerName || `${payer.slice(0, 8)}…`}${newPayer ? ' (a wallet this client never paid from before)' : ''}` : ''
    settledDigests.add(digest)
    const m = mem.remember(
      mem.clientNs(inv.clientId),
      full
        ? `${name} paid ${inv.id} in full (${received} USDC) on ${paid}, ${delay} day(s) after due, after ${inv.reminders} reminder(s)${last ? `; last tone ${last.tag.tone}` : ''}${who}.`
        : `${name} underpaid ${inv.id}: ${received} of ${inv.payAmount} USDC on ${paid}${who}.`,
      { type: full ? 'invoice_paid' : 'invoice_partial', client: inv.clientId, invoice: inv.id, due: inv.dueDate, paid, delay_days: delay, reminders: inv.reminders, last_tone: last?.tag.tone || null, expected: inv.payAmount, received, digest, checkpoint: tx.checkpoint, channel, network: sui.NETWORK, payer, payer_name: payerName, new_payer: newPayer },
    )
    return [200, { success: true, verifiedOnChain: true, received, full, payer, payerName, newPayer, memory: m, explorer: `${sui.EXPLORER}/tx/${digest}`, invoice: { ...inv, status: full ? 'paid' : 'partial', digest }, message: `Verified on ${NET} via Tatum: ${received} USDC received${newPayer ? ' from a NEW payer wallet' : ''}.` }]
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
  const open = state().invoices.filter((i) => i.status === 'sent' || i.status === 'partial')
  const settled = []
  for (const inv of open) {
    const digest = await sui.findInvoicePayment(PAYEE(), sui.toMicro(inv.payAmount), inv.id)
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

const paymentTerms = (req, inv) => ({
  scheme: 'exact',
  network: `sui:${sui.NETWORK}`,
  asset: sui.USDC_COIN_TYPE,
  maxAmountRequired: sui.toMicro(inv.payAmount).toString(),
  amount: inv.payAmount,
  payTo: PAYEE(),
  resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  description: `Invoice ${inv.id} (${inv.description || 'services'})`,
  mimeType: 'application/json',
  maxTimeoutSeconds: 600,
  // Pay through Sui Payment Kit so the chain itself rejects a second payment for this invoice.
  extra: { paymentKit: { registry: sui.REGISTRY_NAME, registryId: sui.registryId(), nonce: inv.id }, paymentUri: sui.paymentUri({ payee: PAYEE(), micro: sui.toMicro(inv.payAmount), nonce: inv.id, label: 'Invoice Chaser', message: `Invoice ${inv.id}` }) },
})

// x402: an invoice is a payable HTTP resource. Without X-PAYMENT you get 402 + terms; with a Sui
// transaction digest in X-PAYMENT the server verifies it through Tatum and returns a receipt.
router.get('/x402/:id', async (req, res) => {
  const inv = state().invoices.find((i) => i.id === req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const payment = req.get('x-payment')
  if (!payment) {
    if (inv.status === 'paid') return res.json({ status: 'paid', invoice: inv.id, digest: inv.digest })
    res.set('Cache-Control', 'no-store')
    return res.status(402).json({ x402Version: 1, error: 'Payment required', accepts: [paymentTerms(req, inv)] })
  }
  if (!sui.DIGEST_RE.test(payment)) return res.status(400).json({ error: 'X-PAYMENT must be a Sui transaction digest' })
  const [code, body] = await settleDigest(inv.id, payment, 'x402')
  if (code === 200) res.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, transaction: inv.digest || payment, network: `sui:${sui.NETWORK}` })).toString('base64'))
  res.status(code).json(body)
})

// Payer-facing: build the Payment Kit registry payment for the payer's wallet to sign.
router.post('/pay-tx', async (req, res) => {
  const { invoiceId, sender } = req.body || {}
  if (typeof sender !== 'string' || !sui.ADDRESS_RE.test(sender)) return res.status(400).json({ error: 'A valid Sui sender address is required' })
  const inv = state().invoices.find((i) => i.id === invoiceId)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (inv.status === 'paid') return res.status(409).json({ error: 'Invoice is already paid' })
  if (sender.toLowerCase() === PAYEE().toLowerCase()) return res.status(400).json({ error: 'Pay from a different wallet than the payee' })
  try {
    res.json({ bytes: await sui.buildInvoicePayment(sender, PAYEE(), sui.toMicro(inv.payAmount), inv.id), amount: inv.payAmount, payee: PAYEE(), network: sui.NETWORK })
  } catch (e) {
    const msg = e.message || ''
    res.status(400).json({ error: /EDuplicatePayment|duplicate/i.test(msg) ? 'This invoice was already paid on-chain' : /insufficient|balance|coin/i.test(msg) ? `Not enough USDC or SUI for gas in ${sender.slice(0, 10)}… on ${NET}` : `Could not build transaction: ${msg}` })
  }
})

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
      network: sui.NETWORK,
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
