// One-off: move the agent's WAL and spare SUI to the server's Walrus storage wallet (mainnet).
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { sui, once, executeSigned } from '../server/sui.mjs'

const WAL = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
const agent = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AP_AGENT_KEY).secretKey)
const me = agent.toSuiAddress()
const storage = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.WALRUS_STORAGE_KEY).secretKey).toSuiAddress()
const wal = BigInt((await sui().core.getBalance({ owner: me, coinType: WAL })).balance.balance)
const suiAmt = BigInt(Math.round(Number(process.argv[2] || 0) * 1e9))
const tx = new Transaction()
tx.setSender(me)
tx.transferObjects([coinWithBalance({ type: WAL, balance: wal }), coinWithBalance({ balance: suiAmt })], storage)
const bytes = Buffer.from(await once(() => tx.build({ client: sui() }))).toString('base64')
const { signature } = await agent.signTransaction(Buffer.from(bytes, 'base64'))
const r = await executeSigned(bytes, signature)
console.log(JSON.stringify(r).slice(0, 300))
console.log('moved', Number(wal) / 1e9, 'WAL +', Number(suiAmt) / 1e9, 'SUI to', storage)
