import { test as base, expect } from '@playwright/test'

// Every test runs against real data, so two guards are on by default:
// - non-GET API calls are aborted: a test must never write a (permanent) Walrus memory or move funds
// - the live checkpoint stream (/pay/:id/live) is aborted: it holds a Tatum gRPC subscription open
// A test that needs either one replaces it with its own page.route (registered later, so it runs first)
// or sets `test.use({ allowLive: true })`. Any uncaught page error fails the test.
export const test = base.extend<{ allowLive: boolean; guard: void }>({
  allowLive: [false, { option: true }],
  guard: [
    async ({ page, allowLive }, use) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route('**/api/**', (route) => {
        const req = route.request()
        if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.abort('blockedbyclient')
        if (!allowLive && /\/live$/.test(new URL(req.url()).pathname)) return route.abort('blockedbyclient')
        return route.fallback()
      })
      await use()
      expect(errors, 'uncaught errors in the page').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export const PAID = 'inv-mw25p3mw60f829' // Delta Studio, paid on Sui mainnet (reconciled plain transfer)
export const OPEN = 'inv-101' // Acme, open
