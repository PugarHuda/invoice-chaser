// A tiny accounts-payable agent that pays an Invoice Chaser invoice over x402 on Sui Mainnet.
//   AP_AGENT_KEY=suiprivkey1...  AP_MAX_USDC=1  node --env-file=.env.local scripts/ap-agent.mjs <invoice-url>
// e.g. <invoice-url> = https://invoice-chaser-sigma.vercel.app/api/chaser/x402/inv-xyz
// The agent needs a little USDC and SUI (gas) on Mainnet. It refuses anything over AP_MAX_USDC.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { buildUsdcTransfer, executeSigned, USDC_COIN_TYPE, toMicro } from '../server/sui.mjs'

const url = process.argv[2]
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
const terms = accepts.find((a) => a.scheme === 'exact' && a.network === 'sui:mainnet' && a.asset === USDC_COIN_TYPE)
if (!terms) throw new Error('No Sui Mainnet USDC payment option offered')
if (BigInt(terms.maxAmountRequired) > budget) throw new Error(`Invoice asks ${terms.amount} USDC, over this agent's budget`)
console.log(`402: ${terms.description} → pay ${terms.amount} USDC to ${terms.payTo} from ${me}`)

const bytes = await buildUsdcTransfer(me, terms.payTo, BigInt(terms.maxAmountRequired))
const { signature } = await kp.signTransaction(Buffer.from(bytes, 'base64'))
const exec = await executeSigned(bytes, signature)
const digest = exec?.Transaction?.digest || exec?.transaction?.digest || exec?.digest
console.log('executed on Sui Mainnet:', digest)

for (let i = 0; i < 6; i++) {
  const paid = await fetch(url, { headers: { 'X-PAYMENT': digest } })
  const body = await paid.json()
  if (paid.ok) {
    console.log('200 receipt:', body.message, `https://suiscan.xyz/mainnet/tx/${digest}`)
    process.exit(0)
  }
  console.log(`${paid.status}: ${body.error}; retrying`)
  await new Promise((r) => setTimeout(r, 3000))
}
process.exit(1)
