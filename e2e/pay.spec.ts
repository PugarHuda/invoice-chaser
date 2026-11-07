import { test, expect, OPEN, PAID } from './fixtures'

test('a pay link shows the exact amount, QR and PDF for the client', async ({ page, request }) => {
  const inv = await (await request.get(`/api/chaser/pay/${OPEN}`)).json()
  await page.goto(`/?pay=${OPEN}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Pay Invoice #${OPEN}`)
  await expect(page.getByText(inv.invoice.payAmount).first()).toBeVisible()
  await expect(page.getByRole('img', { name: /scan to pay/i }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /download invoice \(pdf\)/i }).first()).toHaveAttribute('href', new RegExp(`/pay/${OPEN}/invoice\.pdf`))
})

test('a paid invoice says so and offers no way to pay again', async ({ page }) => {
  await page.goto(`/?pay=${PAID}`)
  await expect(page.getByText(/paid on/i).first()).toBeVisible()
  await expect(page.getByText(/amount paid/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /connect sui wallet/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /verify & settle/i })).toHaveCount(0)
})

test('unknown invoice link: a clear not-found state', async ({ page }) => {
  await page.goto('/?pay=inv-does-not-exist')
  await expect(page.getByRole('alert')).toContainText(/does not exist/i)
})

test('server error and offline: say what happened, keep no stale amount', async ({ page }) => {
  await page.route(`**/api/chaser/pay/${OPEN}`, (r) => r.fulfill({ status: 500, json: { error: 'boom' } }))
  await page.goto(`/?pay=${OPEN}`)
  await expect(page.getByRole('alert')).toContainText(/HTTP 500/)
  await page.unroute(`**/api/chaser/pay/${OPEN}`)
  await page.route(`**/api/chaser/pay/${OPEN}`, (r) => r.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(/network error/i)
})

test('digest box: empty, garbage, and a pasted explorer link', async ({ page }) => {
  const sent: string[] = []
  await page.route('**/api/chaser/verify-payment', async (r) => {
    sent.push(JSON.parse(r.request().postData() || '{}').digest)
    await new Promise((ok) => setTimeout(ok, 800))
    return r.fulfill({ status: 404, json: { error: 'Transaction not found on Sui' } })
  })
  await page.goto(`/?pay=${OPEN}`)
  const box = page.getByLabel(/paste the transaction digest/i)
  const verify = page.getByRole('button', { name: /verify & settle/i })
  await verify.click()
  await expect(page.getByText(/please enter a transaction digest/i)).toBeVisible()
  await box.fill('x'.repeat(5000) + ' 🙃 <script>')
  await verify.click()
  await expect(page.getByText(/isn't a Sui transaction digest/i)).toBeVisible()
  expect(sent).toEqual([])
  const digest = 'CzFhbHnEY6ug3dauaPqmp6CsNkuwfTMtJEGPqRArqkqU'
  await box.fill(`https://suiscan.xyz/mainnet/tx/${digest}`)
  // double submit in the same tick (before React re-renders the button as disabled)
  await verify.evaluate((b: HTMLButtonElement) => { b.click(); b.click() })
  await expect(page.getByText(/transaction not found on sui/i)).toBeVisible()
  expect(sent).toEqual([digest])
})

test('no wallet installed: says how to pay instead', async ({ page }) => {
  await page.goto(`/?pay=${OPEN}`)
  await page.getByRole('button', { name: /connect sui wallet/i }).click()
  await expect(page.getByText(/no sui wallet found/i)).toBeVisible()
})

// A Wallet Standard wallet registered in the page (the same protocol Slush and other Sui wallets use).
const walletScript = (mode: 'reject' | 'approve') => `
  (() => {
    const wallet = {
      version: '1.0.0', name: 'E2E Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['sui:mainnet'], accounts: [],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => {
          if (${JSON.stringify(mode)} === 'reject') throw new Error('User rejected the request');
          return { accounts: [{ address: '0x' + '1'.repeat(64), publicKey: new Uint8Array(32), chains: ['sui:mainnet'], features: [] }] };
        } },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'sui:signAndExecuteTransaction': { version: '2.0.0', signAndExecuteTransaction: async () => { throw new Error('User rejected the request') } },
      },
    };
    const register = ({ register }) => register(wallet);
    window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail));
    (window.navigator.wallets ||= []).push(register);
  })();`

test('wallet rejects the connection: the payer is told, nothing is sent', async ({ page }) => {
  await page.addInitScript(walletScript('reject'))
  await page.goto(`/?pay=${OPEN}`)
  await page.getByRole('button', { name: /connect sui wallet/i }).click()
  await expect(page.getByText(/user rejected the request/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /connect sui wallet/i })).toBeEnabled()
})

test('payer cannot cover the invoice: the build error reaches the payer', async ({ page }) => {
  await page.addInitScript(walletScript('approve'))
  await page.route('**/api/chaser/pay-tx', (r) => r.fulfill({ status: 400, json: { error: 'Not enough USDC in this wallet: needs 4200.003867, has 12.5' } }))
  await page.goto(`/?pay=${OPEN}`)
  await page.getByRole('button', { name: /connect sui wallet/i }).click()
  await expect(page.getByText(/not enough usdc in this wallet/i)).toBeVisible()
})

test.describe('live stream', () => {
  test.use({ allowLive: true })
  test('an open pay page watches Sui checkpoints through Tatum', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'chromium', 'one live Tatum subscription per run is enough')
    await page.goto(`/?pay=${OPEN}`)
    await expect(page.getByText(/watching sui/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
