// Pure logic: no I/O. Everything here is derived from memories so it can be rebuilt from Walrus at any time.
// AI proposes (reminder text), code decides (when, which tone, what we predict).

const DAY = 86_400_000
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY)
const TONES = ['friendly', 'formal', 'firm']

// ---- State derived from memories --------------------------------------------------------

/** @param {Map<string, any[]>} store */
export function deriveState(store) {
  const clients = new Map()
  const invoices = new Map()
  const usedDigests = new Set() // every digest ever settled, even if a later payment replaced it on the invoice
  const all = [...store.values()].flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  for (const m of all) {
    const t = m.tag || {}
    if (t.type === 'client_created') {
      clients.set(t.client, { id: t.client, name: t.name, contact: t.contact || null, createdAt: m.timestamp })
    } else if (t.type === 'invoice_sent') {
      invoices.set(t.invoice, {
        id: t.invoice,
        clientId: t.client,
        baseAmount: Number(t.base),
        payAmount: t.pay_amount,
        dueDate: t.due,
        issuedDate: isoDay(m.timestamp),
        description: t.description || '',
        status: 'sent',
        digest: null,
        partialAmount: null,
        reminders: 0,
        createdAt: m.timestamp,
      })
    } else if (t.type === 'reminder_sent' && invoices.has(t.invoice)) {
      invoices.get(t.invoice).reminders++
    } else if ((t.type === 'invoice_paid' || t.type === 'invoice_partial') && invoices.has(t.invoice)) {
      if (t.digest) usedDigests.add(t.digest)
      Object.assign(invoices.get(t.invoice), {
        status: t.type === 'invoice_paid' ? 'paid' : 'partial',
        digest: t.digest || null,
        settledAt: t.paid,
        partialAmount: t.type === 'invoice_partial' ? t.received : null,
      })
    }
  }
  return { clients: [...clients.values()], invoices: [...invoices.values()], usedDigests }
}

export function invoiceStatus(inv, now = new Date()) {
  if (inv.status === 'sent' && isoDay(now) > inv.dueDate) return 'overdue'
  return inv.status
}

// ---- Learned profile ------------------------------------------------------------------

export function computeProfile(clientId, memories) {
  const pays = memories
    .filter((m) => m.tag?.type === 'invoice_paid' || m.tag?.type === 'invoice_partial')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const reminders = memories.filter((m) => m.tag?.type === 'reminder_sent')
  const preferences = memories.filter((m) => m.tag?.type === 'preference')

  let ewma = 0
  const delays = []
  const history = [] // prediction-vs-actual per paid invoice, for the learning chart
  pays.forEach((p, i) => {
    const d = Number(p.tag.delay_days ?? 0)
    history.push({ invoice: p.tag.invoice, n: i + 1, predicted: i === 0 ? 0 : Math.round(ewma), actual: d, error: Math.abs((i === 0 ? 0 : Math.round(ewma)) - d) })
    ewma = i === 0 ? d : 0.5 * d + 0.5 * ewma
    delays.push(d)
  })
  delays.sort((a, b) => a - b)
  const median = delays.length ? delays[Math.floor(delays.length / 2)] : 0

  const toneStats = Object.fromEntries(TONES.map((t) => [t, { hits: 0, total: 0, rate: 0 }]))
  for (const r of reminders) {
    const tone = TONES.includes(r.tag.tone) ? r.tag.tone : 'friendly'
    toneStats[tone].total++
    const hit = pays.some((p) => p.tag.invoice === r.tag.invoice && (new Date(p.tag.paid) - new Date(isoDay(r.timestamp))) / DAY <= 3 && p.tag.paid >= isoDay(r.timestamp))
    if (hit) toneStats[tone].hits++
  }
  for (const s of Object.values(toneStats)) s.rate = s.total ? Math.round((s.hits / s.total) * 100) : 0
  // Beta(1,1) posterior mean; untried tones score 0.5 so we still explore them in order
  const score = (s) => (s.hits + 1) / (s.total + 2)
  const bestTone = TONES.reduce((best, t) => (score(toneStats[t]) > score(toneStats[best]) ? t : best), 'friendly')

  const underpays = pays.filter((p) => p.tag.type === 'invoice_partial').length
  const underpayRate = pays.length ? Math.round((underpays / pays.length) * 1000) / 10 : 0
  const remindersNeeded = pays.length ? Math.round((pays.reduce((s, p) => s + Number(p.tag.reminders || 0), 0) / pays.length) * 10) / 10 : 0

  let reliabilityBadge = 'Reliable'
  if (!pays.length) reliabilityBadge = 'New Client'
  else if (underpayRate > 5) reliabilityBadge = `Underpayer (~${Math.round(underpayRate)}%)`
  else if (median > 3) reliabilityBadge = 'Pays Late'

  return {
    clientId,
    medianDelayDays: median,
    ewmaDelayDays: Math.round(ewma * 10) / 10,
    remindersNeeded,
    bestTone,
    toneStats,
    underpayRate,
    totalPaidInvoices: pays.length,
    confidence: Math.min(1, pays.length / 4),
    reliabilityBadge,
    preferences: preferences.map((p) => p.tag.note),
    constraints: mergeConstraints(preferences.map((p) => parsePreference(p.tag.note))),
    history,
    memoryCount: memories.length,
  }
}

