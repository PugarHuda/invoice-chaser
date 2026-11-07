import { test, expect } from './fixtures'

test('Today ranks who to chase from memory + chain, with reasons', async ({ page }) => {
  await page.goto('/?tab=today')
  const queue = page.locator('section', { has: page.getByRole('heading', { name: /who to chase today/i }) })
  await expect(queue).toContainText('Acme Corp')
  await expect(queue.locator('li').first()).toBeVisible()
})

test('a client profile is learned from Walrus memories (and seeded history is labelled)', async ({ page }) => {
  await page.goto('/?tab=clients')
  await page.getByRole('button', { name: /acme corp/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Acme Corp' })).toBeVisible()
  await expect(page.getByText(/walrus namespace/i)).toBeVisible()
  await expect(page.getByText('seeded demo history').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /statement of account/i })).toHaveAttribute('href', /\/clients\/c1\/statement\?format=csv$/)
})

test('memory on vs off changes the reminder plan', async ({ page }) => {
  await page.goto('/?tab=invoices&inv=inv-101')
  await expect(page.getByRole('heading', { name: /adaptive reminder plan/i })).toBeVisible()
  await expect(page.getByText(/why this plan\?/i).first()).toBeVisible()
  await page.getByRole('switch', { name: 'Ignore memory' }).click()
  await expect(page.getByRole('switch', { name: 'Ignore memory' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: /default plan \(without memory\)/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /adaptive reminder plan/i })).toHaveCount(0)
})

test('add client: empty name sends nothing; a failed save says so', async ({ page }) => {
  let posts = 0
  await page.route('**/api/chaser/clients', (r) => (r.request().method() === 'POST' ? (posts++, r.fulfill({ status: 500, json: { error: 'Walrus relayer unavailable' } })) : r.fallback()))
  await page.goto('/?tab=clients')
  const name = page.getByPlaceholder('New client name')
  await name.fill('   ')
  await name.press('Enter')
  expect(posts).toBe(0)
  await name.fill('Zeta & Söhne <b>GmbH</b>')
  await name.press('Enter')
  await expect(page.getByText(/walrus relayer unavailable/i)).toBeVisible()
  expect(posts).toBe(1)
})

test('an API outage shows an error, never zeros', async ({ page }) => {
  await page.route('**/api/chaser/summary', (r) => r.fulfill({ status: 503, json: { error: 'Loading memory from Walrus failed' } }))
  await page.goto('/?tab=today')
  await expect(page.getByRole('alert')).toContainText(/summary/i)
})

test('an expired/wrong owner passcode asks again instead of failing silently', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ic-passcode', 'stale'))
  // the whole API answers 401 (an expired session); nothing reaches the real server, so this test can't
  // count toward that IP's wrong-passcode lockout and disturb parallel tests
  await page.route('**/api/chaser/**', (r) => r.fulfill({ status: 401, json: { error: 'Owner passcode required' } }))
  const asked = page.waitForEvent('dialog')
  await page.goto('/?tab=clients')
  const d = await asked
  expect(d.message()).toMatch(/passcode/i)
  await d.dismiss()
})
