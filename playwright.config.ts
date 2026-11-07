import { defineConfig, devices } from '@playwright/test'

// BASE_URL=https://invoice-chaser-sigma.vercel.app runs the same suite read-only against production (CI does).
// Without it, a local server is started from the built SPA and .env.local (real Walrus Memory + Tatum).
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: true,
  // one shared backend (Walrus + Tatum, rate limited): keep concurrency modest
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'tablet', use: { ...devices['iPad Mini'] } },
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-ios', use: { ...devices['iPhone 14'] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node --env-file-if-exists=.env.local server/index.mjs',
        url: `${BASE_URL}/api/chaser/summary`,
        env: { PORT: '3100', RATE_LIMIT_SCALE: '50' },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
