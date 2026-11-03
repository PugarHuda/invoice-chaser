// Payer screening with Tatum's Malicious Address API (GET /v3/security/address/{address}).
// "clean" means "not in Tatum's third-party scam feeds": absence of evidence, not proof.
import { tatumFetch } from './tatum-client.mjs'

const cache = new Map()
export async function screenAddress(address) {
  const hit = cache.get(address)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value
  const r = await tatumFetch(`/v3/security/address/${encodeURIComponent(address)}`)
  if (!r.ok) throw new Error(`Tatum security ${r.status}`)
  const j = await r.json()
  const value = { verdict: j.status === 'valid' ? 'clean' : 'flagged', raw: j.status, source: 'Tatum Malicious Address API' }
  cache.set(address, { at: Date.now(), value })
  return value
}
