// Writes the demo history to Walrus Memory Mainnet in the exact format the app uses.
// Every seeded memory carries `seed: true` so /proof and the README can disclose it.
// Usage: node --env-file=.env.local scripts/seed.mjs [--dry]
// NOTE: the ic:main: namespaces were seeded once on 2026-11-02 (before amounts were made deterministic).
// Re-running against the same prefix would add duplicates; use MEMWAL_NS_PREFIX=ic:demo2: for a fresh copy.
import { MemWal } from '@mysten-incubation/memwal'
import { encode, clientNs } from '../server/memory.mjs'
import { uniquePayAmount, isoDay } from '../server/engine.mjs'

const DAY = 86_400_000
const at = (day, h = 10) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`).toISOString()
const plus = (day, n) => isoDay(new Date(`${day}T00:00:00Z`).getTime() + n * DAY)
const items = []
const add = (client, sentence, tag) => items.push({ namespace: clientNs(client), text: encode(sentence, { v: 1, seed: true, ...tag }) })
const taken = new Set()
// deterministic amounts => identical items => re-running is a no-op thanks to the derived idempotency key
let seedState = 42
const rnd = () => ((seedState = (seedState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

function client(id, name) {
  add(id, `New client ${name} added.`, { type: 'client_created', client: id, name, at: at('2026-08-01') })
}
function history(id, name, inv, base, issued, due, { delay, reminders = [], partialPct = 0 }) {
  const pay = uniquePayAmount(base, taken, rnd)
  taken.add(pay)
  add(id, `Invoice ${inv} sent to ${name}: ${pay} USDC due ${due}.`, { type: 'invoice_sent', client: id, invoice: inv, base, pay_amount: pay, due, at: at(issued) })
  for (const [off, tone] of reminders) add(id, `Sent a ${tone} reminder to ${name} for ${inv} (due +${off}d).`, { type: 'reminder_sent', client: id, invoice: inv, tone, day_offset: off, at: at(plus(due, off), 9) })
  const paid = plus(due, delay)
  const received = partialPct ? (Number(pay) * (1 - partialPct / 100)).toFixed(6) : pay
  const last = reminders.at(-1)?.[1] || null
  add(
    id,
    partialPct ? `${name} underpaid ${inv}: ${received} of ${pay} USDC on ${paid}.` : `${name} paid ${inv} in full (${pay} USDC) on ${paid}, ${delay} day(s) after due, after ${reminders.length} reminder(s)${last ? `; last tone ${last}` : ''}.`,
    { type: partialPct ? 'invoice_partial' : 'invoice_paid', client: id, invoice: inv, due, paid, delay_days: delay, reminders: reminders.length, last_tone: last, expected: pay, received, digest: null, at: at(paid, 15) },
  )
}
function open(id, name, inv, base, issued, due, description) {
  const pay = uniquePayAmount(base, taken, rnd)
  taken.add(pay)
  add(id, `Invoice ${inv} sent to ${name}: ${pay} USDC due ${due}.`, { type: 'invoice_sent', client: id, invoice: inv, base, pay_amount: pay, due, description, at: at(issued) })
}

// Acme: always ~5 days late; friendly nudges do nothing, a formal one gets paid within 2 days.
client('c1', 'Acme Corp')
history('c1', 'Acme Corp', 'inv-081', 2400, '2026-08-05', '2026-08-20', { delay: 4, reminders: [[1, 'friendly'], [3, 'formal']] })
history('c1', 'Acme Corp', 'inv-086', 3100, '2026-08-28', '2026-09-12', { delay: 6, reminders: [[1, 'friendly'], [4, 'formal']] })
history('c1', 'Acme Corp', 'inv-090', 2800, '2026-09-20', '2026-10-05', { delay: 5, reminders: [[1, 'friendly'], [4, 'formal']] })
history('c1', 'Acme Corp', 'inv-095', 3500, '2026-10-01', '2026-10-15', { delay: 5, reminders: [[4, 'formal']] })
open('c1', 'Acme Corp', 'inv-101', 4200, '2026-10-27', '2026-11-05', 'Q4 design system & component library')

// Beta: pays on the due date, never needs chasing.
client('c2', 'Beta Ltd')
history('c2', 'Beta Ltd', 'inv-083', 1800, '2026-08-10', '2026-08-25', { delay: 0 })
history('c2', 'Beta Ltd', 'inv-089', 2200, '2026-09-10', '2026-09-25', { delay: 0 })
history('c2', 'Beta Ltd', 'inv-094', 2000, '2026-10-10', '2026-10-25', { delay: 0 })
open('c2', 'Beta Ltd', 'inv-102', 3250, '2026-10-29', '2026-11-08', 'Marketing site redesign')

// Gamma: ~2 days late after a friendly nudge, but tends to short-pay by ~10% (wire fees).
client('c3', 'Gamma LLC')
history('c3', 'Gamma LLC', 'inv-084', 4000, '2026-08-12', '2026-08-27', { delay: 2, reminders: [[1, 'friendly']], partialPct: 10 })
history('c3', 'Gamma LLC', 'inv-088', 3600, '2026-09-15', '2026-09-30', { delay: 2, reminders: [[1, 'friendly']] })
history('c3', 'Gamma LLC', 'inv-093', 4400, '2026-10-08', '2026-10-23', { delay: 3, reminders: [[1, 'friendly']], partialPct: 10 })
open('c3', 'Gamma LLC', 'inv-103', 5000, '2026-10-31', '2026-11-09', 'Brand photography & retouching')

// Delta: brand new client, no history -> default behaviour.
client('c4', 'Delta Studio')
open('c4', 'Delta Studio', 'inv-104', 1800, '2026-11-02', '2026-11-12', 'Pitch deck design')

console.log(`${items.length} memories across ${new Set(items.map((i) => i.namespace)).size} namespaces`)
if (process.argv.includes('--dry')) {
  for (const i of items) console.log(i.namespace, '|', i.text.split('\n')[0])
  process.exit(0)
}
const mw = MemWal.create({ key: process.env.MEMWAL_PRIVATE_KEY, accountId: process.env.MEMWAL_ACCOUNT_ID, serverUrl: process.env.MEMWAL_SERVER_URL || 'https://relayer.memory.walrus.xyz' })
for (let i = 0; i < items.length; i += 20) {
  const chunk = items.slice(i, i + 20) // relayer bulk limit is 20
  const t = Date.now()
  let r
  for (let attempt = 1; ; attempt++) {
    try {
      r = await mw.rememberBulkAndWait(chunk) // idempotency key is derived from the items, so retries are safe
      break
    } catch (e) {
      if (attempt >= 5) throw e
      console.log(`attempt ${attempt} failed (${e.status || ''} ${e.phase || e.message}); retrying in 15 s`)
      await new Promise((ok) => setTimeout(ok, 15_000))
    }
  }
  const res = r.results || r
  const failed = res.filter((x) => x.status !== 'done')
  console.log(`chunk ${i / 20 + 1}: ${res.length - failed.length}/${chunk.length} stored in ${((Date.now() - t) / 1000).toFixed(1)} s`, failed.length ? failed : '')
}
