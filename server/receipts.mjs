// Paid-invoice receipts as PDFs stored permanently on Walrus (plain blob storage, separate from Walrus Memory).
// The server's storage wallet (WALRUS_STORAGE_KEY, holds WAL + SUI) pays; writes go through the Mysten upload relay.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { walrus } from '@mysten/walrus'
import { NETWORK } from './sui.mjs'

const EPOCHS = 26 // ~1 year on mainnet (14-day epochs)
const RELAY = { mainnet: 'https://upload-relay.mainnet.walrus.space', testnet: 'https://upload-relay.testnet.walrus.space' }
export const AGGREGATOR = { mainnet: 'https://aggregator.walrus-mainnet.walrus.space', testnet: 'https://aggregator.walrus-testnet.walrus.space' }[NETWORK]

let client
const walrusClient = () =>
  (client ??= new SuiGrpcClient({ network: NETWORK, baseUrl: `https://fullnode.${NETWORK}.sui.io:443` }).$extend(
    walrus({ uploadRelay: { host: RELAY[NETWORK], sendTip: { max: 5_000_000 } } }),
  ))
const signer = () => (process.env.WALRUS_STORAGE_KEY ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.WALRUS_STORAGE_KEY).secretKey) : null)
export const receiptsEnabled = () => Boolean(process.env.WALRUS_STORAGE_KEY)

/** r: { invoiceId, client, description, amount, dueDate, paidOn, payments: [{digest, received, payer}], payee, network, explorer } */
export async function receiptPdf(r) {
  const doc = await PDFDocument.create()
  doc.setTitle(`Receipt ${r.invoiceId}`)
  doc.setCreator('Invoice Chaser')
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let y = 780
  const line = (text, { f = font, size = 11, gap = 18, color = rgb(0.1, 0.1, 0.1) } = {}) => {
    page.drawText(String(text), { x: 50, y, size, font: f, color, maxWidth: 495 })
    y -= gap
  }
  line('PAYMENT RECEIPT', { f: bold, size: 20, gap: 30 })
  line(`Invoice: ${r.invoiceId}`, { f: bold })
  line(`Client: ${r.client}`)
  line(`Description: ${r.description || '-'}`)
  line(`Amount: ${r.amount} USDC`)
  line(`Due: ${r.dueDate}    Paid: ${r.paidOn}`)
  line(`Paid to: ${r.payee}`, { size: 9 })
  line(`Network: Sui ${r.network}`, { gap: 28 })
  line('On-chain payments', { f: bold })
  for (const p of r.payments) {
    line(`${p.received ?? '?'} USDC from ${p.payer || 'unknown payer'}`, { size: 9, gap: 13 })
    line(`${r.explorer}/tx/${p.digest}`, { size: 9, gap: 18, color: rgb(0.1, 0.3, 0.7) })
  }
  y -= 10
  line('Each payment above was verified on Sui through the Tatum gRPC gateway before this receipt was issued.', { size: 9, color: rgb(0.4, 0.4, 0.4) })
  line('This receipt is stored on Walrus; its blob id is recorded in the client\'s Walrus Memory.', { size: 9, color: rgb(0.4, 0.4, 0.4) })
  return doc.save()
}

export async function storeReceipt(r) {
  const s = signer()
  if (!s) throw new Error('WALRUS_STORAGE_KEY is not configured')
  const blob = await receiptPdf(r)
  const { blobId, blobObject } = await walrusClient().walrus.writeBlob({ blob, deletable: false, epochs: EPOCHS, signer: s, attributes: { 'content-type': 'application/pdf', invoice: r.invoiceId } })
  return { blobId, objectId: blobObject.id, endEpoch: blobObject.storage.end_epoch, bytes: blob.length, url: `${AGGREGATOR}/v1/blobs/${blobId}` }
}
