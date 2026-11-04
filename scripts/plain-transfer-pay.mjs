// Pay an invoice the way an exchange withdrawal would: a plain USDC transfer of the exact amount,
// no Payment Kit nonce, no pay page open, nothing reported to the server. Then only call the
// public sync and watch reconciliation (Tatum gRPC ListTransactions, affected_address) settle it.
//   node --env-file=.env.local --env-file=.env.testagent scripts/plain-transfer-pay.mjs <invoiceId> [baseUrl]
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { buildUsdcTransfer, executeSigned, usdcBalance, toMicro, fromMicro } from '../server/sui.mjs'
import { buildSwapSuiForUsdc } from '../server/swap.mjs'

const [id, base = 'https://invoice-chaser-sigma.vercel.app'] = process.argv.slice(2)
if (!id) throw new Error('usage: plain-transfer-pay.mjs <invoiceId> [baseUrl]')
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = kp.toSuiAddress()

const terms = await (await fetch(`${base}/api/chaser/pay/${id}`)).json()
if (!terms.invoice) throw new Error(terms.error || 'invoice not found')
if (terms.invoice.status === 'paid') throw new Error('invoice already paid')
const amount = terms.invoice.remaining || terms.invoice.payAmount
const micro = toMicro(amount)
const payee = terms.invoice.payeeAddress
console.log(`invoice ${id}: ${amount} USDC to ${payee}`)
if (!payee) throw new Error('no payee in terms')

const have = await usdcBalance(me)
if (have < micro) {
  const swap = await buildSwapSuiForUsdc(me, micro - have + 1000n)
  const { signature } = await kp.signTransaction(Buffer.from(swap.bytes, 'base64'))
  const r = await executeSigned(swap.bytes, signature)
  console.log(`swapped ${Number(swap.suiIn) / 1e9} SUI -> ${fromMicro(swap.usdcOut)} USDC: ${r.Transaction?.digest || r.FailedTransaction?.digest}`)
  await new Promise((r) => setTimeout(r, 3000))
}

const bytes = await buildUsdcTransfer(me, payee, micro)
const { signature } = await kp.signTransaction(Buffer.from(bytes, 'base64'))
const sent = await executeSigned(bytes, signature)
console.log(`plain USDC transfer (no nonce, not reported): ${sent.Transaction?.digest || sent.FailedTransaction?.digest}`)

for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 10_000))
  const s = await (await fetch(`${base}/api/chaser/sync-payments`, { method: 'POST' })).json()
  const hit = s.settled?.find((x) => x.invoice === id)
  console.log(`sync #${i + 1}: checked ${s.checked}, reconciled ${s.reconciled ?? 0}${s.cached ? ' (cached)' : ''}${hit ? ` -> ${hit.code} ${hit.message}` : ''}`)
  if (hit?.code === 200) process.exit(0)
  const now = await (await fetch(`${base}/api/chaser/pay/${id}`)).json()
  if (now.invoice?.status === 'paid') { console.log(`paid (settled by another instance): ${now.invoice.digest || ''}`); process.exit(0) }
}
process.exit(1)
