// Walrus Memory is the system of record. Every event is one memory:
//   "<human sentence>\n#ic {json tag}"
// On boot we recall every ic:main:* namespace and rebuild all state from it.
import { MemWal } from '@mysten-incubation/memwal'
import { waitUntil } from '@vercel/functions'
import { createHmac, timingSafeEqual } from 'node:crypto'

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

// Ledger tags are signed: the relayer also stores free text (analyze() facts from pasted notes), so a tag
// is trusted only if this server made it. Memories the relayer created before TAG_MAC_FROM predate signing
// and are accepted as written (Walrus is append-only; a client cannot set the relayer's created_at).
export const TAG_MAC_FROM = '2026-11-05T19:00:00Z'
const tagMac = (sentence, tag) => createHmac('sha256', `ic-tag:${process.env.MEMWAL_PRIVATE_KEY || ''}`).update(`${sentence}\n${JSON.stringify(tag)}`).digest('hex').slice(0, 32)
export const encode = (sentence, tag) => `${sentence}\n#ic ${JSON.stringify({ ...tag, mac: tagMac(sentence, tag) })}`
/** createdAt: the relayer's timestamp for this memory (absent for local, not-yet-saved ones) */
const MARK = '\n#ic '
export function decode(text, createdAt) {
  // the tag marker is newline + '#ic ': JSON.stringify never emits a raw newline, so free text inside a
  // tag value (a client name, a description) can't move the split point
  const i = text.lastIndexOf(MARK)
  if (i < 0) return null
  try {
    const sentence = text.slice(0, i).trim()
    const { mac, ...tag } = JSON.parse(text.slice(i + 5))
    if (mac !== undefined) {
      const want = tagMac(sentence, tag)
      return typeof mac === 'string' && mac.length === want.length && timingSafeEqual(Buffer.from(mac), Buffer.from(want)) ? { sentence, tag } : null
    }
    // an unsigned tag is only legacy if the relayer stored it before signing began
    const at = createdAt ? new Date(createdAt) : null
    // fail closed: unsigned is accepted only with a parseable relayer timestamp strictly before signing began
    return at && !Number.isNaN(at.getTime()) && at.toISOString() < TAG_MAC_FROM ? { sentence, tag } : null
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
  if (!loading && Date.now() - Date.parse(loadState.loadedAt) > STALE_MS) waitUntil(refresh())
}

// Incremental sync (MemWal listMemories watermark): a stale instance asks the relayer what changed
// since its cursor and re-recalls only those namespaces; nothing changed = no recall at all.
let listCursor = null
async function walkChanges(cursor) {
  const changed = new Set()
  let page
  let guard = 0
  do {
    page = await memwal().listMemories({ cursor: cursor || undefined, limit: 500 })
    if (page.must_resync) return { resync: true }
    for (const m of page.memories) changed.add(m.namespace_id)
    for (const d of page.deleted || []) changed.add(d.namespace_id)
    cursor = page.next_cursor || cursor
  } while (page.has_more && ++guard < 20)
  return { changed, cursor }
}
export function refresh() {
  loading ??= (async () => {
    if (!listCursor) return doLoad()
    const w = await walkChanges(listCursor).catch(() => ({ resync: true }))
    if (w.resync) return doLoad()
    if (!w.changed.size) {
      listCursor = w.cursor // nothing changed: safe to advance
      Object.assign(loadState, { loadedAt: new Date().toISOString(), lastSync: { mode: 'incremental', changedNamespaces: 0 } })
      return loadState
    }
    // the watermark advances only once the changed namespaces actually reloaded (doLoad commits it)
    return doLoad([...w.changed], w.cursor)
  })().finally(() => (loading = null))
  return loading
}
async function doLoad(only = null, nextCursor = null) {
  loadState.loading = true
  loadState.error = null
  try {
    // full load: take the watermark first, so anything written during the recall shows up next poll
    const wm = only ? nextCursor : (await walkChanges(null).catch(() => ({}))).cursor || null
    const nss = (await namespaces()).filter((ns) => !only || only.includes(ns.name))
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
        const d = decode(hit.text, hit.created_at) || { sentence: hit.text.trim(), tag: { type: 'note', source: 'walrus-analyze' } }
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
    const dropped = recalled.reduce((s, r) => s + (r?.dropped_count || 0), 0) // blobs the relayer couldn't decrypt/download
    if (!only) store.clear()
    for (const [k, v] of fresh) store.set(k, v)
    // a partial reload keeps the other namespaces' truncation state; a full one replaces it
    const keepTrunc = only ? (loadState.truncated || []).filter((ns) => !only.includes(ns)) : []
    listCursor = wm // committed only after store + loadState are updated
    Object.assign(loadState, { truncated: [...keepTrunc, ...truncated], loaded: true, loadedAt: new Date().toISOString(), recalled: only ? loadState.recalled : n, namespaces: only ? loadState.namespaces : nss.length, lastSync: { mode: only ? 'incremental' : 'full', changedNamespaces: nss.length, dropped } })
  } catch (e) {
    loadState.error = String(e?.message || e)
    listCursor = null // a failed (partial) reload forces a full resync next time
  } finally {
    loadState.loading = false
  }
  return loadState
}

// analyze(): the relayer extracts facts from free text and stores each as a memory in `ns`.
export async function ingestNotes(ns, text) {
  // facts are stored as raw text: decode() only trusts signed tags, and no '#' even reaches the extractor
  const r = await memwal().analyze(text.replace(/#/g, '＃'), ns)
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
    // the relayer says when a page was known-incomplete (truncated): keep restoring, bounded
    for (let pass = 0; pass < 5; pass++) {
      const r = await memwal().restore(ns.name, Math.min(100, Math.max(1, ns.memory_count)))
      sum.restored += r.restored
      sum.skipped += r.skipped
      sum.failed += r.failed
      if (!r.truncated) break
    }
  }
  return sum
}

// Semantic search over one client's memories (Walrus recall: embeddings + cosine distance).
// mode: 'relevance' = cosine order; 'recent' = newest among the matches (relayer over-fetches, then
// orders by write time); 'weighted' = semantic blended with recency (30-day half-life) by the ranker.
export const SEARCH_MODES = {
  relevance: { sort: 'relevance' },
  recent: { sort: 'recent' },
  weighted: { scoringWeights: { semantic: 1, recency: 0.6, recencyHalfLifeDays: 30 } },
}
export async function search(clientId, query, limit = 5, mode = 'relevance') {
  const opts = SEARCH_MODES[mode] || SEARCH_MODES.relevance
  const shards = clientShards(clientId)
  const results = (await Promise.all((shards.length ? shards : [clientNs(clientId)]).map((namespace) => memwal().recall({ query, namespace, limit, ...opts }))))
    .flatMap((r) => r.results)
  // across shards: keep the relayer's order rule (newest first for 'recent', closest first otherwise)
  const hits = results.sort((a, b) => (mode === 'recent' ? String(b.created_at).localeCompare(String(a.created_at)) : a.distance - b.distance)).slice(0, limit)
  return hits.map((h) => {
    const d = decode(h.text, h.created_at) || { sentence: h.text.trim(), tag: { type: 'note' } }
    return { sentence: d.sentence, type: d.tag?.type, distance: Math.round(h.distance * 1000) / 1000, blobId: h.blob_id, at: d.tag?.at || h.created_at }
  })
}

// Context for the reminder drafter: a fresh recall over the client's Walrus memories under a token
// budget (the SDK trims with 'high-relevance-only' and reports its estimate), far hits dropped.
export async function contextFor(clientId, query, maxTokens = 400) {
  const shards = clientShards(clientId)
  const rs = await Promise.all((shards.length ? shards : [clientNs(clientId)]).map((namespace) =>
    memwal().recall({ query, namespace, limit: 8, maxDistance: 0.8, maxTokens, truncationStrategy: 'high-relevance-only' })))
  const hits = rs.flatMap((r) => r.results).sort((a, b) => a.distance - b.distance)
  return {
    sentences: hits.map((h) => (decode(h.text, h.created_at) || { sentence: h.text.trim() }).sentence),
    hits: hits.length,
    tokenEstimate: rs.reduce((s, r) => s + (r.meta?.tokenEstimate || 0), 0),
    truncated: rs.some((r) => r.meta?.truncated),
    dropped: rs.reduce((s, r) => s + (r.dropped_count || 0), 0),
  }
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
