// A tiny accounts-payable agent that pays an Invoice Chaser invoice over x402 on Sui Mainnet.
//   AP_AGENT_KEY=suiprivkey1...  AP_MAX_USDC=1  node --env-file=.env.local scripts/ap-agent.mjs <invoice-url> [--v1]
// x402 v2 when the server offers it (PAYMENT-REQUIRED header): sign the payment, send it unexecuted in
// PAYMENT-SIGNATURE and let the server simulate + broadcast it. --v1 executes itself and sends X-PAYMENT.
// e.g. <invoice-url> = https://invoice-chaser-sigma.vercel.app/api/chaser/x402/inv-xyz
// The agent needs a little USDC and SUI (gas) on Mainnet. It refuses anything over AP_MAX_USDC.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { buildInvoicePayment, buildUsdcTransfer, executeSigned, usdcBalance, USDC_COIN_TYPE, NETWORK, EXPLORER, toMicro, fromMicro } from '../server/sui.mjs'
import { buildSwapSuiForUsdc } from '../server/swap.mjs'

const url = process.argv.slice(2).find((a) => !a.startsWith('--'))
const forceV1 = process.argv.includes('--v1')
if (!url || !process.env.AP_AGENT_KEY) {
  console.error('usage: AP_AGENT_KEY=suiprivkey1... node --env-file=.env.local scripts/ap-agent.mjs <x402-invoice-url>')
  process.exit(1)
}
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = kp.getPublicKey().toSuiAddress()
const budget = toMicro(process.env.AP_MAX_USDC || '1')

const first = await fetch(url)
if (first.status !== 402) {
  console.log(`No payment needed (${first.status}):`, await first.json())
  process.exit(0)
}
const { accepts } = await first.json()
const terms = accepts.find((a) => a.scheme === 'exact' && a.network === `sui:${NETWORK}` && a.asset === USDC_COIN_TYPE)
if (!terms) throw new Error(`No sui:${NETWORK} USDC payment option offered`)
if (BigInt(terms.maxAmountRequired) > budget) throw new Error(`Invoice asks ${terms.amount} USDC, over this agent's budget`)
console.log(`402: ${terms.description} → pay ${terms.amount} USDC to ${terms.payTo} from ${me}`)

// Not enough USDC? Swap just enough SUI -> USDC (Cetus aggregator, built + executed through Tatum).
const need = BigInt(terms.maxAmountRequired)
const have = await usdcBalance(me)
if (have < need) {
  if (NETWORK !== 'mainnet') throw new Error(`agent holds ${fromMicro(have)} USDC, needs ${terms.amount}`)
  const shortfall = ((need - have) * 101n) / 100n + 1n // +1% so rounding never leaves us short
  const swap = await buildSwapSuiForUsdc(me, shortfall)
  console.log(`swapping ~${Number(swap.suiIn) / 1e9} SUI -> ${fromMicro(swap.usdcOut)} USDC via ${swap.providers.join(', ')}`)
  const { signature: sig } = await kp.signTransaction(Buffer.from(swap.bytes, 'base64'))
  const res = await executeSigned(swap.bytes, sig)
  const d = res?.Transaction?.digest || res?.transaction?.digest || res?.digest
  console.log('swap tx:', `${EXPLORER}/tx/${d}`)
  for (let i = 0; i < 10 && (await usdcBalance(me)) < need; i++) await new Promise((r) => setTimeout(r, 2000))
}

// Prefer Sui Payment Kit (nonce = invoice): the registry makes a double payment impossible on-chain.
const pk = terms.extra?.paymentKit
const bytes = pk?.nonce
  ? await buildInvoicePayment(me, terms.payTo, BigInt(terms.maxAmountRequired), pk.nonce)
  : await buildUsdcTransfer(me, terms.payTo, BigInt(terms.maxAmountRequired))
const { signature } = await kp.signTransaction(Buffer.from(bytes, 'base64'))

const v2req = !forceV1 && first.headers.get('payment-required')
if (v2req) {
  const required = JSON.parse(Buffer.from(v2req, 'base64').toString())
  const accepted = required.accepts.find((a) => a.scheme === 'exact' && a.network === `sui:${NETWORK}` && a.asset === USDC_COIN_TYPE)
  if (!accepted || BigInt(accepted.amount) !== BigInt(terms.maxAmountRequired)) throw new Error('v2 requirements disagree with v1 terms')
  const header = Buffer.from(JSON.stringify({ x402Version: 2, resource: required.resource, accepted, payload: { signature, transaction: bytes } })).toString('base64')
  console.log('x402 v2: sending the signed (unexecuted) transaction in PAYMENT-SIGNATURE')
  const paid = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': header } })
  const body = await paid.json()
  const pr = paid.headers.get('payment-response')
  if (pr) console.log('PAYMENT-RESPONSE:', JSON.parse(Buffer.from(pr, 'base64').toString()))
  console.log(`${paid.status}:`, body.message || body.error, body.explorer || '')
  process.exit(paid.ok ? 0 : 1)
}

const exec = await executeSigned(bytes, signature)
const digest = exec?.Transaction?.digest || exec?.transaction?.digest || exec?.digest
console.log(`executed on sui:${NETWORK}:`, digest)

for (let i = 0; i < 6; i++) {
  const paid = await fetch(url, { headers: { 'X-PAYMENT': digest } })
  const body = await paid.json()
  if (paid.ok) {
    console.log('200 receipt:', body.message, `${EXPLORER}/tx/${digest}`)
    process.exit(0)
  }
  console.log(`${paid.status}: ${body.error}; retrying`)
  await new Promise((r) => setTimeout(r, 3000))
}
process.exit(1)
