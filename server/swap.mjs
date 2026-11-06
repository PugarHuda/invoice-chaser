// SUI -> USDC through the Cetus aggregator (routes across Sui DEXes). The quote comes from the
// aggregator API; the transaction is built and executed through Tatum's gRPC gateway like everything else.
import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { sui, once, USDC_COIN_TYPE, NETWORK, REGISTRY_NAME } from './sui.mjs'

const SUI = '0x2::sui::SUI'

function aggregator(sender) {
  if (NETWORK !== 'mainnet') throw new Error('swaps are mainnet-only (the aggregator has no testnet liquidity)')
  return new AggregatorClient({ client: sui(), signer: sender, env: Env.Mainnet })
}

// Quote: how much SUI buys exactly `usdcMicro` USDC.
export async function quoteSuiForUsdc(sender, usdcMicro) {
  const r = await once(() => aggregator(sender).findRouters({ from: SUI, target: USDC_COIN_TYPE, amount: BigInt(usdcMicro).toString(), byAmountIn: false }))
  if (!r || r.insufficientLiquidity) throw new Error('no route for SUI -> USDC')
  return { router: r, suiIn: BigInt(r.amountIn.toString()), usdcOut: BigInt(r.amountOut.toString()), providers: [...new Set(r.paths?.map((p) => p.provider) || [])] }
}

// Build (unsigned) the swap transaction for `sender`.
export async function buildSwapSuiForUsdc(sender, usdcMicro, slippage = 0.01) {
  const q = await quoteSuiForUsdc(sender, usdcMicro)
  const tx = new Transaction()
  tx.setSender(sender)
  await once(() => aggregator(sender).fastRouterSwap({ router: q.router, txb: tx, slippage }))
  // the aggregator's own gateway calls bypass our throttle, so retry 429s on the final build too
  const bytes = await once(() => tx.build({ client: sui() }))
  return { ...q, bytes: Buffer.from(bytes).toString('base64') }
}

// Pay an invoice with SUI in ONE transaction: split the worst-case SUI from gas, swap it to USDC through
// the aggregator (exact-out route), pay exactly `micro` through the Payment Kit registry (nonce = invoice
// id, so a duplicate aborts on-chain), and return every leftover coin to the payer. Nothing is custodied.
export async function buildSwapAndPay(sender, payee, micro, nonce, slippage = 0.01) {
  const q = await quoteSuiForUsdc(sender, micro)
  const maxIn = (q.suiIn * BigInt(Math.round((1 + slippage) * 10_000))) / 10_000n
  const tx = new Transaction()
  tx.setSender(sender)
  const [suiIn] = tx.splitCoins(tx.gas, [maxIn])
  const usdc = await once(() => aggregator(sender).routerSwap({ router: q.router, inputCoin: suiIn, slippage, txb: tx }))
  const [exact] = tx.splitCoins(usdc, [BigInt(micro)])
  tx.add(sui().paymentKit.calls.processRegistryPayment({ nonce, coinType: USDC_COIN_TYPE, amount: BigInt(micro), receiver: payee, sender, registryName: REGISTRY_NAME, sourceCoin: exact }))
  tx.transferObjects([usdc], sender) // swap surplus back to the payer (the router refunds unspent SUI itself)
  const bytes = await once(() => tx.build({ client: sui() }))
  return { bytes: Buffer.from(bytes).toString('base64'), suiIn: q.suiIn, maxSuiIn: maxIn, providers: q.providers }
}
