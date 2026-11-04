// MPP (Machine Payments Protocol, mpp.dev) next to x402: an invoice is also an MPP "charge".
// @suimpp/mpp issues the 402 challenge (HMAC-bound to the invoice id), checks the agent's
// grief-protection signature (signer == on-chain sender) and the transfer itself; the route then
// runs the digest through our own Tatum verify/settle path before anything is remembered.
import { Mppx } from 'mppx/express'
import { Credential } from 'mppx'
import { sui as suiMethod, USDC, USDC_TESTNET } from '@suimpp/mpp/server'
import * as sui from './sui.mjs'

let mppx
export const mppEnabled = () => Boolean(process.env.MPP_SECRET_KEY && process.env.SUI_PAYEE_ADDRESS)

/** @param {() => Set<string>} usedDigests digests already settled (from Walrus Memory) */
export function mpp(usedDigests) {
  mppx ??= Mppx.create({
    secretKey: process.env.MPP_SECRET_KEY,
    realm: 'invoice-chaser',
    methods: [
      suiMethod({
        currency: sui.NETWORK === 'mainnet' ? USDC : USDC_TESTNET,
        recipient: process.env.SUI_PAYEE_ADDRESS,
        network: sui.NETWORK,
        // replay protection backed by Walrus Memory: a digest that settled any invoice is spent
        store: { has: async (d) => usedDigests().has(d), set: async () => {} },
      }),
    ],
  })
  return mppx
}

// The verified credential's on-chain digest (Authorization: Payment <base64url>).
export function credentialDigest(req) {
  const h = req.get('authorization') || ''
  if (!/^Payment\s+/i.test(h)) return null
  try {
    return Credential.deserialize(h).payload?.digest || null
  } catch {
    return null
  }
}
