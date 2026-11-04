// Sui reads/writes through Tatum's native gRPC gateway (JSON-RPC is deprecated on Sui).
// SUI_NETWORK=testnet switches gateway, USDC type and Payment Kit package for safe testing.
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { ChannelCredentials } from '@grpc/grpc-js'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { paymentKit, createPaymentTransactionUri } from '@mysten/payment-kit'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { verifyTransactionSignature } from '@mysten/sui/verify'

export const NETWORK = process.env.SUI_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
export const GRPC_HOST = `sui-${NETWORK}-grpc.gateway.tatum.io:443`
const USDC = {
  mainnet: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  testnet: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC', // Circle testnet USDC
}
// Testnet only: SETTLEMENT_COIN=sui settles in SUI so the full flow can be tested with faucet SUI
// (Circle's testnet USDC faucet is unreachable from some networks). Mainnet always settles in USDC.
const TEST_IN_SUI = NETWORK === 'testnet' && process.env.SETTLEMENT_COIN === 'sui'
export const USDC_COIN_TYPE = TEST_IN_SUI ? '0x2::sui::SUI' : (NETWORK === 'mainnet' && process.env.USDC_COIN_TYPE) || USDC[NETWORK]
export const COIN_SYMBOL = TEST_IN_SUI ? 'SUI' : 'USDC'
export const COIN_DECIMALS = TEST_IN_SUI ? 9 : 6
export const EXPLORER = `https://suiscan.xyz/${NETWORK}`
export const USDC_DECIMALS = 6

let client
export function sui() {
  if (!process.env.TATUM_API_KEY) throw new Error('TATUM_API_KEY is not set')
  client ??= new SuiGrpcClient({
    network: NETWORK,
    transport: new GrpcTransport({
      host: GRPC_HOST,
      channelCredentials: ChannelCredentials.createSsl(),
      meta: { 'x-api-key': process.env.TATUM_API_KEY },
    }),
  }).$extend(paymentKit())
  return client
}

// ponytail: free plan is 3 rps per key; one global queue at ~2.5 rps keeps us under it.
let last = 0
async function throttle() {
  const wait = Math.max(0, last + 400 - Date.now())
  last = Date.now() + wait
  if (wait) await new Promise((r) => setTimeout(r, wait))
}

// Retry transient gateway errors: idle channels reset (fresh channel) and the free tier's 429s
// (backoff 0.8 s, 1.6 s, 3.2 s). Errors are matched through `cause` because the SDK wraps them.
const TRANSIENT = /ECONNRESET|UNAVAILABLE|GOAWAY|socket hang up|status code 429|RESOURCE_EXHAUSTED/i
export async function once(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const text = `${e?.code} ${e?.message} ${e?.cause?.code} ${e?.cause?.message}`
      if (!TRANSIENT.test(text) || attempt >= 3) throw e
      if (/ECONNRESET|GOAWAY|hang up/i.test(text)) client = undefined
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
    }
  }
}

const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)))

export async function latestCheckpoint() {
  await throttle()
  const t = Date.now()
  const { response } = await once(() => sui().ledgerService.getCheckpoint({
    checkpointId: { oneofKind: undefined },
    readMask: { paths: ['sequence_number', 'summary.timestamp'] },
  }))
  return { sequence: String(response.checkpoint?.sequenceNumber), latencyMs: Date.now() - t }
}

export async function usdcBalance(owner) {
  await throttle()
  const { balance } = await once(() => sui().core.getBalance({ owner, coinType: USDC_COIN_TYPE }))
  return BigInt(balance.balance) // micro-USDC
}

// Fetch a transaction and return how much USDC (micro units) it moved into `payee`.
export async function usdcReceived(digest, payee) {
  await throttle()
  const { response } = await once(() => sui().ledgerService.getTransaction({
    digest,
    readMask: { paths: ['digest', 'effects.status', 'balance_changes', 'checkpoint', 'timestamp', 'events'] },
  }))
  const tx = json(response.transaction)
  const ok = tx?.effects?.status?.success === true
  const received = (tx?.balanceChanges || [])
    .filter((c) => normAddr(c.address) === normAddr(payee) && c.coinType === USDC_COIN_TYPE)
    .reduce((sum, c) => sum + BigInt(c.amount), 0n)
  const ts = tx?.timestamp ? new Date(Number(tx.timestamp.seconds) * 1000).toISOString() : null
  // did this transaction go through the Sui Payment Kit (any payment_kit event)?
  const paymentKit = (tx?.events?.events || []).some((e) => /::payment_kit::/.test(e.eventType || ''))
  return { ok, received, paymentKit, digest: tx?.digest ?? null, checkpoint: tx?.checkpoint ?? null, timestamp: ts }
}

