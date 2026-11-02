// Walrus Memory is the system of record. Every event is one memory:
//   "<human sentence>\n#ic {json tag}"
// On boot we recall every ic:main:* namespace and rebuild all state from it.
import { MemWal } from '@mysten-incubation/memwal'
import { waitUntil } from '@vercel/functions'

export const NS_PREFIX = process.env.MEMWAL_NS_PREFIX || 'ic:main:'
export const clientNs = (clientId) => `${NS_PREFIX}client:${clientId}`
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
export async function ready() {
  if (!loadState.loaded) await loadAll()
}
async function doLoad() {
  loadState.loading = true
  loadState.error = null
  try {
    const nss = await namespaces()
    const fresh = new Map()
    const truncated = []
    let n = 0
    for (const ns of nss) {
      // ponytail: recall caps at 100 per namespace; one namespace per client keeps us far below that
      const r = await memwal().recall({ query: 'invoice payment reminder client preference', namespace: ns.name, limit: 100, sort: 'recent' })
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
    // keep anything still waiting to be written so a reload (even a wipe) never loses it
    for (const [ns, mems] of store) {
      const unsaved = mems.filter((m) => m.status !== 'saved')
      if (unsaved.length) fresh.set(ns, [...unsaved, ...(fresh.get(ns) || [])])
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
  const r = await memwal().analyze(text, ns)
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

export async function health() {
  const t = Date.now()
  const h = await memwal().health()
  return { status: h.status, writes: h.writes, latencyMs: Date.now() - t }
}

export async function namespaceCounts() {
  return (await namespaces()).map((n) => ({ namespace: n.name, count: n.memory_count, updatedAt: n.updated_at }))
}
