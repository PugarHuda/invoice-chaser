# Fee Estimation API

## What it is

Tatum Data API surface for **cross-chain gas and fee estimation**: recommended base fee per chain, generic transfer-gas estimation, multi-chain batch estimates, and chain-specific helpers (Ethereum batch, XDC, VeChain).

## When to use

- Estimate gas before sending a transaction — across any supported chain — without writing chain-specific fee math.
- Pre-flight a multi-chain transfer flow: show estimated fees per chain so the user can pick the cheapest.
- Batch-estimate gas for many candidate Ethereum transactions in one round-trip.
- Power a fee selector UI ("slow / standard / fast") with current network conditions.

## Key concepts

- **Normalised vs raw:** Data API returns a normalised fee shape so a multi-chain app doesn't re-implement per-chain gas math. For raw real-time per-chain numbers (`eth_gasPrice`, `eth_feeHistory`, Solana priority fees, etc.) use RPC — Data API may be slightly stale because it composes its answer.
- **Three estimation flavours:** a per-chain recommended base-fee headline, a generic estimator that sizes gas for a specific transfer shape (from, to, amount, contract if applicable), and chain-specific helpers for chains needing extra structure (XDC, VeChain). Reach for the generic estimator first; use chain-specific helpers only when MCP indicates a chain-specific shape is required.
- **Transaction-level pricing** is separate from skill pricing — never inline credit-cost claims here; defer to MCP.

## Relates to

- [rpc-nodes](../rpc/rpc-nodes.md) — raw per-chain fee methods when you need real-time precision or chain-specific semantics.
- [wallet-api.md](wallet-api.md) — combine with native balance to validate the wallet can cover the estimated fee.

## Get the details

- **tatum-docs MCP:** paths `/v3/blockchain/fee`, `/v3/blockchain/estimate`, `/v4/blockchainOperations/gas`, `/v3/ethereum/gas/batch`, `/v3/xdc/gas`, `/v3/vet/transaction/gas`.
- **Web:** https://docs.tatum.io/reference/fee-estimation-api
