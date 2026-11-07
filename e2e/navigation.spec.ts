import { test, expect } from './fixtures'

test('landing shows live production numbers from the API, never placeholders', async ({ page, request }) => {
  const summary = await (await request.get('/api/chaser/summary')).json()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/invoices that learn/i)
  const live = page.locator('section', { has: page.getByRole('heading', { name: /production, right now/i }) })
  await expect(live).toContainText(`${summary.learning.firstError}`)
  await expect(live).toContainText(`${summary.learning.latestError}`)
})

test('landing → dashboard, and every tab is its own URL (back/forward work)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /open live dashboard/i }).click()
  await expect(page.getByRole('heading', { level: 1, name: /today/i })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('button', { name: 'Clients' }).click()
  await expect(page).toHaveURL(/tab=clients/)
  await nav.getByRole('button', { name: '/proof' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /proof/i })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { level: 1, name: /proof/i })).toBeVisible()
})

test('deep links: a tab, an invoice, and an unknown tab falls back to Today', async ({ page }) => {
  await page.goto('/?tab=invoices&inv=inv-101')
  await expect(page.getByRole('heading', { level: 1, name: /invoice detail/i })).toBeVisible()
  await expect(page.getByLabel(/select invoice/i)).toHaveValue('inv-101')
  await page.goto('/?tab=doesnotexist')
  await expect(page.getByRole('heading', { level: 1, name: /today/i })).toBeVisible()
})

test('unknown API routes and files are JSON 404s, not the SPA', async ({ request }) => {
  for (const path of ['/api/chaser/nope', '/.well-known/nothing', '/missing.png']) {
    const r = await request.get(path)
    expect(r.status(), path).toBe(404)
    expect(r.headers()['content-type']).toContain('application/json')
  }
})

test('a refresh mid-flow keeps the selected tab and invoice', async ({ page }) => {
  await page.goto('/?tab=invoices&inv=inv-102')
  await expect(page.getByLabel(/select invoice/i)).toHaveValue('inv-102')
  await page.reload()
  await expect(page.getByLabel(/select invoice/i)).toHaveValue('inv-102')
})
