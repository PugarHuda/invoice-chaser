import { Router } from 'express'
import { tatumApiBase } from '../tatum-client.mjs'

const router = Router()

// Health check — a present key says nothing about egress, so make a real request.
router.get('/status', async (_req, res) => {
  if (!process.env.TATUM_API_KEY) return res.json({ status: 'no-api-key' })
  try {
    // Any HTTP response proves the request left the pod; the status code doesn't matter.
    await fetch(tatumApiBase(), { signal: AbortSignal.timeout(8000) })
    res.json({ status: 'connected' })
  } catch (error) {
    res.json({ status: 'egress-failed', error: error.message })
  }
})

// Add Tatum routes here. tatumFetch for the REST / Data API, tatumRpc for a chain's
// JSON-RPC gateway; both add the x-api-key header and pick the right host. Never
// write api.tatum.io or api.tatum.dev into a route. No @tatumio/tatum SDK.
//
// Both throw MissingApiKeyError when the workspace has no key — surface it, don't retry.
//
//   import { tatumFetch, tatumRpc, MissingApiKeyError } from '../tatum-client.mjs'
//
//   const r = await tatumFetch('/v3/tatum/rate/BTC?basePair=USD')
//   const rpc = await tatumRpc('ethereum', {
//     jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1,
//   })

export default router
