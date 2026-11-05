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
    const r = await fetch(`${base}/api/chaser/nothing`)
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
