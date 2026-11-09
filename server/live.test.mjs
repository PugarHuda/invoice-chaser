import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matches } from './live.mjs'

test('live stream matches only the exact amount to the exact payee in the settlement coin', () => {
  const C = '0xusdc::usdc::USDC'
  const w = { payee: '0xabc', micro: 300004217n, hit: false }
  const cp = { transactions: [
    { digest: 'wrongCoin', balanceChanges: [{ address: '0xabc', coinType: '0x2::sui::SUI', amount: '300004217' }] },
    { digest: 'wrongAmt', balanceChanges: [{ address: '0xabc', coinType: C, amount: '300000000' }] },
    { digest: 'otherPayee', balanceChanges: [{ address: '0xdef', coinType: C, amount: '300004217' }] },
    { digest: 'good', balanceChanges: [{ address: '0x0abc', coinType: C, amount: '300004217' }, { address: '0x1', coinType: C, amount: '-300004217' }] },
    { digest: 'second', balanceChanges: [{ address: '0xabc', coinType: C, amount: '300004217' }] },
  ] }
  assert.deepEqual(matches(cp, [w], C).map(([, d]) => d), ['good'])
  assert.deepEqual(matches(cp, [{ ...w, hit: true }], C), [])
})

test('ics lines fold at 75 octets without splitting UTF-8', async () => {
  const { foldIcs } = await import('./engine.mjs')
  const line = 'DESCRIPTION:' + 'é'.repeat(80)
  const parts = foldIcs(line).split('\r\n')
  assert.ok(parts.every((p) => Buffer.byteLength(p) <= 75))
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), line)
  assert.equal(foldIcs('SHORT:x'), 'SHORT:x')
})

test('openapi.json follows MPP discovery: every payable op has offers with intent, method, amount', async () => {
  const { openapi } = await import('./openapi.mjs')
  const d = openapi('https://x.example')
  assert.equal(d.openapi, '3.1.0')
  const payable = Object.values(d.paths).flatMap((p) => Object.values(p)).filter((op) => op['x-payment-info'])
  assert.equal(payable.length, 2)
  for (const op of payable) {
    assert.ok(op.responses[402])
    for (const o of op['x-payment-info'].offers) {
      assert.ok(['charge', 'session'].includes(o.intent) && o.method)
      assert.ok(o.amount === null || /^(0|[1-9]\d*)$/.test(o.amount))
    }
  }
})

test('x402 v2 signature check: wrong signer and malformed signatures are refused before any network call', async () => {
  const s = await import('./sui.mjs')
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const { Transaction } = await import('@mysten/sui/transactions')
  const kp = new Ed25519Keypair()
  const tx = new Transaction()
  tx.setSender(kp.toSuiAddress()); tx.setGasPrice(1000); tx.setGasBudget(1e7); tx.setExpiration({ None: true })
  tx.setGasPayment([{ objectId: '0x' + '1'.repeat(64), version: '1', digest: '11111111111111111111111111111111' }])
  const bytes = await tx.build()
  const b64 = Buffer.from(bytes).toString('base64')
  const other = (await new Ed25519Keypair().signTransaction(bytes)).signature
  process.env.TATUM_API_KEY ||= 'test-key-not-used' // client is constructed but never called on these paths
  assert.equal((await s.inspectSignedPayment(b64, other, '0x1', 'inv-x')).reason, 'signer_is_not_sender')
  assert.equal((await s.inspectSignedPayment(b64, 'AAAA', '0x1', 'inv-x')).reason, 'invalid_signature')
  assert.equal((await s.inspectSignedPayment('not-a-tx', other, '0x1', 'inv-x')).reason, 'invalid_transaction')
})

test('the whole app module graph loads (catches syntax errors in any route or discovery file)', async () => {
  const { default: app } = await import('../app.mjs')
  assert.equal(typeof app, 'function')
  const { llms } = await import('./discovery.mjs')
  assert.match(llms('https://x.example'), /invoice\.pdf/)
})

