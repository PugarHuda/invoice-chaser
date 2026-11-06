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
export function deriveState(store, now = new Date()) {
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
        quotes: [{ amount: t.pay_amount, at: m.timestamp }], // every amount this invoice was ever quoted at
      })
    } else if (t.type === 'reminder_sent' && invoices.has(t.invoice)) {
      invoices.get(t.invoice).reminders++
    } else if ((t.type === 'invoice_paid' || t.type === 'invoice_partial') && invoices.has(t.invoice)) {
      if (t.digest && usedDigests.has(t.digest)) continue // the same payment recorded twice counts once
      if (t.digest) usedDigests.add(t.digest)
      const inv = invoices.get(t.invoice)
      // a discount only covers payments made by its deadline (chain time): a later one counts against the full amount
      if (inv.terms?.kind === 'early_discount' && !inv.terms.expired && t.type === 'invoice_partial' && (t.paid || isoDay(m.timestamp)) > inv.terms.until) {
        inv.payAmount = inv.terms.original
        inv.terms = { ...inv.terms, expired: true }
      }
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
    } else if (t.type === 'invoice_terms' && invoices.has(t.invoice)) {
      const inv = invoices.get(t.invoice)
      // terms only change an invoice nobody has paid into yet (the route refuses otherwise)
      if (inv.status === 'sent') {
        inv.terms = { kind: t.kind, pct: t.pct, until: t.until || null, original: inv.payAmount, amount: t.pay_amount, at: m.timestamp }
        inv.payAmount = t.pay_amount
        inv.quotes.push({ amount: t.pay_amount, at: m.timestamp, kind: t.kind, until: t.until || null })
      }
    } else if (t.type === 'payer_expected') {
      if (clients.has(t.client)) clients.get(t.client).expectedPayer = { address: t.payer, name: t.name || null }
    }
  }
  // an early-payment discount is an offer with a deadline: unpaid after it, the full amount is owed again
  // (a partly paid one too: the rest is then owed against the full amount)
  for (const inv of invoices.values())
    if (inv.terms?.kind === 'early_discount' && !inv.terms.expired && (inv.status === 'sent' || inv.status === 'partial') && isoDay(now) > inv.terms.until) {
      inv.payAmount = inv.terms.original
      inv.terms = { ...inv.terms, expired: true }
      if (inv.status === 'partial') {
        const left = micro(inv.payAmount) - (inv.receivedMicro || 0n)
        inv.remaining = unmicro(left > 0n ? left : 0n)
      }
    }
  for (const inv of invoices.values()) delete inv.receivedMicro // bigint isn't JSON; `remaining` carries it
  return { clients: [...clients.values()], invoices: [...invoices.values()], usedDigests }
}

