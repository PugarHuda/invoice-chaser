// Walrus Memory is the system of record. Every event is one memory:
//   "<human sentence>\n#ic {json tag}"
// On boot we recall every ic:main:* namespace and rebuild all state from it.
import { MemWal } from '@mysten-incubation/memwal'

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
  pump()
  return m
}

const queue = []
let pumping = false
async function pump() {
  if (pumping) return
  pumping = true
  try {
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
        // ponytail: one serial queue with a fixed 30 s backoff; parallelise if write volume ever matters
        m.status = 'failed'
        m.error = String(e?.message || e)
        await new Promise((r) => setTimeout(r, 30_000))
        m.status = 'pending'
      }
    }
  } finally {
    pumping = false
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
export async function loadAll({ wipe = false } = {}) {
  if (loadState.loading) return loadState
  loadState.loading = true
  loadState.error = null
  try {
    const nss = await namespaces()
    const fresh = new Map()
    let n = 0
    for (const ns of nss) {
      // ponytail: recall caps at 100 per namespace; one namespace per client keeps us far below that
      const r = await memwal().recall({ query: 'invoice payment reminder client preference', namespace: ns.name, limit: 100, sort: 'recent' })
      const mems = []
      for (const hit of r.results) {
        const d = decode(hit.text)
        if (!d) continue
        mems.push({ id: hit.blob_id, blobId: hit.blob_id, sentence: d.sentence, tag: d.tag, timestamp: d.tag.at || hit.created_at, status: 'saved' })
      }
      mems.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      fresh.set(ns.name, mems)
      n += mems.length
    }
    // keep anything still waiting to be written so a reload never loses it
    for (const [ns, mems] of store) {
      const unsaved = wipe ? [] : mems.filter((m) => m.status !== 'saved')
      if (unsaved.length) fresh.set(ns, [...unsaved, ...(fresh.get(ns) || [])])
    }
    store.clear()
    for (const [k, v] of fresh) store.set(k, v)
    Object.assign(loadState, { loaded: true, loadedAt: new Date().toISOString(), recalled: n, namespaces: nss.length })
  } catch (e) {
    loadState.error = String(e?.message || e)
  } finally {
    loadState.loading = false
  }
  return loadState
}

export async function health() {
  const t = Date.now()
  const h = await memwal().health()
  return { status: h.status, writes: h.writes, latencyMs: Date.now() - t }
}

export async function namespaceCounts() {
  return (await namespaces()).map((n) => ({ namespace: n.name, count: n.memory_count, updatedAt: n.updated_at }))
}
