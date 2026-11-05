// Walrus Memory is the system of record. Every event is one memory:
//   "<human sentence>\n#ic {json tag}"
// On boot we recall every ic:main:* namespace and rebuild all state from it.
import { MemWal } from '@mysten-incubation/memwal'
import { waitUntil } from '@vercel/functions'

export const NS_PREFIX = process.env.MEMWAL_NS_PREFIX || 'ic:main:'
export const clientNs = (clientId) => `${NS_PREFIX}client:${clientId}`
// recall() returns at most 100 memories per namespace, so a long-lived client is sharded:
// ic:main:client:c1, ic:main:client:c1/1, /2 ... Writes go to the newest shard until it holds
// SHARD_MAX, and every read unions all shards. Total recall survives any amount of history.
// ponytail: two instances can both write the last slots of a shard; SHARD_MAX leaves 10 of headroom.
export const SHARD_MAX = Number(process.env.MEMWAL_SHARD_MAX) || 90
const shardOf = (ns, base) => (ns === base ? 0 : ns.startsWith(`${base}/`) && /^\d+$/.test(ns.slice(base.length + 1)) ? Number(ns.slice(base.length + 1)) : -1)
export function clientShards(clientId) {
  const base = clientNs(clientId)
  return [...store.keys()].map((ns) => [ns, shardOf(ns, base)]).filter(([, k]) => k >= 0).sort((a, b) => a[1] - b[1]).map(([ns]) => ns)
}
export function writeNs(clientId, need = 1) {
  const base = clientNs(clientId)
  const shards = clientShards(clientId)
  const last = shards.at(-1) || base
  const k = shardOf(last, base)
  return (store.get(last)?.length || 0) + need > SHARD_MAX ? `${base}/${k + 1}` : last
}
export const clientMemories = (clientId) => clientShards(clientId).flatMap((ns) => store.get(ns)).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
export const RELAYER = process.env.MEMWAL_SERVER_URL || 'https://relayer.memory.walrus.xyz'

let mw
function memwal() {
  if (!process.env.MEMWAL_PRIVATE_KEY || !process.env.MEMWAL_ACCOUNT_ID) throw new Error('MEMWAL_* env is not set')
  mw ??= MemWal.create({
    key: process.env.MEMWAL_PRIVATE_KEY,
    accountId: process.env.MEMWAL_ACCOUNT_ID,
    serverUrl: RELAYER,
  })
  return mw
}

/** @type {Map<string, Array<{id:string,sentence:string,tag:any,timestamp:string,status:'pending'|'saved'|'failed',blobId?:string,error?:string}>>} */
export const store = new Map()
export const loadState = { loaded: false, loading: false, error: null, loadedAt: null, recalled: 0 }

export const encode = (sentence, tag) => `${sentence}\n#ic ${JSON.stringify(tag)}`
export function decode(text) {
  const i = text.lastIndexOf('#ic ')
  if (i < 0) return null
  try {
    return { sentence: text.slice(0, i).trim(), tag: JSON.parse(text.slice(i + 4)) }
  } catch {
    return null
  }
}

let seq = 0
// Add to local state immediately, write to Walrus in the background. Never claims "saved" before the relayer confirms.
export function remember(ns, sentence, tag) {
  const timestamp = tag.at || new Date().toISOString()
  const m = { id: `m-${Date.now()}-${seq++}`, sentence, tag: { v: 1, ...tag, at: timestamp }, timestamp, status: 'pending' }
  if (!store.has(ns)) store.set(ns, [])
  store.get(ns).unshift(m)
  queue.push({ ns, m })
  // On Vercel, keep the instance alive until the queue drains (no-op elsewhere).
  waitUntil(pump())
  return m
}

const queue = []
let pumping = null
function pump() {
  pumping ??= drain().finally(() => (pumping = null))
  return pumping
}
async function drain() {
  while (queue.length) {
      const { ns, m } = queue[0]
      try {
        const job = await memwal().remember(encode(m.sentence, m.tag), ns, { idempotencyKey: m.id })
        const done = await memwal().waitForRememberJob(job.job_id)
        m.blobId = done?.blob_id || job.blob_id
        m.status = 'saved'
        delete m.error
        queue.shift()
      } catch (e) {
        // ponytail: one serial queue with a fixed backoff; parallelise if write volume ever matters
        m.status = 'failed'
        m.attempts ??= 0
        m.error = String(e?.message || e)
        // after 5 tries leave it visibly failed rather than retrying past the function's lifetime
        if (++m.attempts >= 5) queue.shift()
        else {
          await new Promise((r) => setTimeout(r, 15_000))
          m.status = 'pending'
        }
      }
  }
}
export const pendingCount = () => queue.length