// ---- Preferences -> hard constraints ------------------------------------------------------
// ponytail: regex parser for the three rules we demo; swap for an LLM extractor if users write freer text.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export function parsePreference(text = '') {
  const t = text.toLowerCase()
  const c = {}
  const before = t.match(/(?:before|until|till)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?/)
  if (before) c.notBeforeDayOfMonth = Number(before[1])
  if (/weekend/.test(t)) c.skipWeekdays = [0, 6]
  const days = WEEKDAYS.map((d, i) => (new RegExp(`\\b${d}s?\\b`).test(t) ? i : -1)).filter((i) => i >= 0)
  if (days.length && /(never|no|don'?t|not|avoid|skip)/.test(t)) c.skipWeekdays = [...new Set([...(c.skipWeekdays || []), ...days])]
  if (/formal/.test(t) && /(always|only|use|prefer)/.test(t)) c.forceTone = 'formal'
  if (/friendly|casual/.test(t) && /(always|only|use|prefer)/.test(t)) c.forceTone = 'friendly'
  return c
}
function mergeConstraints(list) {
  return list.reduce((acc, c) => ({
    ...acc,
    ...c,
    notBeforeDayOfMonth: Math.max(acc.notBeforeDayOfMonth || 0, c.notBeforeDayOfMonth || 0) || undefined,
    skipWeekdays: [...new Set([...(acc.skipWeekdays || []), ...(c.skipWeekdays || [])])],
  }), {})
}
export function applyConstraints(date, c = {}) {
  let d = new Date(date)
  for (let i = 0; i < 62; i++) {
    const tooEarly = c.notBeforeDayOfMonth && d.getUTCDate() < c.notBeforeDayOfMonth
    const badDay = c.skipWeekdays?.includes(d.getUTCDay())
    if (!tooEarly && !badDay) return d
    d = tooEarly ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), c.notBeforeDayOfMonth)) : addDays(d, 1)
  }
  return d
}

// ---- Reminder plan ------------------------------------------------------------------------

export function plan(inv, profile, { ignoreMemory = false } = {}) {
  const due = new Date(`${inv.dueDate}T00:00:00Z`)
  if (ignoreMemory || !profile || profile.totalPaidInvoices === 0) {
    return {
      type: 'default',
      predictedPayDate: null,
      predictedDelayDays: null,
      steps: [
        { dayOffset: 1, date: isoDay(addDays(due, 1)), tone: 'friendly', reason: 'Default: friendly nudge the day after due' },
        { dayOffset: 5, date: isoDay(addDays(due, 5)), tone: 'formal', reason: 'Default: formal follow-up' },
        { dayOffset: 10, date: isoDay(addDays(due, 10)), tone: 'firm', reason: 'Default: firm final notice' },
      ],
      memoriesUsed: ignoreMemory ? ['Memory ignored for comparison.'] : ['No payment history yet: using the default schedule.'],
    }
  }
  const c = profile.constraints || {}
  const delay = Math.max(0, Math.round(profile.ewmaDelayDays))
  const predicted = addDays(due, delay)
  const tone = c.forceTone || profile.bestTone
  const used = [
    `Pays ${delay === 0 ? 'on time' : `~${delay} day(s) after due`} (EWMA over ${profile.totalPaidInvoices} paid invoice(s), confidence ${Math.round(profile.confidence * 100)}%).`,
    `Best tone so far: ${profile.bestTone} (${profile.toneStats[profile.bestTone].hits}/${profile.toneStats[profile.bestTone].total} reminders followed by payment within 3 days).`,
  ]
  if (profile.preferences.length) used.push(`Your rules: ${profile.preferences.join('; ')}`)

  const steps = []
  if (delay === 0) {
    const d = applyConstraints(addDays(due, 2), c)
    steps.push({ dayOffset: Math.round((d - due) / DAY), date: isoDay(d), tone: c.forceTone || 'friendly', reason: 'Usually pays on time: no pre-emptive chasing, one check-in only if late' })
  } else {
    const first = applyConstraints(addDays(due, Math.max(1, delay - 1)), c)
    steps.push({ dayOffset: Math.round((first - due) / DAY), date: isoDay(first), tone, reason: `One ${tone} reminder just before they usually pay` })
    const second = applyConstraints(addDays(due, delay + 3), c)
    steps.push({ dayOffset: Math.round((second - due) / DAY), date: isoDay(second), tone: tone === 'firm' ? 'firm' : 'formal', reason: 'Escalate only if it is later than their usual pattern' })
  }
  return { type: 'adaptive', predictedPayDate: isoDay(predicted), predictedDelayDays: delay, steps, memoriesUsed: used }
}

// Unique payable amount: base + random micro-suffix so an on-chain transfer maps to exactly one invoice.
// Adds 1000–9999 micro-USDC (< 0.01 USDC) on top of the base amount.
export function uniquePayAmount(base, taken = new Set(), rnd = Math.random) {
  const cents = Math.round(Number(base) * 100) // base is priced in cents
  for (;;) {
    const micro = BigInt(cents) * 10_000n + BigInt(Math.floor(rnd() * 9000) + 1000)
    const s = micro.toString().padStart(7, '0')
    const amt = `${s.slice(0, -6)}.${s.slice(-6)}`
    if (!taken.has(amt)) return amt
  }
}
