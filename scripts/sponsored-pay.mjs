// Pays an invoice the way the pay page's wallet button does, gas-sponsored: the payer holds only USDC.
//   AP_AGENT_KEY=suiprivkey1... node --env-file=.env.local scripts/sponsored-pay.mjs <base-url> <invoice>
// It also listens on the invoice's live stream (Tatum gRPC checkpoints) and prints what it sees.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const [base, invoice] = process.argv.slice(2)
if (!base || !invoice || !process.env.AP_AGENT_KEY) {
  console.error('usage: AP_AGENT_KEY=suiprivkey1... node scripts/sponsored-pay.mjs <base-url> <invoice>')
  process.exit(1)
}
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const sender = kp.getPublicKey().toSuiAddress()
const api = `${base.replace(/\/$/, '')}/api/chaser`

// live stream first, so it is watching before the payment lands
const live = fetch(`${api}/pay/${invoice}/live`).then(async (r) => {
  const dec = new TextDecoder()
  for await (const chunk of r.body) {
    for (const line of dec.decode(chunk).split('\n')) if (line.startsWith('event:') && !/checkpoint/.test(line)) process.stdout.write(`[live] ${line.slice(7)} `)
      else if (line.startsWith('data:') && /"(digest|already|via)"/.test(line)) console.log(line.slice(6))
  }
})
await new Promise((r) => setTimeout(r, 3000))

const built = await (await fetch(`${api}/pay-tx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice, sender, sponsored: true }) })).json()
if (!built.sponsored) throw new Error(`not sponsored: ${JSON.stringify(built)}`)
console.log(`built ${built.amount} USDC payment; gas owner ${built.sponsored.sponsor} (budget ${built.sponsored.gasBudgetMist} MIST)`)
const { signature } = await kp.signTransaction(Buffer.from(built.bytes, 'base64'))
const r = await fetch(`${api}/pay-sponsored`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice, bytes: built.bytes, signature, mac: built.sponsored.mac }) })
const body = await r.json()
console.log(`${r.status}:`, body.message || body.error, body.explorer || '')
await Promise.race([live, new Promise((x) => setTimeout(x, 15000))])
process.exit(r.ok ? 0 : 1)
