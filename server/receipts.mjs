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

// Standard PDF fonts are WinAnsi-only: a client named in CJK or with an emoji would make pdf-lib
// throw. Replace every character the font cannot encode instead of failing the whole document.
const safe = (font, text) => [...String(text ?? '-')].map((ch) => { try { font.encodeText(ch); return ch } catch { return '?' } }).join('')

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
    page.drawText(safe(f, text), { x: 50, y, size, font: f, color, maxWidth: 495 })
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

// The invoice itself as a PDF, generated on request from Walrus Memory state (nothing stored):
// the exact amount, a scannable sui:pay QR (Payment Kit, nonce = invoice id), the pay link and the
// agent endpoints. A paid invoice is stamped PAID with its transaction.
/** v: { id, client, description, issuedDate, dueDate, amount, payee, network, paymentUri, payUrl, mppUrl, x402Url, status, digest, explorer } */
export async function invoicePdf(v) {
  const QR = (await import('qrcode')).default
  const doc = await PDFDocument.create()
  doc.setTitle(`Invoice ${v.id}`)
  doc.setCreator('Invoice Chaser')
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.1), grey = rgb(0.4, 0.4, 0.4), brand = rgb(0.31, 0.22, 0.99)
  let y = 780
  const line = (text, { f = font, size = 11, gap = 18, color = ink, x = 50 } = {}) => {
    page.drawText(safe(f, text), { x, y, size, font: f, color, maxWidth: 545 - x })
    y -= gap
  }
  line('INVOICE', { f: bold, size: 22, gap: 30, color: brand })
  line(`Invoice ${v.id}`, { f: bold })
  line(`Billed to: ${v.client}`)
  line(`For: ${v.description || 'services'}`)
  line(`Issued: ${v.issuedDate || '-'}    Due: ${v.dueDate}`, { gap: 30 })
  line(v.status === 'paid' ? 'Amount paid' : 'Amount due', { size: 10, color: grey, gap: 30 })
  line(`${v.amount} USDC`, { f: bold, size: 24, gap: 18 })
  if (v.status !== 'paid') line('Pay this exact amount: the last digits identify this invoice.', { size: 9, color: grey, gap: 28 })
  else y -= 10
  line(`Pay to (Sui ${v.network}): ${v.payee}`, { size: 9, gap: 14 })
  line(`Settlement: USDC through the Sui Payment Kit registry, nonce = ${v.id}`, { size: 9, gap: 26 })

  if (v.status === 'paid') {
    // stamp in the empty top-right corner, clear of every text line
    page.drawRectangle({ x: 400, y: 745, width: 140, height: 50, borderColor: rgb(0.1, 0.55, 0.3), borderWidth: 3 })
    page.drawText('PAID', { x: 432, y: 758, size: 28, font: bold, color: rgb(0.1, 0.55, 0.3) })
    line('Paid on-chain:', { f: bold, size: 10, gap: 14 })
    line(`${v.explorer}/tx/${v.digest}`, { size: 9, color: brand })
  } else {
    const png = await QR.toBuffer(v.paymentUri, { margin: 1, width: 360 })
    const img = await doc.embedPng(png)
    page.drawImage(img, { x: 50, y: y - 180, width: 180, height: 180 })
    const top = y
    y = top - 10
    line('Scan with a Sui wallet', { f: bold, x: 250, gap: 16 })
    line('(Slush, Suiet, Phantom). The QR is a Payment Kit', { size: 9, x: 250, gap: 13, color: grey })
    line('sui:pay link with the amount and nonce prefilled.', { size: 9, x: 250, gap: 24, color: grey })
    line('Or open the pay page:', { f: bold, size: 10, x: 250, gap: 14 })
    line(v.payUrl, { size: 9, x: 250, gap: 24, color: brand })
    line('AI agents can pay it directly:', { f: bold, size: 10, x: 250, gap: 14 })
    line(`MPP   ${v.mppUrl}`, { size: 8, x: 250, gap: 12 })
    line(`x402  ${v.x402Url}`, { size: 8, x: 250, gap: 12 })
    y = top - 200
  }
  y -= 10
  line('Payments are verified on Sui through the Tatum gRPC gateway and remembered in Walrus Memory.', { size: 9, color: grey })
  return doc.save()
}
