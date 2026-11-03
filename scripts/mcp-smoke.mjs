// Smoke test for the MCP endpoint with the official MCP client.
//   node scripts/mcp-smoke.mjs https://invoice-chaser-sigma.vercel.app
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const base = process.argv[2] || 'http://localhost:3000'
const client = new Client({ name: 'mcp-smoke', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/chaser/mcp`)))
const { tools } = await client.listTools()
console.log('tools:', tools.map((t) => t.name).join(', '))
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text)
const open = await call('list_open_invoices')
console.log('open invoices:', open.length, open[0] && `${open[0].invoice} ${open[0].client} next ${open[0].nextReminder?.date} ${open[0].nextReminder?.tone}`)
const prof = await call('client_profile', { clientId: 'c1' })
console.log('c1 profile:', prof.client?.name, 'ewma', prof.profile?.ewmaDelayDays, 'best', prof.profile?.bestTone, 'rules', prof.profile?.preferences)
const plan = await call('plan_reminder', { invoiceId: 'inv-101' })
console.log('inv-101 plan:', plan.predictedPayDate, plan.steps.map((s) => `${s.date} ${s.tone}`).join(' / '), 'cites', plan.cites?.length)
const hits = await call('search_client_memory', { clientId: 'c1', query: 'what tone gets them to pay?' })
console.log('search:', hits.slice(0, 2).map((h) => `${h.distance} ${h.sentence.slice(0, 60)}`))
const terms = await call('payment_terms', { invoiceId: 'inv-101' })
console.log('terms:', terms.network, terms.amount, terms.extra?.paymentKit?.nonce, terms.payPage)
console.log('learning:', await call('learning_summary'))
const bad = await client.callTool({ name: 'client_profile', arguments: { clientId: 'nope' } })
console.log('unknown client isError:', bad.isError)
await client.close()
