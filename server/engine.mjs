// Pure logic: no I/O. Everything here is derived from memories so it can be rebuilt from Walrus at any time.
// AI proposes (reminder text), code decides (when, which tone, what we predict).

const DAY = 86_400_000
// 6-decimal USDC strings <-> integer micro-units (engine-local so it stays pure)
const micro = (s) => {
  const [i, f = ''] = String(s).split('.')
  return BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6))
}
const unmicro = (m) => {
  const s = m.toString().padStart(7, '0')
  return `${s.slice(0, -6)}.${s.slice(-6)}`
}

// Portfolio-level evidence that the app learns: mean prediction error on each client's first
// invoice (predicted with no history) vs their latest one (only clients with >= 2 paid invoices).
export function learningSummary(profiles) {
  const xs = profiles.filter((p) => (p.history || []).length >= 2)
  if (!xs.length) return null
  const mean = (a) => Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10
  return { clients: xs.length, firstError: mean(xs.map((p) => p.history[0].error)), latestError: mean(xs.map((p) => p.history.at(-1).error)), predictions: xs.reduce((s, p) => s + p.history.length, 0) }
}

export const isoDay = (d) => {
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}
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
        seed: Boolean(t.seed), // demo history: a seeded short payment is closed history, not an open debt
      })
    } else if (t.type === 'reminder_sent' && invoices.has(t.invoice)) {
      invoices.get(t.invoice).reminders++
    } else if ((t.type === 'invoice_paid' || t.type === 'invoice_partial') && invoices.has(t.invoice)) {
      if (t.digest && usedDigests.has(t.digest)) continue // the same payment recorded twice counts once
      if (t.digest) usedDigests.add(t.digest)
      const inv = invoices.get(t.invoice)
      // amounts as integer micro-units so sums are exact; seeded history may lack `received`
      const got = t.received != null ? micro(t.received) : t.type === 'invoice_paid' ? micro(inv.payAmount) : 0n
      inv.receivedMicro = (inv.receivedMicro || 0n) + got
      inv.payments = [...(inv.payments || []), { digest: t.digest || null, received: t.received ?? null, paid: t.paid, payer: t.payer || null }]
      const full = t.type === 'invoice_paid' || inv.receivedMicro >= micro(inv.payAmount)
      Object.assign(inv, {
        status: full ? 'paid' : 'partial',
        digest: t.digest || inv.digest || null,
        settledAt: t.paid,
        partialAmount: full ? null : unmicro(inv.receivedMicro),
        remaining: full ? '0.000000' : unmicro(micro(inv.payAmount) - inv.receivedMicro),
      })
    } else if (t.type === 'payer_expected') {
      if (clients.has(t.client)) clients.get(t.client).expectedPayer = { address: t.payer, name: t.name || null }
    }
  }
  for (const inv of invoices.values()) delete inv.receivedMicro // bigint isn't JSON; `remaining` carries it
  return { clients: [...clients.values()], invoices: [...invoices.values()], usedDigests }
}

export function invoiceStatus(inv, now = new Date()) {
  if (inv.status === 'sent' && isoDay(now) > inv.dueDate) return 'overdue'
  return inv.status
}

// ---- Learned profile ------------------------------------------------------------------

