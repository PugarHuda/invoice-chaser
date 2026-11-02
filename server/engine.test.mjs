// node --test server/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveState, computeProfile, plan, parsePreference, applyConstraints, uniquePayAmount, isoDay } from './engine.mjs'
import { encode, decode } from './memory.mjs'
import { toMicro, fromMicro } from './sui.mjs'

const mem = (at, tag) => ({ timestamp: at, tag: { ...tag, at } })

// Acme: pays 5 days late, only after a formal reminder.
const acme = [
  mem('2026-09-01T10:00:00Z', { type: 'client_created', client: 'acme', name: 'Acme' }),
  ...[['inv-1', '2026-09-10', '2026-09-15'], ['inv-2', '2026-09-25', '2026-09-30'], ['inv-3', '2026-10-10', '2026-10-15']].flatMap(([inv, due, paid]) => [
    mem(`${due}T00:00:00Z`.replace(/\d\dT/, '01T'), { type: 'invoice_sent', client: 'acme', invoice: inv, base: 300, pay_amount: '300.001234', due }),
    mem(`${due}T09:00:00Z`.replace(due, isoDay(new Date(due).getTime() + 86400000)), { type: 'reminder_sent', client: 'acme', invoice: inv, tone: 'friendly' }),
    mem(`${paid}T08:00:00Z`.replace(paid, isoDay(new Date(paid).getTime() - 2 * 86400000)), { type: 'reminder_sent', client: 'acme', invoice: inv, tone: 'formal' }),
    mem(`${paid}T12:00:00Z`, { type: 'invoice_paid', client: 'acme', invoice: inv, due, paid, delay_days: 5, reminders: 2 }),
  ]),
]

test('profile learns delay and the tone that works', () => {
  const p = computeProfile('acme', acme)
  assert.equal(p.totalPaidInvoices, 3)
  assert.equal(p.ewmaDelayDays, 5)
  assert.equal(p.bestTone, 'formal')
  assert.equal(p.toneStats.formal.hits, 3)
  assert.equal(p.toneStats.friendly.hits, 0)
  assert.equal(p.reliabilityBadge, 'Pays Late')
  // prediction error shrinks once history exists
  assert.deepEqual(p.history.map((h) => h.error), [5, 0, 0])
})

test('memory changes the plan', () => {
  const inv = { dueDate: '2026-11-05' }
  const p = computeProfile('acme', acme)
  const without = plan(inv, p, { ignoreMemory: true })
  const withMem = plan(inv, p)
  assert.equal(without.steps[0].date, '2026-11-06')
  assert.equal(without.steps[0].tone, 'friendly')
  assert.equal(withMem.predictedPayDate, '2026-11-10')
  assert.equal(withMem.steps[0].date, '2026-11-09')
  assert.equal(withMem.steps[0].tone, 'formal')
})

test('preferences are hard constraints', () => {
  assert.deepEqual(parsePreference('Never chase Acme before the 10th'), { notBeforeDayOfMonth: 10 })
  assert.deepEqual(parsePreference('no reminders on weekends').skipWeekdays, [0, 6])
  assert.deepEqual(parsePreference("don't email them on Fridays").skipWeekdays, [5])
  assert.equal(isoDay(applyConstraints('2026-11-06T00:00:00Z', { notBeforeDayOfMonth: 10 })), '2026-11-10')
  assert.equal(isoDay(applyConstraints('2026-11-07T00:00:00Z', { skipWeekdays: [0, 6] })), '2026-11-09') // Sat -> Mon
  const p = computeProfile('acme', [...acme, mem('2026-10-20T00:00:00Z', { type: 'preference', client: 'acme', note: 'never before the 10th' })])
  assert.equal(plan({ dueDate: '2026-11-03' }, p).steps[0].date, '2026-11-10')
})

test('notes: "only Thursdays, never before the 15th" means pay day + no early chasing', () => {
  const c = parsePreference('Vendor payments are only run on Thursdays and never before the 15th of the month')
  assert.deepEqual(c, { notBeforeDayOfMonth: 15, payWeekdays: [4] })
  assert.equal(c.skipWeekdays, undefined) // the old parser wrongly blocked Thursdays
  assert.deepEqual(parsePreference('please never send reminders on Fridays').skipWeekdays, [5])
  // a brand-new client with a rule: default plan still obeys it, and predicts their pay day
  const fresh = computeProfile('x', [mem('2026-11-01T00:00:00Z', { type: 'note', source: 'walrus-analyze' })].map((m) => ({ ...m, sentence: 'Vendor payments are only run on Thursdays and never before the 15th of the month' })))
  const p = plan({ dueDate: '2026-11-03' }, fresh) // Tue 3 Nov
  assert.equal(p.steps[0].date, '2026-11-15')
  assert.equal(p.predictedPayDate, '2026-11-05') // next Thursday
})

test('state is derived from memories (total recall)', () => {
  const store = new Map([['ic:main:client:acme', [...acme].reverse()]])
  const { clients, invoices } = deriveState(store)
  assert.equal(clients[0].name, 'Acme')
  assert.equal(invoices.length, 3)
  assert.ok(invoices.every((i) => i.status === 'paid' && i.reminders === 2))
  // a partial payment's digest stays "used" even after a later payment replaces it on the invoice
  const s2 = new Map([['n', [
    mem('2026-10-01T00:00:00Z', { type: 'invoice_sent', client: 'x', invoice: 'i1', base: 10, pay_amount: '10.001000', due: '2026-10-05' }),
    mem('2026-10-06T00:00:00Z', { type: 'invoice_partial', client: 'x', invoice: 'i1', digest: 'D1' }),
    mem('2026-10-07T00:00:00Z', { type: 'invoice_paid', client: 'x', invoice: 'i1', digest: 'D2' }),
  ]]])
  const { usedDigests } = deriveState(s2)
  assert.ok(usedDigests.has('D1') && usedDigests.has('D2'))
})

test('encoding round-trips and amounts are exact', () => {
  const t = { type: 'x', n: 1 }
  assert.deepEqual(decode(encode('Hello #ic world', t)), { sentence: 'Hello #ic world', tag: t })
  assert.equal(fromMicro(toMicro('300.004217')), '300.004217')
  assert.equal(toMicro('0.05'), 50_000n)
  const a = uniquePayAmount(300, new Set(), () => 0.5)
  assert.equal(a, '300.005500')
  assert.ok(toMicro(a) - toMicro('300') < 10_000n)
})