test('every response carries the security headers; an oversized body is a 413 that says so', async () => {
  const { default: app } = await import('../app.mjs')
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const r = await fetch(`${base}/.well-known/nothing`)
    assert.equal(r.status, 404)
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    const big = await fetch(`${base}/api/chaser/invoices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(200_000) }) })
    assert.equal(big.status, 413)
    assert.match((await big.json()).error, /too large/)
  } finally { srv.close() }
})

test('invoice and receipt PDFs render client names the standard font cannot encode', async () => {
  const { invoicePdf, receiptPdf } = await import('./receipts.mjs')
  const v = { id: 'inv-x', client: '株式会社 Café 🚀', description: 'Ünïcødé — “quotes”', issuedDate: '2026-11-01', dueDate: '2026-11-10', amount: '1.000001', payee: '0x1', network: 'mainnet', paymentUri: 'sui:pay?x=1', payUrl: 'https://x/?pay=inv-x', mppUrl: 'https://x/m', x402Url: 'https://x/x', status: 'sent', explorer: 'https://e' }
  const pdf = await invoicePdf(v)
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-')
  assert.ok((await invoicePdf({ ...v, status: 'paid', digest: 'D' })).length > 500)
  assert.ok((await receiptPdf({ invoiceId: 'inv-x', client: v.client, description: v.description, amount: '1', dueDate: 'd', paidOn: 'p', payments: [{ digest: 'D', received: '1', payer: '0x2' }], payee: '0x1', network: 'mainnet', explorer: 'https://e' })).length > 500)
})

test('a rejected async handler becomes a JSON 500, not a hung request', async () => {
  const express = (await import('express')).default
  const { Router } = await import('./async-router.mjs')
  const app = express()
  const r = Router()
  r.get('/boom', async () => { throw new Error('kaboom') })
  r.get('/ok', async (_req, res) => res.json({ ok: true }))
  app.use('/api', r)
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }))
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}/api`
  try {
    const boom = await fetch(`${base}/boom`, { signal: AbortSignal.timeout(3000) })
    assert.equal(boom.status, 500)
    assert.deepEqual(await boom.json(), { error: 'kaboom' })
    assert.equal((await fetch(`${base}/ok`)).status, 200)
  } finally {
    srv.close()
  }
})

test('gasless relay MAC is bound to its invoice and fails closed without a server secret', async () => {
  const { createHmac } = await import('node:crypto')
  const s = await import('./sui.mjs')
  const keys = ['MPP_SECRET_KEY', 'CRON_SECRET', 'GAS_SPONSOR_KEY', 'WALRUS_STORAGE_KEY']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    for (const k of keys) delete process.env[k]
    assert.equal(s.gaslessRelayEnabled(), false)
    assert.equal(s.gaslessMacOk('AAAA', 'a'.repeat(64), 'inv-1'), false) // no secret: never valid
    process.env.MPP_SECRET_KEY = 'k'
    const mac = createHmac('sha256', 'gasless:inv-1:k').update('AAAA').digest('hex')
    assert.equal(s.gaslessMacOk('AAAA', mac, 'inv-1'), true)
    assert.equal(s.gaslessMacOk('AAAA', mac, 'inv-2'), false) // same bytes, other invoice
    assert.equal(s.gaslessMacOk('AAAB', mac, 'inv-1'), false)
  } finally {
    for (const k of keys) saved[k] == null ? delete process.env[k] : (process.env[k] = saved[k])
  }
})

test('x402 Bazaar discovery info validates against the schema it ships with', async () => {
  const { default: Ajv } = await import('ajv/dist/2020.js')
  const { bazaarV2 } = await import('./routes/chaser.mjs')
  const b = bazaarV2({ id: 'inv-x' })
  const ok = new Ajv({ strict: false }).validate(b.schema, b.info)
  assert.ok(ok, 'bazaar info must satisfy its own schema')
  assert.match(b.routeTemplate, /^\/[a-zA-Z0-9_/:.\-~%]+$/)
})

