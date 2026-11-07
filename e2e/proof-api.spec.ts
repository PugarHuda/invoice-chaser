import { test, expect } from './fixtures'

test('/proof: Tatum connected and every remembered payment re-proven on Sui', async ({ page }) => {
  await page.goto('/?tab=proof')
  await expect(page.getByText(/memory audited against sui/i)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/every payment memory matches the chain/i)).toBeVisible()
})

test('/proof down: an error state, not a blank page', async ({ page }) => {
  await page.route('**/api/chaser/proof', (r) => r.fulfill({ status: 502, json: { error: 'Tatum Sui gRPC: deadline exceeded' } }))
  await page.goto('/?tab=proof')
  await expect(page.getByRole('status').filter({ hasText: /error/i }).first()).toBeVisible()
})

test.describe('API input validation (rejected before anything is written)', () => {
  test('owner writes need the passcode', async ({ request }) => {
    const r = await request.post('/api/chaser/clients', { data: { name: 'x' } })
    expect([401, 503]).toContain(r.status())
  })
  test('payer endpoints validate their inputs', async ({ request }) => {
    const bad = [
      { invoiceId: 'inv-101', digest: '' },
      { invoiceId: 'inv-101', digest: 'not-a-digest' },
      { invoiceId: 'inv-101', digest: '0'.repeat(10_000) },
      { invoiceId: 'inv-101', digest: -1 },
      { invoiceId: '../../etc/passwd', digest: 'CzFhbHnEY6ug3dauaPqmp6CsNkuwfTMtJEGPqRArqkqU' },
      {},
    ]
    for (const data of bad) {
      const r = await request.post('/api/chaser/verify-payment', { data })
      expect(r.status(), JSON.stringify(data).slice(0, 60)).toBeGreaterThanOrEqual(400)
      expect(r.status(), JSON.stringify(data).slice(0, 60)).toBeLessThan(500)
    }
  })
  test('statement of an unknown client is a 404; a real one is CSV', async ({ request }) => {
    expect((await request.get('/api/chaser/clients/nope/statement')).status()).toBe(404)
    const csv = await request.get('/api/chaser/clients/c1/statement?format=csv')
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    expect(await csv.text()).toMatch(/^type,date,invoice/)
  })
  test('x402 challenge for an open invoice is a 402 with exact Sui requirements', async ({ request }) => {
    const r = await request.get('/api/chaser/x402/inv-101')
    expect(r.status()).toBe(402)
    expect(JSON.stringify(await r.json())).toContain('sui:mainnet')
  })
})
