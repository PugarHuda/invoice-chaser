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
console.log('all testnet e2e checks passed')
