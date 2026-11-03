import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftReminder } from './drafter.mjs'

test('without gateway credentials the template is used and says so', async () => {
  const saved = [process.env.VERCEL_OIDC_TOKEN, process.env.AI_GATEWAY_API_KEY]
  delete process.env.VERCEL_OIDC_TOKEN
  delete process.env.AI_GATEWAY_API_KEY
  const r = await draftReminder({ client: 'Acme', tone: 'formal', invoice: { id: 'inv-1', owed: '10.000001', dueDate: '2026-11-05' }, payLink: 'https://x/?pay=inv-1', facts: [] })
  assert.equal(r.source, 'template')
  assert.match(r.text, /inv-1.*10\.000001 USDC.*2026-11-05[\s\S]*https:\/\/x\/\?pay=inv-1/)
  ;[process.env.VERCEL_OIDC_TOKEN, process.env.AI_GATEWAY_API_KEY] = saved
})

test('a client name containing a placeholder is not re-expanded', async () => {
  delete process.env.VERCEL_OIDC_TOKEN
  delete process.env.AI_GATEWAY_API_KEY
  const r = await draftReminder({ client: 'Evil {{LINK}}', tone: 'friendly', invoice: { id: 'inv-2', owed: '1.00', dueDate: '2026-11-05' }, payLink: 'https://x/?pay=inv-2', facts: [] })
  assert.match(r.text, /^Hi Evil \{\{LINK\}\},/)
})
