import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { test, expect, OPEN, PAID } from './fixtures'
// the server's own verifier: what the UI sends must pass the exact check the route runs
import { verifyPayerProof, payerProofMessage } from '../server/sui.mjs'

test('a client proves its paying wallet by signing; the signed proof passes the server check', async ({ page, request }) => {
  const kp = new Ed25519Keypair()
  await page.exposeFunction('e2eSign', async (bytes: number[]) => (await kp.signPersonalMessage(Uint8Array.from(bytes))).signature)
  await page.addInitScript((address: string) => {
    const wallet = {
      version: '1.0.0', name: 'E2E Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['sui:mainnet'], accounts: [],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [{ address, publicKey: new Uint8Array(32), chains: ['sui:mainnet'], features: [] }] }) },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'sui:signPersonalMessage': { version: '1.0.0', signPersonalMessage: async ({ message }: { message: Uint8Array }) => ({ bytes: '', signature: await (window as unknown as { e2eSign: (b: number[]) => Promise<string> }).e2eSign([...message]) }) },
      },
    }
    const register = ({ register }: { register: (w: unknown) => void }) => register(wallet)
    window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail))
    const nav = window.navigator as unknown as { wallets?: unknown[] }
    ;(nav.wallets ||= []).push(register)
  }, kp.toSuiAddress())
  const inv = await (await request.get(`/api/chaser/pay/${OPEN}`)).json()
  let body: { message: string; signature: string; address: string } | null = null
  await page.route(`**/api/chaser/pay/${OPEN}/prove-payer`, async (r) => {
    body = JSON.parse(r.request().postData() || '{}')
    const v = await verifyPayerProof({ ...body!, invoiceId: OPEN, clientName: inv.invoice.clientName })
    return v.ok
      ? r.fulfill({ json: { success: true, address: v.address, scheme: v.scheme, verifiedBy: 'ED25519 signature check', wallet: { usdc: '12.5', covers: false, owed: inv.invoice.payAmount } } })
      : r.fulfill({ status: 400, json: { error: v.reason } })
  })
  await page.goto(`/?pay=${OPEN}`)
  await page.getByRole('button', { name: /prove the wallet you will pay from/i }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Proven:/ })).toContainText(/holds 12\.5 USDC on Sui, not yet enough/)
  expect(body!.address).toBe(kp.toSuiAddress())
  expect(body!.message).toMatch(new RegExp(`^Invoice Chaser: ${inv.invoice.clientName} pays invoices from this wallet\.\nInvoice: ${OPEN}\nIssued: `))
})

test.describe('prove-payer refuses without writing anything', () => {
  const kp = new Ed25519Keypair()
  const sign = async (t: string) => (await kp.signPersonalMessage(new TextEncoder().encode(t))).signature
  test('wrong signer, stale message, paid and unknown invoices', async ({ request }) => {
    const { message } = await (await request.get(`/api/chaser/pay/${OPEN}/payer-message`)).json()
    const other = new Ed25519Keypair().toSuiAddress()
    const post = (id: string, data: object) => request.post(`/api/chaser/pay/${id}/prove-payer`, { data })
    let r = await post(OPEN, { message, signature: await sign(message), address: other })
    expect(r.status()).toBe(400)
    const stale = payerProofMessage(OPEN, message.split(' pays ')[0].replace('Invoice Chaser: ', ''), new Date(Date.now() - 3_600_000).toISOString())
    r = await post(OPEN, { message: stale, signature: await sign(stale), address: kp.toSuiAddress() })
    expect(r.status()).toBe(400)
    expect((await r.json()).error).toMatch(/expired/)
    r = await post(OPEN, { message: 'hello', signature: await sign('hello'), address: kp.toSuiAddress() })
    expect(r.status()).toBe(400)
    expect((await post(PAID, { message, signature: await sign(message), address: kp.toSuiAddress() })).status()).toBe(409)
    expect((await post('inv-nope', {})).status()).toBe(404)
  })
})
