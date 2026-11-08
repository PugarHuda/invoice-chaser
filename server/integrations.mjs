// Outbound integrations the owner opts into: email through their own SMTP account (e.g. Gmail with an
// App Password) and accounting sync to Xero (OAuth2, tokens in Upstash Redis because the app has no database).
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import { Redis } from '@upstash/redis'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------- email ----------
export const emailReady = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)
let transport
export async function sendEmail({ to, subject, text }) {
  if (!emailReady()) throw Object.assign(new Error('Email is not configured (SMTP_USER / SMTP_PASS)'), { status: 503 })
  if (!EMAIL_RE.test(to || '')) throw Object.assign(new Error('This client has no email address'), { status: 400 })
  const port = Number(process.env.SMTP_PORT || 465)
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  const info = await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject: subject.replace(/[\r\n]+/g, ' '), text })
  return { messageId: info.messageId, accepted: info.accepted.length }
}

// ---------- Xero ----------
// apps created after 2 March 2026 only get granular scopes
const XERO_SCOPES = 'openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read'
const TOKEN_KEY = 'ic:xero:tokens'
const redisUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const redisToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
export const xeroConfigured = () => Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && redisUrl() && redisToken())
let redis
const kv = () => (redis ??= new Redis({ url: redisUrl(), token: redisToken() }))

const sign = (s) => crypto.createHmac('sha256', process.env.XERO_CLIENT_SECRET).update(s).digest('base64url')
// OAuth state: expiry + nonce, MACed with the client secret, so only a connect started by the owner completes
export function xeroAuthUrl(redirectUri, now = Date.now()) {
  const payload = `${now + 10 * 60_000}.${crypto.randomBytes(8).toString('hex')}`
  const params = { response_type: 'code', client_id: process.env.XERO_CLIENT_ID, redirect_uri: redirectUri, scope: XERO_SCOPES, state: `${payload}.${sign(payload)}` }
  return `https://login.xero.com/identity/connect/authorize?${new URLSearchParams(params)}`
}
export function xeroStateValid(state, now = Date.now()) {
  const [exp, nonce, sig] = String(state || '').split('.')
  if (!exp || !nonce || !sig) return false
  const want = Buffer.from(sign(`${exp}.${nonce}`))
  const got = Buffer.from(sig)
  return want.length === got.length && crypto.timingSafeEqual(want, got) && Number(exp) > now
}

async function tokenCall(body) {
  const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
  const r = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Xero token: ${j.error || r.status}`)
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000 }
}

export async function xeroConnect(code, redirectUri) {
  const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  const r = await fetch('https://api.xero.com/connections', { headers: { authorization: `Bearer ${t.access_token}` } })
  const orgs = await r.json()
  if (!r.ok || !orgs.length) throw new Error('No Xero organisation was authorised')
  const saved = { ...t, tenantId: orgs[0].tenantId, tenantName: orgs[0].tenantName, connectionId: orgs[0].id, connectedAt: new Date().toISOString() }
  await kv().set(TOKEN_KEY, saved)
  return saved
}

// ponytail: no cross-instance lock on refresh; two instances refreshing at once rely on Xero's grace period for the old refresh token
async function xeroTokens() {
  const t = await kv().get(TOKEN_KEY)
  if (!t) return null
  if (t.expires_at - 60_000 > Date.now()) return t
  const fresh = { ...t, ...(await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh_token })) }
  await kv().set(TOKEN_KEY, fresh)
  return fresh
}

export async function xeroStatus() {
  if (!xeroConfigured()) return { configured: false, connected: false }
  const t = await kv().get(TOKEN_KEY)
  return { configured: true, connected: Boolean(t), tenantName: t?.tenantName || null, connectedAt: t?.connectedAt || null, lastSync: t?.lastSync || null }
}

export async function xeroDisconnect() {
  const t = await xeroTokens().catch(() => null)
  if (t?.connectionId) await fetch(`https://api.xero.com/connections/${t.connectionId}`, { method: 'DELETE', headers: { authorization: `Bearer ${t.access_token}` } }).catch(() => {})
  await kv().del(TOKEN_KEY)
}