// The amount this invoice asked for at chain time `ts`: the newest quote issued by then, skipping a
// discount whose deadline had passed. A payment of exactly that amount pays the invoice in full, even
// if the terms changed before anyone verified it.
export function quoteAt(inv, ts) {
  const qs = (inv.quotes || []).filter((q) => q.at <= ts)
  for (let i = qs.length - 1; i >= 0; i--) if (!(qs[i].kind === 'early_discount' && isoDay(ts) > qs[i].until)) return qs[i].amount
  return null
}
export const quotedAmounts = (inv) => [...new Set((inv.quotes || []).map((q) => q.amount))]

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
  // Delay is learned only from invoices that are finished: an invoice still partially paid has no
  // "paid on" yet (its first instalment date is not when the client settled), so it would skew the
  // prediction. Partials still count for short-payment and tone statistics below.
  // A top-up is also recorded as invoice_partial, so "finished" = everything received covers the
  // invoice (each payment counted once by digest), not the type of the last event.
  const owedMicro = new Map(memories.filter((m) => m.tag?.type === 'invoice_sent').map((m) => [m.tag.invoice, micro(m.tag.pay_amount)]))
  // a late fee changes what "paid in full" means. A discount does not: paid in time it settles as
  // invoice_paid (finished either way); paid late it is a partial against the full amount, as in deriveState.
  for (const m of memories.filter((x) => x.tag?.type === 'invoice_terms' && x.tag.kind === 'late_fee' && owedMicro.has(x.tag.invoice)).sort((x, y) => x.timestamp.localeCompare(y.timestamp))) owedMicro.set(m.tag.invoice, micro(m.tag.pay_amount))
  const gotMicro = new Map()
  const seenDigest = new Set()
  for (const m of memories) {
    const t = m.tag || {}
    if ((t.type !== 'invoice_paid' && t.type !== 'invoice_partial') || !t.received) continue
    if (t.digest && seenDigest.has(t.digest)) continue
    if (t.digest) seenDigest.add(t.digest)
    gotMicro.set(t.invoice, (gotMicro.get(t.invoice) || 0n) + micro(t.received))
  }
  const finished = (p) => p.tag.type === 'invoice_paid' || p.tag.seed || !owedMicro.has(p.tag.invoice) || (gotMicro.get(p.tag.invoice) || 0n) >= owedMicro.get(p.tag.invoice)
  const settled = pays.filter(finished)
  settled.forEach((p, i) => {
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
    totalPaidInvoices: settled.length,
    confidence: Math.min(1, settled.length / 4),
    reliabilityBadge,
    preferences: [...preferences.map((p) => p.tag.note), ...notes.filter((n) => Object.keys(parsePreference(n.sentence)).length).map((n) => n.sentence)],
    notes: notes.map((n) => n.sentence),
    constraints: mergeConstraints([...preferences.map((p) => parsePreference(p.tag.note)), ...notes.map((n) => parsePreference(n.sentence))]),
    history,
    // the memories a plan is allowed to cite: recent payments + every rule
    evidence: [...pays.slice(-4).reverse(), ...preferences, ...notes.filter((n) => Object.keys(parsePreference(n.sentence)).length)].map((m) => ({ sentence: m.sentence, blobId: m.blobId || null, status: m.status || 'saved', at: m.timestamp })),
    memoryCount: memories.length,
    // overpayments are kept as a credit the client can draw on (exact micro-unit sum)
    creditUsdc: unmicro([...new Map(memories.filter((m) => m.tag?.overpaid).map((m) => [m.tag.digest || m.id || m.timestamp, m])).values()].reduce((a, m) => a + micro(m.tag.overpaid), 0n)),
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
  const fee = t.match(/late\s*fee[^0-9%.]{0,15}(\d+(?:\.\d+)?)\s*%/)
  if (fee) c.lateFeePct = Math.min(10, Number(fee[1]))
  if (/\bno\s+late\s*fees?\b|\bnever\b[^.,;]{0,20}late\s*fee/.test(t)) c.noLateFee = true
  if (/\bno\s+(?:early[-\s]*payment\s+)?discounts?\b/.test(t)) c.noDiscount = true
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
    const want = addDays(due, Math.max(1, delay - 1))
    const first = applyConstraints(want, c)
    // say so when a rule moved the reminder: it is then no longer "just before they usually pay"
    steps.push({ dayOffset: Math.round((first - due) / DAY), date: isoDay(first), tone, reason: isoDay(first) === isoDay(want) ? `One ${tone} reminder just before they usually pay` : `One ${tone} reminder; your rules moved it from ${isoDay(want)} to ${isoDay(first)}` })
    const second = applyConstraints(addDays(due, delay + 3), c)
    steps.push({ dayOffset: Math.round((second - due) / DAY), date: isoDay(second), tone: tone === 'firm' ? 'firm' : 'formal', reason: 'Escalate only if it is later than their usual pattern' })
  }
  return { type: 'adaptive', predictedPayDate: isoDay(predicted), predictedDelayDays: delay, steps, memoriesUsed: used, cites: profile.evidence || [] }
}