export const normAddr = (a) => (a || '').toLowerCase().replace(/^0x0*/, '0x')

// Build (unsigned) a USDC transfer for the payer's wallet to sign. Coin selection, gas price and
// gas budget are all resolved through Tatum's gateway, so the browser never needs an RPC key.
export async function buildUsdcTransfer(sender, payee, micro) {
  const tx = new Transaction()
  tx.setSender(sender)
  tx.transferObjects([coinWithBalance({ type: USDC_COIN_TYPE, balance: BigInt(micro) })], payee)
  await throttle()
  const bytes = await once(() => tx.build({ client: sui() }))
  return Buffer.from(bytes).toString('base64')
}

// Execute an already-signed transaction through Tatum (x402 agent; sponsored payments pass both signatures).
export async function executeSigned(bytesB64, signature) {
  await throttle()
  const r = await once(() => sui().core.executeTransaction({ transaction: Buffer.from(bytesB64, 'base64'), signatures: [signature].flat() }))
  return json(r)
}

// ---- x402 v2 facilitator (exact scheme on Sui) ---------------------------------------------
// The agent sends a signed, unexecuted transaction. We check the signature against its sender,
// simulate it through Tatum to see exactly what it would move, and only then broadcast it.
export async function inspectSignedPayment(bytesB64, signature, payee) {
  const bytes = Buffer.from(bytesB64, 'base64')
  let sender
  try {
    sender = Transaction.from(bytes).getData().sender
  } catch {
    return { ok: false, reason: 'invalid_transaction' }
  }
  let signer
  try {
    signer = (await verifyTransactionSignature(bytes, signature)).toSuiAddress()
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }
  if (!sender || normAddr(signer) !== normAddr(sender)) return { ok: false, reason: 'signer_is_not_sender' }
  await throttle()
  const r = json(await once(() => sui().core.simulateTransaction({ transaction: bytes, include: { balanceChanges: true, effects: true } })))
  const t = r?.Transaction
  if (!t || t.effects?.status?.success === false) return { ok: false, reason: 'simulation_failed', detail: r?.FailedTransaction?.effects?.status?.error || t?.effects?.status?.error || null }
  const received = (t.balanceChanges || []).filter((c) => normAddr(c.address) === normAddr(payee) && c.coinType === USDC_COIN_TYPE).reduce((a, c) => a + BigInt(c.amount), 0n)
  return { ok: true, sender, received }
}

// ---- Gas sponsorship (native Sui sponsored transactions) ------------------------------------
// The payer needs only USDC: the server's gas wallet is the transaction's gas owner and co-signs.
// GAS_SPONSOR_KEY (suiprivkey…); falls back to the receipts storage wallet.
const SPONSOR_MAX_MIST = BigInt(process.env.SPONSOR_MAX_MIST || 20_000_000) // 0.02 SUI per payment
let sponsorKp
export function sponsor() {
  const k = process.env.GAS_SPONSOR_KEY || process.env.WALRUS_STORAGE_KEY
  if (!k) return null
  sponsorKp ??= Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey)
  return sponsorKp
}
export async function buildSponsoredInvoicePayment(sender, payee, micro, nonce) {
  const kp = sponsor()
  if (!kp) return null
  const tx = sui().paymentKit.tx.processRegistryPayment({ nonce, coinType: USDC_COIN_TYPE, amount: BigInt(micro), receiver: payee, sender, registryName: REGISTRY_NAME })
  tx.setSender(sender)
  tx.setGasOwner(kp.getPublicKey().toSuiAddress())
  await throttle()
  const bytes = await once(() => tx.build({ client: sui() }))
  const budget = BigInt(Transaction.from(bytes).getData().gasData.budget)
  if (budget > SPONSOR_MAX_MIST) throw new Error(`gas budget ${budget} MIST is over the sponsor cap`)
  const b64 = Buffer.from(bytes).toString('base64')
  // The sponsor signature never leaves the server: the payer gets the bytes plus a MAC, and
  // cosignSponsored() signs only bytes this server built (and submits them itself).
  return { bytes: b64, mac: sponsorMac(b64), sponsor: kp.getPublicKey().toSuiAddress(), gasBudgetMist: budget.toString() }
}
const sponsorMac = (b64) => createHmac('sha256', `sponsor:${process.env.GAS_SPONSOR_KEY || process.env.WALRUS_STORAGE_KEY}`).update(b64).digest('hex')
export async function cosignSponsored(b64, mac) {
  const kp = sponsor()
  const want = Buffer.from(sponsorMac(b64))
  if (!kp || typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), want)) return null
  return (await kp.signTransaction(Buffer.from(b64, 'base64'))).signature
}

