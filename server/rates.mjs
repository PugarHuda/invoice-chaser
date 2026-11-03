// Live USD rates from Tatum's Data API (exchange rate endpoint), cached for a minute.
import { tatumFetch } from './tatum-client.mjs'

const cache = new Map()
export async function usdRate(symbol) {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const r = await tatumFetch(`/v4/data/rate/symbol?symbol=${encodeURIComponent(symbol)}&basePair=USD`)
  if (!r.ok) throw new Error(`Tatum rate ${symbol}: HTTP ${r.status}`)
  const j = await r.json()
  const value = { usd: Number(j.value), source: j.source, at: new Date(j.timestamp).toISOString() }
  cache.set(symbol, { at: Date.now(), value })
  return value
}
