import AxeBuilder from '@axe-core/playwright'
import { test, expect, OPEN } from './fixtures'

const VIEWS = [
  ['landing', '/'],
  ['today', '/?tab=today'],
  ['clients', '/?tab=clients'],
  ['invoices', '/?tab=invoices&inv=inv-101'],
  ['pay', `/?pay=${OPEN}`],
  ['proof', '/?tab=proof'],
] as const

for (const [name, url] of VIEWS) {
  test(`a11y: ${name} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle').catch(() => {})
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s) ${v.nodes[0]?.target}`)).toEqual([])
  })

  test(`responsive: ${name} never scrolls sideways`, async ({ page }) => {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
}

test('keyboard: the dashboard tabs are reachable and announce the current page', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile') || info.project.name === 'tablet', 'no hardware keyboard')
  await page.goto('/?tab=today')
  const clients = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Clients' })
  await clients.focus()
  await page.keyboard.press('Enter')
  await expect(clients).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeFocused()
})

// Visual regression: baselines are per OS/browser, so they run where they were recorded (not in CI).
test.describe('visual', () => {
  test.skip(!!process.env.CI, 'screenshot baselines are recorded locally')
  test('landing hero', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium' && info.project.name !== 'mobile-android')
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('header').first()).toHaveScreenshot('landing-hero.png', { mask: [page.locator('text=/checkpoint/i')], animations: 'disabled' })
  })
  test('pay not-found', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium' && info.project.name !== 'mobile-android')
    await page.goto('/?pay=inv-does-not-exist')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveScreenshot('pay-not-found.png', { animations: 'disabled' })
  })
})
