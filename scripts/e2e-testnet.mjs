// End-to-end test on Sui TESTNET against a running server (SUI_NETWORK=testnet MEMWAL_NS_PREFIX=ic:test:).
//   node --env-file=.env.local --env-file=.env.testagent scripts/e2e-testnet.mjs http://localhost:3088 <paid-invoice-id>
// Needs AP_AGENT_KEY with testnet USDC + SUI. Writes real (isolated) memories under ic:test:.
import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { buildInvoicePayment, executeSigned, toMicro, NETWORK } from '../server/sui.mjs'

assert.equal(NETWORK, 'testnet', 'run with SUI_NETWORK=testnet')
const [base, paidId] = process.argv.slice(2)
const api = (p, init) => fetch(`${base}/api/chaser${p}`, { headers: { 'content-type': 'application/json' }, ...init }).then(async (r) => [r.status, await r.json()])
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = kp.getPublicKey().toSuiAddress()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (name) => console.log(`  ✔ ${name}`)

const [, paid] = await api(`/pay/${paidId}`)
const firstDigest = paid.invoice.digest
assert.equal(paid.invoice.status, 'paid')

// (a) the x402 resource is now free: 200 with the receipt digest
const [code402, body402] = await api(`/x402/${paidId}`)
assert.equal(code402, 200)
assert.equal(body402.digest, firstDigest)
ok('paid invoice no longer asks for payment (x402 200)')

// (b) on-chain duplicate protection: building a second registry payment with the same nonce must fail
await assert.rejects(buildInvoicePayment(me, paid.invoice.payeeAddress, toMicro(paid.invoice.payAmount), paidId), /EDuplicatePayment|abort|MoveAbort|duplicate/i)
ok('Payment Kit registry refuses a second payment for the same invoice (on-chain)')

// (c) pay a new invoice WITHOUT reporting the digest; /sync-payments must find it through the registry
const [, inv2] = await api('/invoices', { method: 'POST', body: JSON.stringify({ clientId: paid.invoice.clientId, amount: 0.03, dueDate: paid.invoice.dueDate, description: 'auto-sync test' }) })
const id2 = inv2.invoice.id
const bytes = await buildInvoicePayment(me, paid.invoice.payeeAddress, toMicro(inv2.invoice.payAmount), id2)
const { signature } = await kp.signTransaction(Buffer.from(bytes, 'base64'))
await executeSigned(bytes, signature)
let synced
for (let i = 0; i < 10 && !synced; i++) {
  await sleep(4000)
  const [, s] = await api('/sync-payments', { method: 'POST' })
  synced = s.settled?.find((x) => x.invoice === id2 && x.code === 200)
}
assert.ok(synced, 'sync-payments settled the invoice from the registry record')
const [, after2] = await api(`/pay/${id2}`)
assert.equal(after2.invoice.status, 'paid')
ok(`payment found through the registry and settled without a digest (${id2})`)

// (d) replaying the first invoice's digest against another open invoice is rejected
const [, inv3] = await api('/invoices', { method: 'POST', body: JSON.stringify({ clientId: paid.invoice.clientId, amount: 0.05, dueDate: paid.invoice.dueDate, description: 'replay test' }) })
const [c3, b3] = await api('/verify-payment', { method: 'POST', body: JSON.stringify({ invoiceId: inv3.invoice.id, digest: firstDigest }) })
assert.equal(c3, 409, JSON.stringify(b3))
ok(`replayed digest rejected: ${b3.error}`)

// (e) garbage input is rejected before touching the chain
const [c4] = await api('/verify-payment', { method: 'POST', body: JSON.stringify({ invoiceId: inv3.invoice.id, digest: 'not-a-digest' }) })
assert.equal(c4, 400)
const [c5] = await api('/pay-tx', { method: 'POST', body: JSON.stringify({ invoiceId: inv3.invoice.id, sender: '0x123' }) })
assert.equal(c5, 400)
ok('malformed digest / sender rejected (400)')

