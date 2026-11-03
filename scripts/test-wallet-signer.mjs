// Signs and executes for the Playwright test wallet (a Wallet Standard wallet injected into the page
// during QA). Testnet only; the key comes from .env.testagent and never reaches the browser.
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { executeSigned, NETWORK } from '../server/sui.mjs'

export function address(key) {
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey).getPublicKey().toSuiAddress()
}
export async function signAndExecute(txJson, key) {
  if (NETWORK !== 'testnet') throw new Error('test wallet is testnet-only')
  const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey)
  const bytes = await Transaction.from(txJson).build() // already fully built by the server via Tatum
  const { signature } = await kp.signTransaction(bytes)
  const out = await executeSigned(Buffer.from(bytes).toString('base64'), signature)
  const digest = out?.Transaction?.digest || out?.transaction?.digest || out?.digest
  return { digest, bytes: Buffer.from(bytes).toString('base64'), signature }
}
