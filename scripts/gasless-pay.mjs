// Pay an invoice with a native gasless USDC transfer (Sui Address Balances): the payer holds no SUI,
// nobody sponsors gas. Uses the same endpoints a wallet does: /pay-tx builds, the payer signs,
// /pay-gasless submits through Tatum and settles.
//   node --env-file=.env.testagent scripts/gasless-pay.mjs <invoiceId> [amount] [baseUrl] [--dry]
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'

const args = process.argv.slice(2).filter((a) => a !== '--dry')
const dry = process.argv.includes('--dry')
const [id, amount, base = 'https://invoice-chaser-sigma.vercel.app'] = args
if (!id) throw new Error('usage: gasless-pay.mjs <invoiceId> [amount] [baseUrl] [--dry]')
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const post = (path, body) => fetch(`${base}/api/chaser${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const r = await post('/pay-tx', { invoiceId: id, sender: kp.toSuiAddress(), sponsored: false, ...(amount && amount !== '-' ? { amount } : {}) })
const built = await r.json()
if (!r.ok) throw new Error(built.error)
if (!built.gasless) throw new Error(`server did not offer gasless: ${r.headers.get('x-gasless-skipped') || 'no reason given'}`)
const g = Transaction.from(built.bytes).getData().gasData
console.log(`gasless transfer of ${built.amount} USDC built (gas price ${g.price}, budget ${g.budget}, gas coins ${g.payment?.length ?? 0}); address balance ${built.gasless.addressBalance}`)
if (dry) process.exit(0)

const { signature } = await kp.signTransaction(Buffer.from(built.bytes, 'base64'))
const v = await post('/pay-gasless', { invoiceId: id, bytes: built.bytes, signature, mac: built.gasless.mac })
const out = await v.json()
console.log(v.status, out.message || out.error, out.digest || '')
process.exit(v.ok ? 0 : 1)
