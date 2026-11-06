// Sui reads/writes through Tatum's native gRPC gateway (JSON-RPC is deprecated on Sui).
// SUI_NETWORK=testnet switches gateway, USDC type and Payment Kit package for safe testing.
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'
// every unary call gets a deadline: a stalled gateway must not hang a request (and its settle lock) for 300 s
const RPC_TIMEOUT_MS = 10_000
import { ChannelCredentials } from '@grpc/grpc-js'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
export const isSettlementCoin = (t) => { try { return normalizeStructTag(t) === normalizeStructTag(USDC_COIN_TYPE) } catch { return false } }
import { paymentKit, createPaymentTransactionUri } from '@mysten/payment-kit'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { createHmac, timingSafeEqual, randomInt } from 'node:crypto'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { parseSerializedSignature } from '@mysten/sui/cryptography'

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

// Provider: Tatum's gRPC gateway. If the Tatum plan's credits run out (HTTP 402 "plan limit
// exceeded"), calls fall back to the public Sui fullnode (gRPC-web) for 10 minutes and then try Tatum
// again: the organizers' rule for exhausted credits. /proof and the UI report which one is serving.
const PUBLIC_GRPC = `https://fullnode.${NETWORK}.sui.io:443`
const QUOTA_RETRY_MS = 10 * 60_000
const QUOTA = /status code 402|plan limit|Payment Required/i
let quotaHitAt = null
let publicClient
export const provider = () => (!process.env.TATUM_API_KEY || (quotaHitAt && Date.now() - quotaHitAt < QUOTA_RETRY_MS) ? 'public-fullnode' : 'tatum')
export const fallbackReason = () => (process.env.TATUM_API_KEY ? 'Tatum credits exhausted' : 'no Tatum API key configured')
export const providerStatus = () => ({ provider: provider(), tatumQuotaExceededAt: quotaHitAt ? new Date(quotaHitAt).toISOString() : null, retryTatumAt: quotaHitAt ? new Date(quotaHitAt + QUOTA_RETRY_MS).toISOString() : null, fallback: PUBLIC_GRPC })
// returns true when the error was Tatum's quota and the caller should retry (now on the fallback)
export function noteProviderError(e) {
  const text = `${e?.code} ${e?.message} ${e?.cause?.code} ${e?.cause?.message}`
  if (!QUOTA.test(text) || provider() !== 'tatum') return false
  quotaHitAt = Date.now()
  console.warn(`Tatum plan limit reached; serving Sui reads from ${PUBLIC_GRPC} until ${new Date(quotaHitAt + QUOTA_RETRY_MS).toISOString()}`)
  return true
}
let client
export function sui() {
  if (provider() === 'public-fullnode') return (publicClient ??= new SuiGrpcClient({ network: NETWORK, transport: new GrpcWebFetchTransport({ baseUrl: PUBLIC_GRPC, timeout: RPC_TIMEOUT_MS }) }).$extend(paymentKit()))
  client ??= new SuiGrpcClient({
    network: NETWORK,
    transport: new GrpcTransport({
      host: GRPC_HOST,
      channelCredentials: ChannelCredentials.createSsl(),
      meta: { 'x-api-key': process.env.TATUM_API_KEY },
      timeout: RPC_TIMEOUT_MS,
    }),
  }).$extend(paymentKit())
  return client
}