test('a FailedTransaction from execute is reported, never treated as a settleable digest', async () => {
  const { executed } = await import('./sui.mjs')
  assert.deepEqual(executed({ Transaction: { digest: 'D1' } }), { digest: 'D1' })
  const f = executed({ FailedTransaction: { digest: 'D2', effects: { status: { error: { message: 'InsufficientCoinBalance' } } } } })
  assert.equal(f.digest, 'D2')
  assert.match(f.failed, /failed on-chain: InsufficientCoinBalance/)
  assert.deepEqual(executed(undefined), { digest: null })
})

test('owner writes fail closed without a passcode (Vercel or not); wrong passcodes are throttled', async () => {
  const saved = { VERCEL: process.env.VERCEL, APP_PASSCODE: process.env.APP_PASSCODE, ALLOW_OPEN_WRITES: process.env.ALLOW_OPEN_WRITES }
  const { default: app } = await import('../app.mjs')
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}/api/chaser`
  const post = (path, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })
  try {
    process.env.VERCEL = '1'
    delete process.env.APP_PASSCODE
    assert.equal((await post('/clients')).status, 503)
    delete process.env.VERCEL
    assert.equal((await post('/clients')).status, 503, 'no passcode off Vercel (CI, fresh clone) must not open writes')
    process.env.APP_PASSCODE = 'right-one'
    // requests without a passcode are refused but never lock the owner out
    for (let i = 0; i < 15; i++) assert.equal((await post('/clients')).status, 401)
    const codes = []
    for (let i = 0; i < 12; i++) codes.push((await post('/clients', { 'x-passcode': 'wrong' })).status)
    assert.deepEqual([codes[0], codes[9], codes[10]], [401, 401, 429])
    // locked out: even the right passcode is refused until the window resets
    assert.equal((await post('/clients', { 'x-passcode': 'right-one' })).status, 429)
    // a public read can't be used to keep guessing either
    assert.equal((await fetch(base + '/summary', { headers: { 'x-passcode': 'right-one' } })).status, 429)
  } finally {
    srv.close()
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
})

test('proven payer: a fresh signed proof for this invoice verifies; wrong text, stale, or wrong signer are refused', async () => {
  const { verifyPayerProof, payerProofMessage } = await import('./sui.mjs')
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const kp = new Ed25519Keypair()
  const address = kp.toSuiAddress()
  const now = Date.parse('2026-11-07T10:00:00Z')
  const sign = async (text) => (await kp.signPersonalMessage(new TextEncoder().encode(text))).signature
  const message = payerProofMessage('inv-101', 'Acme Corp', '2026-11-07T09:58:00.000Z')
  const base = { message, signature: await sign(message), address, invoiceId: 'inv-101', clientName: 'Acme Corp', now }
  assert.deepEqual(await verifyPayerProof(base), { ok: true, address, scheme: 'ED25519' })
  // the same signature can't prove a payer for another invoice or client
  assert.equal((await verifyPayerProof({ ...base, invoiceId: 'inv-102' })).ok, false)
  assert.equal((await verifyPayerProof({ ...base, clientName: 'Beta Ltd' })).ok, false)
  // older than 10 minutes
  assert.match((await verifyPayerProof({ ...base, now: now + 11 * 60_000 })).reason, /expired/)
  // signed by a different wallet than the one claimed
  const other = new Ed25519Keypair().toSuiAddress()
  assert.match((await verifyPayerProof({ ...base, address: other })).reason, /invalid signature|not from this address/)
  // garbage
  assert.equal((await verifyPayerProof({ ...base, signature: 'AAAA' })).ok, false)
  assert.equal((await verifyPayerProof({ ...base, address: 'not-an-address' })).ok, false)
})

test('new invoice input: negative, zero, huge, NaN, 3 decimals, fake dates and bad repeat are refused', async () => {
  const { invoiceInputError: e } = await import('./routes/chaser.mjs')
  const ok = { amount: '250', dueDate: '2026-12-31' }
  assert.equal(e(ok), null)
  assert.equal(e({ ...ok, amount: 0.01 }), null)
  assert.equal(e({ ...ok, amount: '1000000', repeat: 'monthly' }), null)
  for (const amount of ['-5', -5, '0', 0, '0.001', '1000000.01', 1e21, 'NaN', 'Infinity', '', null, '1e3', ' 5', '5,00', [5]]) assert.ok(e({ ...ok, amount }), `amount ${JSON.stringify(amount)}`)
  for (const dueDate of ['2026-02-30', '2026-13-01', '31-12-2026', '', undefined]) assert.ok(e({ ...ok, dueDate }), `dueDate ${dueDate}`)
  assert.ok(e({ ...ok, repeat: 'daily' }))
  assert.ok(e({ ...ok, description: { x: 1 } }))
  assert.ok(e({ ...ok, description: 'x'.repeat(201) }))
  assert.equal(e({ ...ok, description: '🧾 <b>Design</b> & "QA"' }), null)
})

test('xero: plan creates each invoice once and records only the unpaid difference', async () => {
  const { xeroPlan } = await import('./integrations.mjs')
  const clients = [{ id: 'c1', name: 'Acme Corp' }]
  const invoices = [
    { id: 'inv-1', clientId: 'c1', baseAmount: 100, issuedDate: '2026-10-01', dueDate: '2026-10-15', status: 'paid', digest: 'D1', settledAt: '2026-10-20T00:00:00Z' },
    { id: 'inv-2', clientId: 'c1', baseAmount: 50, issuedDate: '2026-10-01', dueDate: '2026-11-15', status: 'partial', partialAmount: '20.004321', settledAt: '2026-11-01T00:00:00Z' },
    { id: 'inv-3', clientId: 'c1', baseAmount: 70, issuedDate: '2026-11-01', dueDate: '2026-11-20', status: 'sent' },
  ]
  const opts = { revenueCode: '200', bankAccountId: 'BANK' }
  const first = xeroPlan({ clients, invoices }, [], opts)
  assert.deepEqual(first.create.map((x) => [x.InvoiceNumber, x.Contact.Name, x.LineItems[0].UnitAmount, x.LineItems[0].AccountCode]), [['inv-1', 'Acme Corp', 100, '200'], ['inv-2', 'Acme Corp', 50, '200'], ['inv-3', 'Acme Corp', 70, '200']])
  assert.deepEqual(first.payments.map((p) => [p.invoiceNumber, p.Amount, p.Reference, p.Date]), [['inv-1', 100, 'Sui D1', '2026-10-20'], ['inv-2', 20, 'USDC on Sui', '2026-11-01']])
  // second run after Xero recorded everything: nothing to do
  const existing = [{ InvoiceNumber: 'inv-1', AmountPaid: 100 }, { InvoiceNumber: 'inv-2', AmountPaid: 20 }, { InvoiceNumber: 'inv-3', AmountPaid: 0 }]
  assert.deepEqual(xeroPlan({ clients, invoices }, existing, opts), { create: [], payments: [] })
  // more USDC arrived on inv-2: only the difference is paid
  invoices[1].partialAmount = '35.5'
  assert.deepEqual(xeroPlan({ clients, invoices }, existing, opts).payments.map((p) => p.Amount), [15.5])
})

test('xero: OAuth state is MACed, expires, and rejects tampering', async () => {
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
  const { xeroAuthUrl, xeroStateValid } = await import('./integrations.mjs')
  const url = new URL(xeroAuthUrl('https://x.test/cb', 1_000))
  const state = url.searchParams.get('state')
  assert.match(url.searchParams.get('scope'), /accounting\.invoices/)
  assert.equal(xeroStateValid(state, 2_000), true)
  assert.equal(xeroStateValid(state, 1_000 + 10 * 60_000 + 1), false, 'expired')
  assert.equal(xeroStateValid(state.replace(/^\d+/, '99999999999999'), 2_000), false, 'tampered expiry')
  assert.equal(xeroStateValid('', 2_000), false)
  delete process.env.XERO_CLIENT_ID
  delete process.env.XERO_CLIENT_SECRET
})

test('email: refused without SMTP config or a client address, never sent', async () => {
  const { sendEmail } = await import('./integrations.mjs')
  delete process.env.SMTP_USER
  await assert.rejects(sendEmail({ to: 'a@b.co', subject: 's', text: 't' }), /not configured/)
  process.env.SMTP_USER = 'u'
  process.env.SMTP_PASS = 'p'
  await assert.rejects(sendEmail({ to: 'not-an-email', subject: 's', text: 't' }), /no email address/)
  delete process.env.SMTP_USER
  delete process.env.SMTP_PASS
})

test('security PoCs S-15/S-16/S-17: a paid client cannot be archived, the sandbox obeys private mode, Xero errors are plain text', async () => {
  const mem = await import('./memory.mjs')
  const saved = { PRIVATE_READS: process.env.PRIVATE_READS, APP_PASSCODE: process.env.APP_PASSCODE, XERO_CLIENT_ID: process.env.XERO_CLIENT_ID, XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET, KV_REST_API_URL: process.env.KV_REST_API_URL, KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN }
  const snapshot = new Map(mem.store)
  const loaded = { ...mem.loadState }
  // an in-memory book: client c-poc has one paid invoice; nothing here reaches Walrus
  mem.store.clear()
  mem.store.set(mem.clientNs('c-poc'), [
    { id: 'a', timestamp: '2026-11-01T00:00:00Z', tag: { type: 'client_created', client: 'c-poc', name: 'PoC' } },
    { id: 'b', timestamp: '2026-11-01T00:01:00Z', tag: { type: 'invoice_sent', client: 'c-poc', invoice: 'inv-poc', base: 1, pay_amount: '1.000123', due: '2026-12-01' } },
    { id: 'c', timestamp: '2026-11-02T00:00:00Z', tag: { type: 'invoice_paid', client: 'c-poc', invoice: 'inv-poc', digest: 'DPOC', received: '1.000123' } },
  ])
  Object.assign(mem.loadState, { loaded: true, loading: false, error: null, loadedAt: new Date().toISOString() })
  const { default: app } = await import('../app.mjs')
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}/api/chaser`
  // its own client IP (one trusted proxy hop), so the lockout the throttling test left on 127.0.0.1 doesn't apply
  const post = (path, body = {}, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9', ...headers }, body: JSON.stringify(body) })
  try {
    process.env.APP_PASSCODE = 'poc-pass'
    // S-15: archiving would hide money that arrived; refused before anything is written
    const r = await post('/clients/c-poc/archive', {}, { 'x-passcode': 'poc-pass' })
    assert.equal(r.status, 409)
    assert.match((await r.json()).error, /paid anything/)
    // S-16: with private mode on, the sandbox needs the passcode like any owner read
    process.env.PRIVATE_READS = '1'
    assert.equal((await post('/clients/c-poc/preview-rule', { preference: 'never before the 20th' })).status, 401)
    assert.equal((await post('/clients/c-poc/preview-rule', { preference: 'never before the 20th' }, { 'x-passcode': 'poc-pass' })).status, 200)
    delete process.env.PRIVATE_READS
    // S-17: a bad or replayed OAuth state is refused, as plain text
    Object.assign(process.env, { XERO_CLIENT_ID: 'cid', XERO_CLIENT_SECRET: 'secret', KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 't' })
    const cb = await fetch(`${base}/xero/callback?code=x&state=${encodeURIComponent('<script>alert(1)</script>')}`, { headers: { 'x-forwarded-for': '10.9.9.9' } })
    assert.equal(cb.status, 400)
    assert.match(cb.headers.get('content-type'), /^text\/plain/)
  } finally {
    srv.close()
    mem.store.clear()
    for (const [k, v] of snapshot) mem.store.set(k, v)
    Object.assign(mem.loadState, loaded)
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
})