// ---- Payment incentive (learned, not guessed) ---------------------------------------------
// Code decides; the owner only approves. A client who reliably pays late (EWMA >= 5 days, confidence
// >= 50%) is offered a small early-payment discount before the due date, sized to their delay
// (1% per 5 days late, max 3%): cheaper than waiting. Once overdue past their own usual delay + 3 days,
// a late fee applies: the client's stated rate if a rule names one, else 1.5% per started 30 days.
// Never both, never on a paid/partial invoice, and a "no late fees" / "no discounts" rule wins.
export function incentive(inv, profile, now = new Date()) {
  const none = (reason) => ({ kind: null, reason })
  if (inv.status === 'paid' || inv.status === 'partial') return none('Only an unpaid invoice gets new terms.')
  if (inv.terms && !inv.terms.expired) return none(`Terms already applied: ${inv.terms.kind === 'early_discount' ? `${inv.terms.pct}% early-payment discount until ${inv.terms.until}` : `${inv.terms.pct}% late fee`}.`)
  const c = profile?.constraints || {}
  const today = isoDay(now)
  const daysToDue = Math.round((new Date(`${inv.dueDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / DAY)
  const delay = profile?.totalPaidInvoices ? Math.round(profile.ewmaDelayDays) : null
  const base = Number(inv.baseAmount)
  const cents = (x) => Math.round(x * 100) / 100
  if (daysToDue >= 1) {
    if (c.noDiscount) return none('Your rule for this client: no discounts.')
    if (delay == null || profile.confidence < 0.5) return none('Not enough payment history to justify a discount yet.')
    if (delay < 5) return none(`Pays within ~${Math.max(0, delay)} day(s) of due: no discount needed.`)
    if (inv.terms?.expired) return none('An early-payment discount already expired on this invoice.')
    const pct = Math.min(3, Math.floor(delay / 5))
    return { kind: 'early_discount', pct, until: inv.dueDate, newBase: cents(base * (1 - pct / 100)), reason: `Usually pays ~${delay} days late (EWMA over ${profile.totalPaidInvoices} invoices): ${pct}% off if paid by ${inv.dueDate} costs less than waiting.` }
  }
  const overdue = -daysToDue
  const grace = Math.max(0, delay ?? 0) + 3
  if (c.noLateFee) return none('Your rule for this client: no late fees.')
  if (overdue <= grace) return none(`${overdue} day(s) overdue, within their usual pattern (+3 days grace): no fee yet.`)
  const pct = c.lateFeePct ?? Math.round(1.5 * Math.ceil(overdue / 30) * 10) / 10
  if (!(pct > 0)) return none('Your rule for this client sets the late fee to 0%.')
  return { kind: 'late_fee', pct, newBase: cents(base * (1 + pct / 100)), reason: `${overdue} days overdue, past their usual ${Math.max(0, delay ?? 0)}-day delay + 3 days grace: ${c.lateFeePct != null ? `your stated ${pct}% late fee` : `1.5% per started 30 days (${pct}%)`}.` }
}

// Unique payable amount: base + random micro-suffix so an on-chain transfer maps to exactly one invoice.
// Adds 1000–9999 micro-USDC (< 0.01 USDC) on top of the base amount.
export function uniquePayAmount(base, taken = new Set(), rnd = Math.random) {
  const cents = Math.round(Number(base) * 100) // base is priced in cents
  for (let tries = 0; tries < 200; tries++) {
    const micro = BigInt(cents) * 10_000n + BigInt(Math.floor(rnd() * 9000) + 1000)
    const s = micro.toString().padStart(7, '0')
    const amt = `${s.slice(0, -6)}.${s.slice(-6)}`
    if (!taken.has(amt)) return amt
  }
  throw Object.assign(new Error('No unique amount left for this price; change the amount by a cent'), { status: 409, expose: true })
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