// ---- Sui Payment Kit (Mysten standard) ------------------------------------------------------
// Invoices are paid through the shared default PaymentRegistry with nonce = invoice id. The registry
// rejects a second payment with the same (nonce, amount, receiver, coin) on-chain, and the record lets
// us find a payment by invoice without the payer telling us the digest.
export const REGISTRY_NAME = process.env.PAYMENT_REGISTRY || 'default-payment-registry'
// Copied from @mysten/payment-kit (not exported): package ids + the PaymentKey dynamic-field key.
const PK_PACKAGE = {
  mainnet: '0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6',
  testnet: '0x7e069abe383e80d32f2aec17b3793da82aabc8c2edf84abbf68dd7b719e71497',
}[NETWORK]
const PaymentKey = bcs.struct('PaymentKey', { nonce: bcs.string(), payment_amount: bcs.u64(), receiver: bcs.Address })
export const registryId = () => sui().paymentKit.getRegistryIdFromName(REGISTRY_NAME)

export async function buildInvoicePayment(sender, payee, micro, nonce) {
  const tx = sui().paymentKit.tx.processRegistryPayment({ nonce, coinType: USDC_COIN_TYPE, amount: BigInt(micro), receiver: payee, sender, registryName: REGISTRY_NAME })
  tx.setSender(sender)
  await throttle()
  const bytes = await once(() => tx.build({ client: sui() }))
  return Buffer.from(bytes).toString('base64')
}

// The SDK's getPaymentRecord builds a malformed type name (PaymentKey<phantom T><coin>), so look the
// dynamic field up directly. Returns the paying transaction digest, or null if unpaid.
export async function findInvoicePayment(payee, micro, nonce) {
  await throttle()
  try {
    const r = await once(() =>
      sui().core.getDynamicField({
        parentId: registryId(),
        name: {
          type: `${PK_PACKAGE}::payment_kit::PaymentKey<${normalizeStructTag(USDC_COIN_TYPE)}>`,
          bcs: PaymentKey.serialize({ nonce, payment_amount: BigInt(micro), receiver: payee }).toBytes(),
        },
      }),
    )
    return r?.dynamicField?.previousTransaction || null
  } catch (e) {
    if (/not found|does not exist|NOT_FOUND/i.test(e.message)) return null
    throw e
  }
}

export const paymentUri = ({ payee, micro, nonce, label, message }) =>
  createPaymentTransactionUri({ receiverAddress: payee, amount: BigInt(micro), coinType: USDC_COIN_TYPE, nonce, registryName: REGISTRY_NAME, label, message })

// Sender + SuiNS name of the wallet that paid (payer recognition).
export async function txSender(digest) {
  await throttle()
  const { response } = await once(() => sui().ledgerService.getTransaction({ digest, readMask: { paths: ['transaction.sender'] } }))
  return response.transaction?.transaction?.sender || null
}
export async function suinsName(address) {
  try {
    await throttle()
    const { response } = await once(() => sui().nameService.reverseLookupName({ address }))
    return response.record?.name || null
  } catch {
    return null
  }
}

// Real network fee for a built transaction: simulate it through Tatum and read the gas used.
export async function estimateFee(bytesB64) {
  await throttle()
  const r = await once(() => sui().core.simulateTransaction({ transaction: Buffer.from(bytesB64, 'base64'), include: { effects: true } }))
  const g = json(r)?.Transaction?.effects?.gasUsed || json(r)?.transaction?.effects?.gasUsed
  if (!g) return null
  const mist = BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate)
  return { mist: mist.toString(), sui: Number(mist) / 1e9 }
}

// SuiNS forward lookup (name.sui -> address) through Tatum's NameService.
export async function resolveSuins(name) {
  await throttle()
  const { response } = await once(() => sui().nameService.lookupName({ name }))
  return response.record?.targetAddress || null
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/
export const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/ // base58, 32 bytes

// Amount string <-> base units of the settlement coin (USDC: 6 decimals).
const D = BigInt(COIN_DECIMALS)
export const toMicro = (amount) => {
  const [i, f = ''] = String(amount).split('.')
  return BigInt(i) * 10n ** D + BigInt((f + '0'.repeat(COIN_DECIMALS)).slice(0, COIN_DECIMALS))
}
export const fromMicro = (m) => {
  const s = BigInt(m).toString().padStart(COIN_DECIMALS + 1, '0')
  return `${s.slice(0, -COIN_DECIMALS)}.${s.slice(-COIN_DECIMALS)}`
}
