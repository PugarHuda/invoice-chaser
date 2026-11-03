// Pay an invoice through the Sui Payment Kit registry and tell nobody: the app must find it on-chain.
//   node --env-file=.env.local --env-file=.env.testagent scripts/pay-registry.mjs <base-url> <invoiceId>
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { buildInvoicePayment, executeSigned, usdcBalance, toMicro, fromMicro, EXPLORER, NETWORK } from '../server/sui.mjs'
import { buildSwapSuiForUsdc } from '../server/swap.mjs'

const [base, id] = process.argv.slice(2)
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = kp.getPublicKey().toSuiAddress()
const exec = async (b64) => {
  const { signature } = await kp.signTransaction(Buffer.from(b64, 'base64'))
  const r = await executeSigned(b64, signature)
  return r?.Transaction?.digest || r?.transaction?.digest || r?.digest
}
const { invoice } = await fetch(`${base}/api/chaser/pay/${id}`).then((r) => r.json())
const need = toMicro(invoice.payAmount)
const have = await usdcBalance(me)
if (have < need && NETWORK === 'mainnet') {
  const s = await buildSwapSuiForUsdc(me, ((need - have) * 101n) / 100n + 1n)
  console.log(`swap ${Number(s.suiIn) / 1e9} SUI -> ${fromMicro(s.usdcOut)} USDC: ${EXPLORER}/tx/${await exec(s.bytes)}`)
  for (let i = 0; i < 10 && (await usdcBalance(me)) < need; i++) await new Promise((r) => setTimeout(r, 2000))
}
const d = await exec(await buildInvoicePayment(me, invoice.payeeAddress, need, id))
console.log(`paid ${invoice.payAmount} USDC for ${id} through the Payment Kit registry (not reported): ${EXPLORER}/tx/${d}`)
