// SUI -> USDC through the Cetus aggregator (routes across Sui DEXes). The quote comes from the
// aggregator API; the transaction is built and executed through Tatum's gRPC gateway like everything else.
import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { sui, USDC_COIN_TYPE, NETWORK } from './sui.mjs'

const SUI = '0x2::sui::SUI'

function aggregator(sender) {
  if (NETWORK !== 'mainnet') throw new Error('swaps are mainnet-only (the aggregator has no testnet liquidity)')
  return new AggregatorClient({ client: sui(), signer: sender, env: Env.Mainnet })
}

// Quote: how much SUI buys exactly `usdcMicro` USDC.
export async function quoteSuiForUsdc(sender, usdcMicro) {
  const r = await aggregator(sender).findRouters({ from: SUI, target: USDC_COIN_TYPE, amount: BigInt(usdcMicro).toString(), byAmountIn: false })
  if (!r || r.insufficientLiquidity) throw new Error('no route for SUI -> USDC')
  return { router: r, suiIn: BigInt(r.amountIn.toString()), usdcOut: BigInt(r.amountOut.toString()), providers: [...new Set(r.paths?.map((p) => p.provider) || [])] }
}

// Build (unsigned) the swap transaction for `sender`.
export async function buildSwapSuiForUsdc(sender, usdcMicro, slippage = 0.01) {
  const q = await quoteSuiForUsdc(sender, usdcMicro)
  const tx = new Transaction()
  tx.setSender(sender)
  await aggregator(sender).fastRouterSwap({ router: q.router, txb: tx, slippage })
  const bytes = await tx.build({ client: sui() })
  return { ...q, bytes: Buffer.from(bytes).toString('base64') }
}
