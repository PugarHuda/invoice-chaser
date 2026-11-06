// Real-time payment detection: one Tatum gRPC SubscribeCheckpoints stream per instance, shared by
// every open pay page. Each checkpoint's balance changes are matched against the watched
// (payee, exact micro-amount) pairs; a hit hands the digest to the normal verify/settle path.
import * as sui from './sui.mjs'
import { normalizeStructTag } from '@mysten/sui/utils'
const norm = (t) => { try { return normalizeStructTag(t) } catch { return t } }

const watchers = new Set()
let call = null
export let lastSeq = null

const MAX_WATCHERS = 50 // ponytail: per-instance cap; shard by payee if pay-page traffic ever grows

// micro: one amount or a list (an invoice may still be payable at an amount quoted before its terms changed)
export function watch(payee, micro, onHit, onCheckpoint) {
  if (watchers.size >= MAX_WATCHERS) throw new Error('too many live watchers on this instance')
  const w = { payee: sui.normAddr(payee), micro: new Set([].concat(micro).map(BigInt)), onHit, onCheckpoint, hit: false }
  watchers.add(w)
  // the stream is filtered to the payees being watched: a new payee needs a fresh subscription
  if (call && !call.payees.has(w.payee)) { call.abort?.(); call = null }
  start()
  return () => {
    watchers.delete(w)
    if (!watchers.size && call) {
      call.abort?.()
      call = null
    }
  }
}

let fails = 0
function start() {
  if (call) return
  const ctl = new AbortController()
  const payees = new Set([...watchers].map((w) => w.payee))
  // Server-side filter (TransactionFilter, DNF: one OR-term per payee): Tatum sends only checkpoints that
  // touch a watched payee plus cursor-only progress frames, ~12x fewer messages than the full firehose.
  const filter = { terms: [...payees].map((address) => ({ literals: [{ negated: false, predicate: { oneofKind: 'affectedAddress', affectedAddress: { address } } }] })) }
  const c = sui.sui().subscriptionService.subscribeCheckpoints(
    { readMask: { paths: ['sequence_number', 'transactions.digest', 'transactions.balance_changes'] }, filter },
    // a stream is long-lived: override the transport's per-call deadline
    { abort: ctl.signal, timeout: 3_600_000 },
  )
  call = { abort: () => ctl.abort(), payees }
  ;(async () => {
    try {
      for await (const m of c.responses) {
        fails = 0
        const cp = m.checkpoint
        lastSeq = String(cp?.sequenceNumber ?? m.cursor ?? '')
        for (const w of watchers) w.onCheckpoint?.(lastSeq)
        for (const [w, digest] of matches(cp, watchers, sui.USDC_COIN_TYPE)) {
          w.hit = true
          w.onHit(digest, lastSeq)
        }
      }
    } catch (e) {
      // Tatum credits exhausted: the reconnect below goes to the public fullnode, watchers see no error
      if (sui.noteProviderError(e)) return
      if (!ctl.signal.aborted) for (const w of watchers) w.onCheckpoint?.(null, String(e?.message || e))
    } finally {
      // stream ended on its own (gateway timeout): reconnect if anyone is still watching
      if (call && !ctl.signal.aborted) {
        call = null
        // back off on a persistent error instead of reconnecting every second
        if (watchers.size) setTimeout(start, Math.min(30_000, 1000 * 2 ** fails++))
      }
    }
  })()
}

export const watcherCount = () => watchers.size

// Pure: which watchers does this checkpoint pay? Exact amount to the exact payee, in the settlement coin.
export function matches(cp, ws, coinType) {
  const out = []
  for (const tx of cp?.transactions || [])
    for (const b of tx.balanceChanges || []) {
      if (norm(b.coinType) !== norm(coinType)) continue
      const addr = sui.normAddr(b.address)
      const amt = BigInt(b.amount)
      for (const w of ws) if (!w.hit && w.payee === addr && (w.micro instanceof Set ? w.micro.has(amt) : w.micro === amt) && !out.some(([x]) => x === w)) out.push([w, tx.digest])
    }
  return out
}