async function xeroApi(t, path, init = {}) {
  const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${t.access_token}`, 'xero-tenant-id': t.tenantId, accept: 'application/json', 'content-type': 'application/json' },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detail = j.Elements?.flatMap((e) => e.ValidationErrors || []).map((v) => v.Message).join('; ') || j.Message || j.Detail || r.status
    throw new Error(`Xero ${path.split('?')[0]}: ${detail}`)
  }
  return j
}

const cents = (x) => Math.round(Number(x) * 100) / 100

// Pure: what to create and which payments to record, given app state and what Xero already has.
// Invoices are matched by InvoiceNumber = our invoice id, so a re-run never duplicates anything.
export function xeroPlan({ clients, invoices }, existing, { revenueCode, bankAccountId }) {
  const have = new Map(existing.map((x) => [x.InvoiceNumber, x]))
  const name = (id) => clients.find((c) => c.id === id)?.name || 'Unknown client'
  const create = []
  const payments = []
  for (const inv of invoices) {
    const total = cents(inv.baseAmount)
    if (!(total > 0)) continue
    const x = have.get(inv.id)
    if (!x) {
      create.push({
        Type: 'ACCREC',
        Contact: { Name: name(inv.clientId) },
        InvoiceNumber: inv.id,
        Reference: inv.seed ? 'USDC on Sui (seeded demo history)' : 'USDC on Sui',
        Date: inv.issuedDate,
        DueDate: inv.dueDate,
        LineAmountTypes: 'NoTax',
        LineItems: [{ Description: inv.description || `Invoice ${inv.id}`, Quantity: 1, UnitAmount: total, AccountCode: revenueCode }],
        Status: 'AUTHORISED',
      })
    }
    // ponytail: discount/late-fee terms are not mirrored as Xero line items; the payment is capped at the invoice total
    const target = inv.status === 'paid' ? total : inv.status === 'partial' ? Math.min(total, cents(inv.partialAmount)) : 0
    const paid = x ? Number(x.AmountPaid || 0) : 0
    const diff = cents(target - paid)
    if (diff > 0)
      payments.push({
        invoiceNumber: inv.id,
        Amount: diff,
        Date: (inv.settledAt || inv.dueDate).slice(0, 10),
        Reference: inv.digest ? `Sui ${inv.digest}` : inv.seed ? 'USDC (seeded demo history)' : 'USDC on Sui',
        Account: { AccountID: bankAccountId },
      })
  }
  return { create, payments }
}

export async function xeroSync(state) {
  const t = await xeroTokens()
  if (!t) throw Object.assign(new Error('Xero is not connected'), { status: 409 })
  const { Accounts } = await xeroApi(t, 'Accounts')
  const active = Accounts.filter((a) => a.Status === 'ACTIVE')
  const bank = active.find((a) => a.Type === 'BANK')
  const revenue = active.find((a) => a.Type === 'REVENUE' || a.Type === 'SALES')
  if (!bank || !revenue) throw new Error('The Xero organisation needs an active bank account and a revenue account')
  const ids = state.invoices.map((i) => i.id)
  const existing = []
  for (let i = 0; i < ids.length; i += 40) existing.push(...(await xeroApi(t, `Invoices?InvoiceNumbers=${encodeURIComponent(ids.slice(i, i + 40).join(','))}`)).Invoices)
  const plan = xeroPlan(state, existing.filter((x) => x.Status !== 'VOIDED' && x.Status !== 'DELETED'), { revenueCode: revenue.Code, bankAccountId: bank.AccountID })
  const created = plan.create.length ? (await xeroApi(t, 'Invoices', { method: 'POST', body: JSON.stringify({ Invoices: plan.create }) })).Invoices : []
  const byNumber = new Map([...existing, ...created].map((x) => [x.InvoiceNumber, x.InvoiceID]))
  const pays = plan.payments.map(({ invoiceNumber, ...p }) => ({ ...p, Invoice: { InvoiceID: byNumber.get(invoiceNumber) } }))
  if (pays.length) await xeroApi(t, 'Payments', { method: 'POST', body: JSON.stringify({ Payments: pays }) })
  const lastSync = { at: new Date().toISOString(), created: created.length, payments: pays.length, bank: bank.Name }
  await kv().set(TOKEN_KEY, { ...(await kv().get(TOKEN_KEY)), lastSync })
  return { tenant: t.tenantName, ...lastSync, invoices: ids.length }
}
