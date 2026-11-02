// Sui Mainnet reads through Tatum's native gRPC gateway (JSON-RPC is deprecated on Sui).
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { ChannelCredentials } from '@grpc/grpc-js'

export const GRPC_HOST = 'sui-mainnet-grpc.gateway.tatum.io:443'
export const USDC_COIN_TYPE =
  process.env.USDC_COIN_TYPE || '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
export const USDC_DECIMALS = 6

let client
function sui() {
  if (!process.env.TATUM_API_KEY) throw new Error('TATUM_API_KEY is not set')
  client ??= new SuiGrpcClient({
    network: 'mainnet',
    transport: new GrpcTransport({
      host: GRPC_HOST,
      channelCredentials: ChannelCredentials.createSsl(),
      meta: { 'x-api-key': process.env.TATUM_API_KEY },
    }),
  })
  return client
}

// ponytail: free plan is 3 rps per key; one global queue at ~2.5 rps keeps us under it.
let last = 0
async function throttle() {
  const wait = Math.max(0, last + 400 - Date.now())
  last = Date.now() + wait
  if (wait) await new Promise((r) => setTimeout(r, wait))
}

// Idle gRPC channels get reset by the gateway; retry once on a fresh channel.
async function once(fn) {
  try {
    return await fn()
  } catch (e) {
    if (!/ECONNRESET|UNAVAILABLE|GOAWAY|socket hang up/i.test(`${e?.code} ${e?.message}`)) throw e
    client = undefined
    await throttle()
    return fn()
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
    readMask: { paths: ['digest', 'effects.status', 'balance_changes', 'checkpoint', 'timestamp'] },
  }))
  const tx = json(response.transaction)
  const ok = tx?.effects?.status?.success === true
  const received = (tx?.balanceChanges || [])
    .filter((c) => normAddr(c.address) === normAddr(payee) && c.coinType === USDC_COIN_TYPE)
    .reduce((sum, c) => sum + BigInt(c.amount), 0n)
  const ts = tx?.timestamp ? new Date(Number(tx.timestamp.seconds) * 1000).toISOString() : null
  return { ok, received, checkpoint: tx?.checkpoint ?? null, timestamp: ts }
}

const normAddr = (a) => (a || '').toLowerCase().replace(/^0x0*/, '0x')

export const toMicro = (usdc) => {
  const [i, f = ''] = String(usdc).split('.')
  return BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6))
}
export const fromMicro = (m) => {
  const s = BigInt(m).toString().padStart(7, '0')
  return `${s.slice(0, -6)}.${s.slice(-6)}`
}
