// One-off: create the server's Walrus storage wallet (if missing) and fund it from the agent wallet:
// swap SUI -> WAL through the Cetus aggregator, then send WAL + a little SUI for gas. Mainnet only.
// usage: node --env-file=.env.local --env-file=.env.testagent scripts/fund-storage.mjs <suiForWal> <suiForGas>
import fs from 'node:fs'
import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { sui, once, executeSigned, NETWORK } from '../server/sui.mjs'

const WAL = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
if (NETWORK !== 'mainnet') throw new Error('mainnet only')
const [suiForWal, suiForGas] = process.argv.slice(2).map((x) => BigInt(Math.round(Number(x) * 1e9)))

let storageKey = process.env.WALRUS_STORAGE_KEY
if (!storageKey) {
  storageKey = new Ed25519Keypair().getSecretKey()
  fs.appendFileSync('.env.local', `\nWALRUS_STORAGE_KEY=${storageKey}\n`)
  console.log('created storage wallet (key saved to .env.local only)')
}
const storage = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(storageKey).secretKey).toSuiAddress()
const agent = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = agent.toSuiAddress()
console.log('storage address', storage)

const run = async (tx) => {
  tx.setSender(me)
  const bytes = Buffer.from(await once(() => tx.build({ client: sui() }))).toString('base64')
  const { signature } = await agent.signTransaction(Buffer.from(bytes, 'base64'))
  const r = await executeSigned(bytes, signature)
  const t = r.transaction || r
  if (t.effects?.status?.success === false) throw new Error(JSON.stringify(t.effects.status))
  return t.digest
}

const agg = new AggregatorClient({ client: sui(), signer: me, env: Env.Mainnet })
const route = await once(() => agg.findRouters({ from: '0x2::sui::SUI', target: WAL, amount: suiForWal.toString(), byAmountIn: true }))
if (!route || route.insufficientLiquidity) throw new Error('no SUI -> WAL route')
console.log('quote', Number(suiForWal) / 1e9, 'SUI ->', Number(route.amountOut.toString()) / 1e9, 'WAL')
const swapTx = new Transaction()
swapTx.setSender(me)
await once(() => agg.fastRouterSwap({ router: route, txb: swapTx, slippage: 0.02 }))
console.log('swap', await run(swapTx))

const walBal = BigInt((await sui().core.getBalance({ owner: me, coinType: WAL })).balance.balance)
const send = new Transaction()
send.transferObjects([coinWithBalance({ type: WAL, balance: walBal }), coinWithBalance({ balance: suiForGas })], storage)
console.log('fund', await run(send), Number(walBal) / 1e9, 'WAL +', Number(suiForGas) / 1e9, 'SUI')
