// node --test server/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveState, computeProfile, plan, parsePreference, applyConstraints, uniquePayAmount, isoDay, learningSummary } from './engine.mjs'
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

test('a revoked rule stops shaping the plan; saving it again revives it', () => {
  const rule = mem('2026-10-20T00:00:00Z', { type: 'preference', client: 'acme', note: 'never before the 10th' })
  const revoke = mem('2026-10-21T00:00:00Z', { type: 'rule_revoked', client: 'acme', rule: 'never before the 10th' })
  const p = computeProfile('acme', [...acme, rule, revoke])
  assert.deepEqual(p.preferences, [])
  assert.deepEqual(p.revokedRules, ['never before the 10th'])
  assert.notEqual(plan({ dueDate: '2026-11-03' }, p).steps[0].date, '2026-11-10')
  const again = mem('2026-10-22T00:00:00Z', { type: 'preference', client: 'acme', note: 'never before the 10th' })
  const p2 = computeProfile('acme', [...acme, rule, revoke, again])
  assert.equal(plan({ dueDate: '2026-11-03' }, p2).steps[0].date, '2026-11-10')
  assert.deepEqual(p2.revokedRules, [])
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

test('partial payments accumulate into a remaining balance, then paid', () => {
  const s = new Map([['n', [
    mem('2026-10-01T00:00:00Z', { type: 'invoice_sent', client: 'g', invoice: 'i9', base: 100, pay_amount: '100.004000', due: '2026-10-05' }),
    mem('2026-10-06T00:00:00Z', { type: 'invoice_partial', client: 'g', invoice: 'i9', received: '90.000000', digest: 'A' }),
  ]]])
  let inv = deriveState(s).invoices[0]
  assert.equal(inv.status, 'partial')
  assert.equal(inv.remaining, '10.004000')
  s.get('n').push(mem('2026-10-08T00:00:00Z', { type: 'invoice_partial', client: 'g', invoice: 'i9', received: '10.004000', digest: 'B' }))
  inv = deriveState(s).invoices[0]
  assert.equal(inv.status, 'paid')
  assert.equal(inv.payments.length, 2)
  assert.doesNotThrow(() => JSON.stringify(inv))
  // the same payment memory loaded twice (local copy + recalled twin) must not double-count
  s.get('n').push(mem('2026-10-08T00:00:00Z', { type: 'invoice_partial', client: 'g', invoice: 'i9', received: '10.004000', digest: 'B' }))
  assert.equal(deriveState(s).invoices[0].payments.length, 2)
  // the profile sees ONE paid invoice (short-paid at first), not two
  const prof = computeProfile('g', s.get('n').map((m) => ({ ...m, tag: { ...m.tag, delay_days: 1, paid: m.timestamp.slice(0, 10) } })))
  assert.equal(prof.totalPaidInvoices, 1)
  assert.equal(prof.history.length, 1)
  assert.equal(prof.underpayRate, 100)
})

test('learning summary: error on first prediction vs latest', () => {
  const l = learningSummary([computeProfile('acme', acme)])
  assert.deepEqual(l, { clients: 1, firstError: 5, latestError: 0, predictions: 3 })
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

test('overpayments add up to an exact client credit', () => {
  const p = computeProfile('acme', [...acme, mem('2026-10-30T00:00:00Z', { type: 'invoice_paid', client: 'acme', invoice: 'inv-9', paid: '2026-10-30', delay_days: 0, overpaid: '0.100001' }), mem('2026-10-31T00:00:00Z', { type: 'invoice_paid', client: 'acme', invoice: 'inv-10', paid: '2026-10-31', delay_days: 0, overpaid: '0.2' })])
  assert.equal(p.creditUsdc, '0.300001')
  assert.equal(computeProfile('acme', acme).creditUsdc, '0.000000')
})

test('a client past 100 memories is sharded so recall still returns all of it', async () => {
  const mem = await import('./memory.mjs')
  const base = mem.clientNs('shardtest')
  const m = (i) => ({ id: `x${i}`, sentence: `e${i}`, tag: { type: 'note' }, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })
  assert.equal(mem.writeNs('shardtest'), base) // brand-new client
  mem.store.set(base, Array.from({ length: mem.SHARD_MAX }, (_, i) => m(i)))
  mem.store.set(`${mem.clientNs('shardtest2')}`, [m(999)]) // a different client whose id shares the prefix
  assert.equal(mem.writeNs('shardtest'), `${base}/1`)
  mem.store.set(`${base}/1`, [m(500)])
  mem.store.set(`${base}/x`, [m(501)]) // not a shard
  assert.deepEqual(mem.clientShards('shardtest'), [base, `${base}/1`])
  assert.equal(mem.writeNs('shardtest'), `${base}/1`)
  const all = mem.clientMemories('shardtest')
  assert.equal(all.length, mem.SHARD_MAX + 1)
  assert.equal(all[0].sentence, 'e500') // newest first across shards
  for (const k of [base, `${base}/1`, `${base}/x`, mem.clientNs('shardtest2')]) mem.store.delete(k)
})

test('early payers are learned as early (negative delay), and the plan still never chases before due', () => {
  const early = [
    mem('2026-09-01T10:00:00Z', { type: 'client_created', client: 'e', name: 'Early Co' }),
    ...['2026-09-10', '2026-09-25', '2026-10-10'].map((due, i) => mem(`${isoDay(new Date(due).getTime() - 4 * 86400000)}T12:00:00Z`, { type: 'invoice_paid', client: 'e', invoice: `e${i}`, due, paid: isoDay(new Date(due).getTime() - 4 * 86400000), delay_days: -4, reminders: 0 })),
  ]
  const p = computeProfile('e', early)
  assert.equal(p.ewmaDelayDays, -4)
  assert.equal(p.reliabilityBadge, 'Pays Early')
  const pl = plan({ dueDate: '2026-11-05' }, p)
  assert.equal(pl.predictedPayDate, '2026-11-05') // clamped to due, never before
  assert.ok(pl.steps[0].date > '2026-11-05')
  assert.match(pl.memoriesUsed[0], /early, ~4 day/)
})

test('an invoice still partially paid does not teach a pay delay (it has not been settled yet)', () => {
  const ms = [
    mem('2026-10-01T00:00:00Z', { type: 'invoice_sent', client: 'd', invoice: 'a', base: 10, pay_amount: '10.000100', due: '2026-10-05' }),
    mem('2026-10-05T00:00:00Z', { type: 'invoice_paid', client: 'd', invoice: 'a', received: '10.000100', digest: 'X', delay_days: 0, paid: '2026-10-05' }),
    mem('2026-11-01T00:00:00Z', { type: 'invoice_sent', client: 'd', invoice: 'b', base: 10, pay_amount: '10.000200', due: '2026-11-12' }),
    mem('2026-11-04T00:00:00Z', { type: 'invoice_partial', client: 'd', invoice: 'b', received: '3.000000', digest: 'Y', delay_days: -8, paid: '2026-11-04' }),
  ]
  const p = computeProfile('d', ms)
  assert.deepEqual(p.history.map((h) => h.invoice), ['a'])
  assert.equal(p.underpayRate > 0, true)
})

test('ledger tags are signed: a forged or altered tag after the cutoff is not trusted, legacy ones still are', async () => {
  const { encode, decode, TAG_MAC_FROM } = await import('./memory.mjs')
  const t = { type: 'invoice_paid', invoice: 'inv-1', received: '1.000000' }
  const after = '2026-12-01T00:00:00Z'
  assert.deepEqual(decode(encode('Acme paid', t), after), { sentence: 'Acme paid', tag: t })
  const forged = `Note\n#ic ${JSON.stringify(t)}`
  assert.equal(decode(forged, after), null)
  assert.deepEqual(decode(forged, '2026-11-01T00:00:00Z'), { sentence: 'Note', tag: t })
  assert.equal(decode(forged), null) // no relayer timestamp: not trusted
  const altered = encode('Acme paid', t).replace('1.000000', '500.000000')
  assert.equal(decode(altered, after), null)
  assert.ok(after > TAG_MAC_FROM)
})