export function computeProfile(clientId, memories) {
  // One entry per invoice: its latest payment event (a partial then a top-up is one invoice, not two),
  // remembering whether any part of it was short-paid.
  const byInvoice = new Map()
  for (const m of memories.filter((x) => x.tag?.type === 'invoice_paid' || x.tag?.type === 'invoice_partial').sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const prev = byInvoice.get(m.tag.invoice)
    byInvoice.set(m.tag.invoice, { ...m, shortPaid: Boolean(prev?.shortPaid || m.tag.type === 'invoice_partial') })
  }
  const pays = [...byInvoice.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const reminders = memories.filter((m) => m.tag?.type === 'reminder_sent')
  // Walrus is append-only: a rule is revoked by a later `rule_revoked` memory naming its text.
  // Saving the same rule again after a revocation makes it live again (newest event wins).
  const revokedAt = new Map()
  for (const m of memories) if (m.tag?.type === 'rule_revoked' && !(revokedAt.get(m.tag.rule) > m.timestamp)) revokedAt.set(m.tag.rule, m.timestamp)
  const live = (text, ts) => !(revokedAt.get(text) >= ts)
  const preferences = memories.filter((m) => m.tag?.type === 'preference' && live(m.tag.note, m.timestamp))
  const notes = memories.filter((m) => m.tag?.type === 'note' && live(m.sentence, m.timestamp))

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

  const underpays = pays.filter((p) => p.shortPaid).length
  const underpayRate = pays.length ? Math.round((underpays / pays.length) * 1000) / 10 : 0
  const remindersNeeded = pays.length ? Math.round((pays.reduce((s, p) => s + Number(p.tag.reminders || 0), 0) / pays.length) * 10) / 10 : 0

  let reliabilityBadge = 'Reliable'
  if (!pays.length) reliabilityBadge = 'New Client'
  else if (underpayRate > 5) reliabilityBadge = `Underpayer (~${Math.round(underpayRate)}%)`
  else if (median > 3) reliabilityBadge = 'Pays Late'
  else if (median <= -2) reliabilityBadge = 'Pays Early'

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
    preferences: [...preferences.map((p) => p.tag.note), ...notes.filter((n) => Object.keys(parsePreference(n.sentence)).length).map((n) => n.sentence)],
    notes: notes.map((n) => n.sentence),
    constraints: mergeConstraints([...preferences.map((p) => parsePreference(p.tag.note)), ...notes.map((n) => parsePreference(n.sentence))]),
    history,
    // the memories a plan is allowed to cite: recent payments + every rule
    evidence: [...pays.slice(-4).reverse(), ...preferences, ...notes.filter((n) => Object.keys(parsePreference(n.sentence)).length)].map((m) => ({ sentence: m.sentence, blobId: m.blobId || null, status: m.status || 'saved', at: m.timestamp })),
    memoryCount: memories.length,
    // overpayments are kept as a credit the client can draw on (exact micro-unit sum)
    creditUsdc: unmicro(memories.filter((m) => m.tag?.overpaid).reduce((a, m) => a + micro(m.tag.overpaid), 0n)),
    revokedRules: [...revokedAt.keys()].filter((r) => !preferences.some((p) => p.tag.note === r) && !notes.some((n) => n.sentence === r)),
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
  // "never/no/don't … Friday" => don't remind that day; "only … Thursday(s)" => that is when they pay.
  // The negation must sit close to the day name so "only Thursdays, never before the 15th" is not misread.
  const near = (words, d) => new RegExp(`\\b(${words})\\b[^.,;]{0,25}\\b${d}s?\\b`).test(t)
  const skip = WEEKDAYS.map((d, i) => (near("never|no|don'?t|not|avoid|skip", d) ? i : -1)).filter((i) => i >= 0)
  const only = WEEKDAYS.map((d, i) => (new RegExp(`\\bonly\\b[^.,;]{0,40}\\b${d}s?\\b`).test(t) ? i : -1)).filter((i) => i >= 0)
  if (skip.length) c.skipWeekdays = [...new Set([...(c.skipWeekdays || []), ...skip])]
  if (only.length) c.payWeekdays = only
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
    payWeekdays: [...new Set([...(acc.payWeekdays || []), ...(c.payWeekdays || [])])],
  }), {})
}
export function nextWeekday(date, weekdays) {
  let d = new Date(date)
  for (let i = 0; i < 7 && !weekdays.includes(d.getUTCDay()); i++) d = addDays(d, 1)
  return d
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
    // Even with no payment history, the client's stated rules are memories and still apply.
    const c = ignoreMemory ? {} : profile?.constraints || {}
    const step = (off, tone, reason) => {
      const d = applyConstraints(addDays(due, off), c)
      return { dayOffset: Math.round((d - due) / DAY), date: isoDay(d), tone: c.forceTone || tone, reason }
    }
    const rules = !ignoreMemory && profile?.preferences?.length ? [`Your rules: ${profile.preferences.join('; ')}`] : []
    const payDay = !ignoreMemory && c.payWeekdays?.length ? nextWeekday(due, c.payWeekdays) : null
    return {
      type: 'default',
      predictedPayDate: payDay ? isoDay(payDay) : null,
      predictedDelayDays: payDay ? Math.round((payDay - due) / DAY) : null,
      steps: [step(1, 'friendly', 'Default: friendly nudge the day after due'), step(5, 'formal', 'Default: formal follow-up'), step(10, 'firm', 'Default: firm final notice')],
      memoriesUsed: ignoreMemory ? ['Memory ignored for comparison.'] : ['No payment history yet: default schedule, adjusted to the rules below.', ...rules],
      cites: ignoreMemory ? [] : profile?.evidence || [],
    }
  }
  const c = profile.constraints || {}
  let delay = Math.max(0, Math.round(profile.ewmaDelayDays))
  let predicted = addDays(due, delay)
  // "they only pay on Thursdays": the payment lands on the next allowed weekday
  if (c.payWeekdays?.length) {
    predicted = nextWeekday(predicted, c.payWeekdays)
    delay = Math.round((predicted - due) / DAY)
  }
  const tone = c.forceTone || profile.bestTone
  const used = [
    `Pays ${profile.ewmaDelayDays <= -1 ? `early, ~${Math.round(-profile.ewmaDelayDays)} day(s) before due (no reminder before due)` : delay === 0 ? 'on time' : `~${delay} day(s) after due`} (EWMA over ${profile.totalPaidInvoices} paid invoice(s), confidence ${Math.round(profile.confidence * 100)}%).`,
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
  return { type: 'adaptive', predictedPayDate: isoDay(predicted), predictedDelayDays: delay, steps, memoriesUsed: used, cites: profile.evidence || [] }
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

// RFC 5545 §3.1: content lines longer than 75 octets are folded (CRLF + one space), never inside a UTF-8 character.
export function foldIcs(line) {
  const out = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  out.push(cur)
  return out.join('\r\n ')
}
