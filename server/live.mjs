// Real-time payment detection: one Tatum gRPC SubscribeCheckpoints stream per instance, shared by
// every open pay page. Each checkpoint's balance changes are matched against the watched
// (payee, exact micro-amount) pairs; a hit hands the digest to the normal verify/settle path.
import * as sui from './sui.mjs'

const watchers = new Set()
let call = null
export let lastSeq = null

const MAX_WATCHERS = 50 // ponytail: per-instance cap; shard by payee if pay-page traffic ever grows

export function watch(payee, micro, onHit, onCheckpoint) {
  if (watchers.size >= MAX_WATCHERS) throw new Error('too many live watchers on this instance')
  const w = { payee: sui.normAddr(payee), micro: BigInt(micro), onHit, onCheckpoint, hit: false }
  watchers.add(w)
  start()
  return () => {
    watchers.delete(w)
    if (!watchers.size && call) {
      call.abort?.()
      call = null
    }
  }
}

function start() {
  if (call) return
  const ctl = new AbortController()
  const c = sui.sui().subscriptionService.subscribeCheckpoints(
    { readMask: { paths: ['sequence_number', 'transactions.digest', 'transactions.balance_changes'] } },
    { abort: ctl.signal },
  )
  call = { abort: () => ctl.abort() }
  ;(async () => {
    try {
      for await (const m of c.responses) {
        const cp = m.checkpoint
        lastSeq = String(cp?.sequenceNumber ?? m.cursor ?? '')
        for (const w of watchers) w.onCheckpoint?.(lastSeq)
        for (const [w, digest] of matches(cp, watchers, sui.USDC_COIN_TYPE)) {
          w.hit = true
          w.onHit(digest, lastSeq)
        }
      }
    } catch (e) {
      if (!ctl.signal.aborted) for (const w of watchers) w.onCheckpoint?.(null, String(e?.message || e))
    } finally {
      // stream ended on its own (gateway timeout): reconnect if anyone is still watching
      if (call && !ctl.signal.aborted) {
        call = null
        if (watchers.size) setTimeout(start, 1000)
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
      if (b.coinType !== coinType) continue
      const addr = sui.normAddr(b.address)
      const amt = BigInt(b.amount)
      for (const w of ws) if (!w.hit && w.payee === addr && w.micro === amt && !out.some(([x]) => x === w)) out.push([w, tx.digest])
    }
  return out
}