// ponytail: free plan is 3 rps per key; one global queue at ~2.5 rps keeps us under it.
let last = 0
async function throttle() {
  if (provider() !== 'tatum') return
  const wait = Math.max(0, last + 400 - Date.now())
  // a flood of queued calls must not push real payment checks past the function timeout
  if (wait > 10_000) throw new Error('Sui gateway queue is full; try again shortly')
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
      if (noteProviderError(e)) continue // Tatum credits exhausted: retry right away on the fallback
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
    // the sender rides along: payer recognition needs no second GetTransaction (one Tatum call per settlement)
    readMask: { paths: ['digest', 'effects.status', 'balance_changes', 'checkpoint', 'timestamp', 'events', 'transaction.sender'] },
  }))
  const tx = json(response.transaction)
  const ok = tx?.effects?.status?.success === true
  const received = (tx?.balanceChanges || [])
    .filter((c) => normAddr(c.address) === normAddr(payee) && isSettlementCoin(c.coinType))
    .reduce((sum, c) => sum + BigInt(c.amount), 0n)
  const ts = tx?.timestamp ? new Date(Number(tx.timestamp.seconds) * 1000).toISOString() : null
  // did this transaction go through the Sui Payment Kit (any payment_kit event)?
  const paymentKit = (tx?.events?.events || []).some((e) => /::payment_kit::/.test(e.eventType || ''))
  return { ok, received, paymentKit, digest: tx?.digest ?? null, checkpoint: tx?.checkpoint ?? null, timestamp: ts, sender: tx?.transaction?.sender || null }
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
export async function inspectSignedPayment(bytesB64, signature, payee, nonce) {
  const bytes = Buffer.from(bytesB64, 'base64')
  let sender
  try {
    sender = Transaction.from(bytes).getData().sender
  } catch {
    return { ok: false, reason: 'invalid_transaction' }
  }
  // zkLogin wallets (Slush with Google/Apple sign-in, Enoki) are checked against the current JWKs and
  // epoch through Tatum's gRPC SignatureVerificationService; Ed25519/Secp/MultiSig verify locally.
  // An invalid signature is a refusal; a lookup that could not run throws (the route answers 502).
  let signer
  try {
    if (parseSerializedSignature(signature).signatureScheme === 'ZkLogin') await throttle()
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }
  try {
    signer = (await verifyTransactionSignature(bytes, signature, { client: sui(), address: sender })).toSuiAddress()
  } catch (e) {
    if (/provided address/.test(e.message)) return { ok: false, reason: 'signer_is_not_sender' }
    if (/not valid|Unsupported|Invalid|length|parse/i.test(e.message)) return { ok: false, reason: 'invalid_signature' }
    throw e
  }
  if (!sender || normAddr(signer) !== normAddr(sender)) return { ok: false, reason: 'signer_is_not_sender' }
  await throttle()
  const r = json(await once(() => sui().core.simulateTransaction({ transaction: bytes, include: { balanceChanges: true, effects: true, events: true } })))
  const t = r?.Transaction
  if (!t || t.effects?.status?.success === false) return { ok: false, reason: 'simulation_failed', detail: r?.FailedTransaction?.effects?.status?.error || t?.effects?.status?.error || null }
  const received = (t.balanceChanges || []).filter((c) => normAddr(c.address) === normAddr(payee) && isSettlementCoin(c.coinType)).reduce((a, c) => a + BigInt(c.amount), 0n)
  // Only Payment Kit payments with this invoice as the nonce: then the chain itself rejects a second
  // payment for the invoice, even if two submissions race across instances.
  const want = Buffer.from(bcs.string().serialize(nonce).toBytes())
  const bound = (t.events || []).some((e) => e.packageId === PK_PACKAGE && /::payment_kit::PaymentReceipt$/.test(e.eventType || '') && Buffer.from(e.bcs?.data || (e.bcs && typeof e.bcs === 'object' ? Object.values(e.bcs) : [])).includes(want))
  if (!bound) return { ok: false, reason: 'payment_kit_required', detail: `pay through the Payment Kit registry with nonce ${nonce}` }
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

// Slush's universal pay link (same Payment Kit fields as sui:pay): opens the Slush app on a phone, the web app
// on desktop, so a payer without a wallet extension still gets a prefilled, nonce-protected payment.
export const slushPayUrl = ({ payee, micro, nonce, label, message }) =>
  'https://my.slush.app/pay?' + new URLSearchParams({ receiver: payee, amount: String(micro), coinType: USDC_COIN_TYPE, nonce, registry: REGISTRY_NAME, label, message })

export const paymentUri = ({ payee, micro, nonce, label, message }) =>
  createPaymentTransactionUri({ receiverAddress: payee, amount: BigInt(micro), coinType: USDC_COIN_TYPE, nonce, registryName: REGISTRY_NAME, label, message })

// Sender + SuiNS name of the wallet that paid (payer recognition).
export async function txSender(digest) {
  await throttle()
  const { response } = await once(() => sui().ledgerService.getTransaction({ digest, readMask: { paths: ['transaction.sender'] } }))
  return response.transaction?.transaction?.sender || null
}
const names = new Map() // SuiNS reverse lookups, 1 h: a repeat payer costs no gateway call
export async function suinsName(address) {
  const hit = names.get(address)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.name
  try {
    await throttle()
    const { response } = await once(() => sui().nameService.reverseLookupName({ address }))
    const name = response.record?.name || null
    names.set(address, { at: Date.now(), name })
    return name
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

// Reconciliation: the payee's newest transactions via Tatum gRPC LedgerService.ListTransactions with
// an affected_address filter (the SDK wrapper only exposes sender/moveCall, so this is the raw call).
// Returns USDC actually received per transaction. Plain transfers of an invoice's unique amount are
// found here even when no pay page was open and Payment Kit was not used.
// Scans newest-first and stops at the first transaction older than `since`, so a burst of dust
// transfers to the payee cannot push a real payment out of a fixed-size window (cap: `limit`).
export async function recentIncoming(payee, opts = {}) {
  try {
    return await scanIncoming(payee, opts)
  } catch (e) {
    if (noteProviderError(e)) return scanIncoming(payee, opts)
    throw e
  }
}
async function scanIncoming(payee, { since = null, limit = 1000 } = {}) {
  await throttle()
  const call = sui().ledgerService.listTransactions({
    readMask: { paths: ['digest', 'checkpoint', 'timestamp', 'balance_changes', 'effects.status', 'transaction.sender'] },
    filter: { terms: [{ literals: [{ negated: false, predicate: { oneofKind: 'affectedAddress', affectedAddress: { address: payee } } }] }] },
    options: { limit, ordering: 1 /* DESCENDING: newest first */ },
  })
  const out = []
  const me = normAddr(payee)
  let scanned = 0
  for await (const f of call.responses) {
    const t = f.transaction
    if (!t?.digest) continue
    scanned++
    const tsMs = t.timestamp ? Number(t.timestamp.seconds) * 1000 : null
    if (since && tsMs && tsMs < Date.parse(since) - 60_000) break // older than every open invoice
    if (t.effects?.status && t.effects.status.success === false) continue
    const received = (t.balanceChanges || []).filter((b) => normAddr(b.address) === me && normalizeStructTag(b.coinType) === normalizeStructTag(USDC_COIN_TYPE)).reduce((s, b) => s + BigInt(b.amount), 0n)
    if (received <= 0n) continue
    const ts = t.timestamp ? new Date(Number(t.timestamp.seconds) * 1000 + Math.floor((t.timestamp.nanos || 0) / 1e6)).toISOString() : null
    out.push({ digest: t.digest, checkpoint: String(t.checkpoint ?? ''), timestamp: ts, sender: t.transaction?.sender || null, received })
  }
  out.scanned = scanned
  return out
}

// ---- Native gasless USDC transfers (Sui Address Balances, mainnet since May 2026) ------------
// The protocol runs eligible stablecoin transfers at gas price 0 and budget 0: no SUI, no sponsor.
// Rules come from the live protocol config (gasless_allowed_token_types holds each coin's minimum),
// and from what the validators enforce, checked on mainnet through Tatum:
//  - funds come from the sender's address balance (coin objects are not eligible),
//  - only framework calls (balance::redeem_funds + balance::send_funds), so not Payment Kit,
//  - amount >= the minimum, and the address balance is either emptied or keeps >= the minimum,
//  - a ValidDuring expiration (there are no owned inputs to pin the transaction).
let gaslessCfg = null
export async function gaslessMin() {
  if (!gaslessCfg || Date.now() - gaslessCfg.t > 3_600_000) {
    await throttle()
    const pc = (await once(() => sui().core.getProtocolConfig())).protocolConfig
    const on = String(pc.featureFlags?.enable_gasless ?? pc.attributes?.enable_gasless) === 'true'
    let min = null
    try {
      const list = JSON.parse(pc.attributes?.gasless_allowed_token_types || '[]')
      const hit = list.find(([t]) => normalizeStructTag(t) === normalizeStructTag(USDC_COIN_TYPE))
      if (on && hit) min = BigInt(hit[1])
    } catch {}
    gaslessCfg = { t: Date.now(), min }
  }
  return gaslessCfg.min
}
export async function gaslessPlan(sender, micro) {
  const min = await gaslessMin()
  if (min == null) return { eligible: false, reason: 'gasless transfers are not enabled for USDC on this network' }
  await throttle()
  const ab = BigInt((await once(() => sui().core.getBalance({ owner: sender, coinType: USDC_COIN_TYPE }))).balance.addressBalance || 0)
  const left = ab - BigInt(micro)
  const eligible = BigInt(micro) >= min && left >= 0n && (left === 0n || left >= min)
  return { eligible, min: min.toString(), addressBalance: ab.toString(), reason: eligible ? null : BigInt(micro) < min ? `amount is below the ${fromMicro(min)} USDC gasless minimum` : left < 0n ? 'not enough USDC in the address balance' : `would leave ${fromMicro(left)} USDC (must be 0 or at least ${fromMicro(min)})` }
}
// fail closed: with no server secret there is no MAC, so gasless relaying is off (never an empty key)
const macSecret = () => process.env.MPP_SECRET_KEY || process.env.CRON_SECRET || process.env.GAS_SPONSOR_KEY || process.env.WALRUS_STORAGE_KEY || null
export const gaslessRelayEnabled = () => Boolean(macSecret())
const serverMac = (purpose, b64) => {
  const k = macSecret()
  if (!k) throw new Error('no server secret configured for signing relay bytes')
  return createHmac('sha256', `${purpose}:${k}`).update(b64).digest('hex')
}
export async function buildGaslessUsdcTransfer(sender, payee, micro, invoiceId) {
  await throttle()
  const [{ systemState }, { chainIdentifier }] = await Promise.all([once(() => sui().core.getCurrentSystemState()), once(() => sui().core.getChainIdentifier())])
  const tx = new Transaction()
  tx.setSender(sender)
  const [funds] = tx.moveCall({ target: '0x2::balance::redeem_funds', typeArguments: [USDC_COIN_TYPE], arguments: [tx.withdrawal({ amount: BigInt(micro), type: USDC_COIN_TYPE })] })
  tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [USDC_COIN_TYPE], arguments: [funds, tx.pure.address(payee)] })
  tx.setGasPrice(0)
  tx.setGasBudget(0)
  tx.setGasPayment([])
  tx.setExpiration({ ValidDuring: { minEpoch: String(systemState.epoch), maxEpoch: String(BigInt(systemState.epoch) + 1n), minTimestamp: null, maxTimestamp: null, chain: chainIdentifier, nonce: randomInt(2 ** 32) } })
  await throttle()
  const raw = await once(() => tx.build({ client: sui() }))
  const b64 = Buffer.from(raw).toString('base64')
  // the digest is fixed by the bytes, so the route can reserve it for this invoice before signing
  return { bytes: b64, digest: await Transaction.from(raw).getDigest(), mac: serverMac(`gasless:${invoiceId}`, b64) }
}
// only bytes this server built for THIS invoice are relayed (not a free relay, not re-targetable)
export const gaslessMacOk = (b64, mac, invoiceId) => gaslessRelayEnabled() && typeof mac === 'string' && /^[0-9a-f]{64}$/.test(mac) && timingSafeEqual(Buffer.from(mac), Buffer.from(serverMac(`gasless:${invoiceId}`, b64)))
