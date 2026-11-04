// Accounts-payable agent that pays an Invoice Chaser invoice over MPP (Machine Payments Protocol).
//   AP_AGENT_KEY=suiprivkey1...  AP_MAX_USDC=1  node --env-file=.env.local scripts/mpp-agent.mjs <mpp-invoice-url>
// e.g. https://invoice-chaser-sigma.vercel.app/api/chaser/mpp/inv-xyz
// Reads the 402 challenge, refuses anything over AP_MAX_USDC, then lets mppx pay (USDC transfer on Sui,
// built and executed through Tatum's gRPC gateway) and retry with the signed Payment credential.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Mppx } from 'mppx/client'
import { Challenge } from 'mppx'
import { sui as suiMethod, USDC, USDC_TESTNET } from '@suimpp/mpp/client'
import { sui, NETWORK, EXPLORER, toMicro, usdcBalance, fromMicro } from '../server/sui.mjs'

const url = process.argv[2]
if (!url || !process.env.AP_AGENT_KEY) {
  console.error('usage: AP_AGENT_KEY=suiprivkey1... node --env-file=.env.local scripts/mpp-agent.mjs <mpp-invoice-url>')
  process.exit(1)
}
const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = signer.getPublicKey().toSuiAddress()
const budget = toMicro(process.env.AP_MAX_USDC || '1')

// Look before paying: the challenge says what, how much and to whom.
const first = await fetch(url)
if (first.status !== 402) {
  console.log(`No payment needed (${first.status}):`, await first.json())
  process.exit(0)
}
const challenge = Challenge.fromResponse(first)
const { amount, recipient, currency } = challenge.request
if (challenge.method !== 'sui') throw new Error(`unsupported MPP method ${challenge.method}`)
if (toMicro(amount) > budget) throw new Error(`Invoice asks ${amount} USDC, over this agent's budget`)
const have = await usdcBalance(me)
if (have < toMicro(amount)) throw new Error(`agent ${me} holds ${fromMicro(have)} USDC, needs ${amount}`)
console.log(`402 MPP challenge: ${challenge.description} -> ${amount} USDC (${currency.split('::').pop()}) to ${recipient}, from ${me}`)

const mppx = Mppx.create({ methods: [suiMethod({ client: sui(), signer, currency: NETWORK === 'mainnet' ? USDC : USDC_TESTNET })], polyfill: false })
const res = await mppx.fetch(url)
const body = await res.json()
if (!res.ok) {
  console.error(`${res.status}:`, body)
  process.exit(1)
}
const receipt = res.headers.get('payment-receipt')
console.log('200:', body.message)
if (body.explorer) console.log('tx:', body.explorer)
if (receipt) console.log('Payment-Receipt:', JSON.parse(Buffer.from(receipt, 'base64url').toString()))
console.log(`network: sui:${NETWORK} · explorer ${EXPLORER}`)
