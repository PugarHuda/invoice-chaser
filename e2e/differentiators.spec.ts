import { test, expect } from './fixtures'

test('landing: the three differentiators are in the first viewport, with live evidence', async ({ page, request }) => {
  const proof = await (await request.get('/api/chaser/proof')).json()
  const audit = proof.walrusMemory.chainAudit
  await page.goto('/')
  const strip = page.getByRole('list', { name: 'What makes it different' })
  await expect(strip.getByRole('listitem')).toHaveCount(3)
  await expect(strip).toBeInViewport()
  await expect(strip).toContainText('Learning you can check')
  await expect(strip).toContainText('Memory proven by the chain')
  await expect(strip).toContainText('Chases the wallet, not the calendar')
  if (audit?.withTransaction) await expect(strip).toContainText(`${audit.verified}/${audit.withTransaction} remembered payments re-proven on Sui`)
})

test('landing: comparison with named competitors, honest about what their docs do not say', async ({ page }) => {
  await page.goto('/')
  const table = page.getByRole('table', { name: /compared with collections and crypto invoicing tools/i })
  for (const name of ['Invoice Chaser', 'Chaser', 'Kolleno', 'Request Finance', 'Coinbase Business']) await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible()
  await expect(table.getByRole('row')).toHaveCount(10)
  const row = table.getByRole('row', { name: /re-checked against the chain/i })
  await expect(row.getByRole('cell').first()).toHaveText('Yes')
  await expect(row).toContainText('Not in public docs')
})

test.describe('recurring invoices', () => {
  test('the form starts with no preset amount, defaults to the first real client, and sends the repeat choice', async ({ page, request }) => {
    const clients = await (await request.get('/api/chaser/clients')).json()
    let sent: Record<string, unknown> | null = null
    await page.route('**/api/chaser/invoices', (r) => {
      if (r.request().method() !== 'POST') return r.fallback()
      sent = JSON.parse(r.request().postData() || '{}')
      return r.fulfill({ json: { invoice: { id: 'inv-e2e-rec', payAmount: '250.004321' } } })
    })
    await page.goto('/?tab=invoices')
    await expect(page.getByLabel('Amount (USDC)')).toHaveValue('')
    await expect(page.getByLabel('Client', { exact: true })).toHaveValue(clients[0].id)
    await page.getByRole('button', { name: /new invoice/i }).click()
    await expect(page.getByText(/enter an amount from 0\.01/i)).toBeVisible()
    expect(sent).toBeNull()
    await page.getByLabel('Amount (USDC)').fill('250')
    await page.getByLabel('Repeat').selectOption('monthly')
    await page.getByRole('button', { name: /new invoice/i }).click()
    await expect(page.getByText(/repeats monthly/i)).toBeVisible()
    expect(sent).toMatchObject({ clientId: clients[0].id, amount: '250', repeat: 'monthly' })
  })

  test('a repeating invoice shows its next due date and can be stopped', async ({ page, request }) => {
    // the real invoice, plus the series fields the server derives from Walrus Memory (no real series exists to
    // stop in a test: stopping writes a permanent memory)
    const body = await (await request.get('/api/chaser/invoices/inv-102')).json()
    body.invoice = { ...body.invoice, repeat: 'monthly', series: 'inv-102', prev: null, repeatStopped: false, nextDue: '2026-12-08' }
    await page.route('**/api/chaser/invoices/inv-102', (r) => r.fulfill({ json: body }))
    let stopped = 0
    await page.route('**/api/chaser/invoices/inv-102/stop-repeat', (r) => (stopped++, r.fulfill({ json: { success: true } })))
    await page.goto('/?tab=invoices&inv=inv-102')
    await expect(page.getByText(/monthly · next due 2026-12-08/)).toBeVisible()
    await page.getByRole('button', { name: 'Stop repeating' }).click()
    await expect(page.getByText(/series stopped/i)).toBeVisible()
    expect(stopped).toBe(1)
  })
})