// (f) payer recognition was recorded on the payment memory
const [, cl] = await api(`/clients/${paid.invoice.clientId}`)
const payMem = cl.memories.find((m) => m.tag?.invoice === paidId && m.tag?.type === 'invoice_paid')
assert.equal(payMem.tag.payer, me)
assert.ok(['x402', 'payment-kit'].includes(payMem.tag.channel), payMem.tag.channel)
ok(`payment memory records payer wallet and channel (${payMem.tag.channel})`)
// (g) partial payment then the rest: remaining balance, both legs through the registry
const [, inv4] = await api('/invoices', { method: 'POST', body: JSON.stringify({ clientId: paid.invoice.clientId, amount: 0.05, dueDate: paid.invoice.dueDate, description: 'partial test' }) })
const id4 = inv4.invoice.id
const part = 30000n // 0.03 of ~0.05
const payReg = async (micro) => {
  const b = await buildInvoicePayment(me, paid.invoice.payeeAddress, micro, id4)
  const { signature: sg } = await kp.signTransaction(Buffer.from(b, 'base64'))
  const r = await executeSigned(b, sg)
  return r?.Transaction?.digest || r?.transaction?.digest || r?.digest
}
const d1 = await payReg(part)
let v1
for (let i = 0; i < 8; i++) { await sleep(3000); v1 = await api('/verify-payment', { method: 'POST', body: JSON.stringify({ invoiceId: id4, digest: d1 }) }); if (v1[0] !== 404) break }
assert.equal(v1[0], 200, JSON.stringify(v1[1]))
assert.equal(v1[1].full, false)
const [, p4] = await api(`/pay/${id4}`)
assert.equal(p4.invoice.status, 'partial')
assert.equal(toMicro(p4.invoice.remaining), toMicro(inv4.invoice.payAmount) - part)
assert.equal(p4.invoice.payAmount, p4.invoice.remaining) // the pay page now asks only for the rest
ok(`partial payment leaves ${p4.invoice.remaining} owed; pay page asks only for that`)
await payReg(toMicro(p4.invoice.remaining))
let done4
for (let i = 0; i < 10 && !done4; i++) { await sleep(4000); const [, sy] = await api('/sync-payments', { method: 'POST' }); done4 = sy.settled?.find((x) => x.invoice === id4 && x.code === 200) }
const [, f4] = await api(`/pay/${id4}`)
assert.equal(f4.invoice.status, 'paid')
ok('remaining balance paid through the registry and auto-settled: invoice paid')

// (h) expected payer: set another wallet as this client's payer; our agent's payment is then flagged
const [cp] = await api(`/clients/${paid.invoice.clientId}/payer`, { method: 'POST', body: JSON.stringify({ payer: '0x' + '1'.repeat(64) }) })
assert.equal(cp, 200)
const [, inv5] = await api('/invoices', { method: 'POST', body: JSON.stringify({ clientId: paid.invoice.clientId, amount: 0.02, dueDate: paid.invoice.dueDate, description: 'payer test' }) })
const b5 = await buildInvoicePayment(me, paid.invoice.payeeAddress, toMicro(inv5.invoice.payAmount), inv5.invoice.id)
const { signature: s5 } = await kp.signTransaction(Buffer.from(b5, 'base64'))
const e5 = await executeSigned(b5, s5)
const d5 = e5?.Transaction?.digest || e5?.transaction?.digest || e5?.digest
let v5
for (let i = 0; i < 8; i++) { await sleep(3000); v5 = await api('/verify-payment', { method: 'POST', body: JSON.stringify({ invoiceId: inv5.invoice.id, digest: d5 }) }); if (v5[0] !== 404) break }
assert.equal(v5[0], 200, JSON.stringify(v5[1]))
assert.equal(v5[1].unexpectedPayer, true)
assert.equal(v5[1].payerScreen?.verdict, 'clean')
ok('payment from a wallet other than the expected payer is flagged; payer screened by Tatum (clean)')
console.log('all testnet e2e checks passed')
