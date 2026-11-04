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