async function namespaces() {
  const out = []
  let cursor
  do {
    const page = await memwal().listNamespaces(cursor ? { cursor } : undefined)
    out.push(...page.namespaces)
    cursor = page.has_more ? page.next_cursor : undefined
  } while (cursor)
  return out.filter((n) => n.name.startsWith(NS_PREFIX))
}

// Total Recall: wipe local state and rebuild purely from Walrus Memory.
// Concurrent callers share one in-flight load instead of reading half-built state.
let loading = null
export function loadAll() {
  loading ??= doLoad().finally(() => (loading = null))
  return loading
}
// Serverless instances don't see each other's writes; re-sync from Walrus in the background when
// local state is older than 2 minutes (unsaved local memories are always kept across reloads).
const STALE_MS = 120_000
export async function ready() {
  if (!loadState.loaded) return loadAll()
  if (!loading && Date.now() - Date.parse(loadState.loadedAt) > STALE_MS) waitUntil(loadAll())
}
async function doLoad() {
  loadState.loading = true
  loadState.error = null
  try {
    const nss = await namespaces()
    const fresh = new Map()
    const truncated = []
    let n = 0
    // recall every namespace with up to 4 in flight (sequential recalls made a cold start ~1 s per client)
    const RECALL_CONCURRENCY = 4
    const recalled = new Array(nss.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(RECALL_CONCURRENCY, nss.length) }, async () => {
      while (next < nss.length) {
        const k = next++
        recalled[k] = await memwal().recall({ query: 'invoice payment reminder client preference', namespace: nss[k].name, limit: 100, sort: 'recent' })
      }
    }))
    for (const [k, ns] of nss.entries()) {
      // shards keep every namespace at or under SHARD_MAX, inside recall's 100-result cap
      const r = recalled[k]
      if (ns.memory_count > r.results.length) truncated.push(ns.name) // fail closed: payments refuse to settle
      const mems = []
      for (const hit of r.results) {
        // memories without our tag are facts extracted by analyze(): keep them as notes
        const d = decode(hit.text) || { sentence: hit.text.trim(), tag: { type: 'note', source: 'walrus-analyze' } }
        mems.push({ id: hit.blob_id, blobId: hit.blob_id, sentence: d.sentence, tag: d.tag, timestamp: d.tag.at || hit.created_at, status: 'saved' })
      }
      mems.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      fresh.set(ns.name, mems)
      n += mems.length
    }
    // Merge, never drop: keep every local memory the recall didn't return yet (still being written,
    // or saved but not indexed by the relayer). Otherwise a reload could "un-pay" an invoice.
    // a local copy and its recalled twin share content (sentence + type + timestamp), not ids
    const contentKey = (m) => `${m.tag?.type}|${m.tag?.at || m.timestamp}|${m.sentence}`
    const seen = new Set([...fresh.values()].flat().flatMap((m) => [m.blobId, contentKey(m)]))
    for (const [ns, mems] of store) {
      const missing = mems.filter((m) => !(m.blobId && seen.has(m.blobId)) && !seen.has(contentKey(m)))
      if (missing.length) fresh.set(ns, [...missing, ...(fresh.get(ns) || [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
    }
    store.clear()
    for (const [k, v] of fresh) store.set(k, v)
    Object.assign(loadState, { truncated, loaded: true, loadedAt: new Date().toISOString(), recalled: n, namespaces: nss.length })
  } catch (e) {
    loadState.error = String(e?.message || e)
  } finally {
    loadState.loading = false
  }
  return loadState
}

// analyze(): the relayer extracts facts from free text and stores each as a memory in `ns`.
export async function ingestNotes(ns, text) {
  // facts are stored as raw text and decode() trusts a trailing "#ic {json}" tag: a pasted note must never forge one
  const r = await memwal().analyze(text.replace(/#ic/gi, 'ic'), ns)
  if (!store.has(ns)) store.set(ns, [])
  const at = new Date().toISOString()
  const local = r.facts.map((f) => ({ id: f.id, sentence: f.text, tag: { type: 'note', source: 'walrus-analyze', at }, timestamp: at, status: 'pending' }))
  store.get(ns).unshift(...local)
  // flip to saved (with blob ids) once the relayer finishes; keep the instance alive on Vercel
  waitUntil(
    memwal()
      .waitForRememberJobs(r.job_ids, r.job_ids.map(() => ns))
      .then((done) => (done.results || []).forEach((x, i) => Object.assign(local[i], x.status === 'done' ? { status: 'saved', blobId: x.blob_id } : { status: 'failed', error: x.error })))
      .catch((e) => local.forEach((m) => Object.assign(m, { status: 'failed', error: String(e?.message || e) }))),
  )
  return r.facts.map((f) => f.text)
}

// restore(): ask the relayer to re-index blobs it holds for each namespace (idempotent).
export async function restoreAll() {
  const sum = { restored: 0, skipped: 0, failed: 0 }
  for (const ns of await namespaces()) {
    const r = await memwal().restore(ns.name, Math.min(100, Math.max(1, ns.memory_count)))
    sum.restored += r.restored
    sum.skipped += r.skipped
    sum.failed += r.failed
  }
  return sum
}

// Semantic search over one client's memories (Walrus recall: embeddings + cosine distance).
export async function search(clientId, query, limit = 5) {
  const shards = clientShards(clientId)
  const hits = (await Promise.all((shards.length ? shards : [clientNs(clientId)]).map((namespace) => memwal().recall({ query, namespace, limit }))))
    .flatMap((r) => r.results).sort((a, b) => a.distance - b.distance).slice(0, limit)
  return hits.map((h) => {
    const d = decode(h.text) || { sentence: h.text.trim(), tag: { type: 'note' } }
    return { sentence: d.sentence, type: d.tag?.type, distance: Math.round(h.distance * 1000) / 1000, blobId: h.blob_id, at: d.tag?.at || h.created_at }
  })
}

export async function health() {
  const t = Date.now()
  const h = await memwal().health()
  return { status: h.status, writes: h.writes, latencyMs: Date.now() - t }
}

export async function namespaceCounts() {
  return (await namespaces()).map((n) => ({ namespace: n.name, count: n.memory_count, updatedAt: n.updated_at }))
}

// Durability audit: is everything we remember still held, and for how long?
// listMemories walks the relayer's full inventory (metadata only, no recall cap); then a few of
// the newest blobs are fetched straight from a Walrus aggregator, so the check does not rely on
// the relayer alone. Cached briefly: it walks every page of the account.
const AGGREGATOR = process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-mainnet.walrus.space'
const SPOT = 3
let audit = null
// concurrent /proof requests share one in-flight audit; a failed audit is not cached
export function durability() {
  if (!audit || Date.now() - audit.t > 60_000) audit = { t: Date.now(), v: runAudit().catch((e) => ((audit = null), Promise.reject(e))) }
  return audit.v
}
async function runAudit() {
  const inv = []
  let cursor
  for (let more = true; more; ) {
    const p = await memwal().listMemories({ cursor, limit: 500 })
    inv.push(...p.memories.filter((m) => m.namespace_id.startsWith(NS_PREFIX)))
    cursor = p.next_cursor ?? undefined
    more = p.has_more && Boolean(cursor)
  }
  const held = new Set(inv.map((m) => m.blob_id))
  const local = [...store.values()].flat()
  // saved locally (relayer confirmed) but absent from the inventory: lost or not yet indexed
  const missing = local.filter((m) => m.status === 'saved' && m.blobId && !held.has(m.blobId)).map((m) => ({ blobId: m.blobId, sentence: m.sentence.slice(0, 120) }))
  const expiries = inv.map((m) => m.expires_at).filter(Boolean).sort()
  const epochs = inv.map((m) => m.end_epoch).filter((e) => e != null)
  const newest = [...inv].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, SPOT)
  const spot = await Promise.all(newest.map(async (m) => {
    const t = Date.now()
    const r = await fetch(`${AGGREGATOR}/v1/blobs/${m.blob_id}`, { method: 'HEAD', signal: AbortSignal.timeout(8000) }).catch(() => null)
    return { blobId: m.blob_id, onWalrus: r?.ok ?? false, bytes: Number(r?.headers.get('content-length')) || null, ms: Date.now() - t }
  }))
  const earliest = expiries[0] || null
  const v = {
    inventory: inv.length,
    active: inv.filter((m) => m.status === 'active').length,
    loadedLocally: local.filter((m) => m.status === 'saved').length,
    missingFromInventory: missing,
    earliestExpiry: earliest,
    daysToEarliestExpiry: earliest ? Math.floor((Date.parse(earliest) - Date.now()) / 86_400_000) : null,
    endEpochRange: epochs.length ? [Math.min(...epochs), Math.max(...epochs)] : null,
    aggregator: AGGREGATOR,
    spotCheck: spot,
    ok: missing.length === 0 && spot.every((s) => s.onWalrus),
    checkedAt: new Date().toISOString(),
  }
  return v
}
