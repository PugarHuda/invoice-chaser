// Reminder drafting with an LLM through Vercel AI Gateway (OIDC on Vercel, no key in code).
// The model only writes words; the schedule, tone and amounts are decided by the engine and passed in.
import { generateText } from 'ai'

const MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-haiku-5.5'

const TEMPLATES = {
  friendly: (n, inv) => `Hi ${n}, just a friendly reminder that invoice ${inv.id} (${inv.owed} USDC) was due on ${inv.dueDate}. Thanks!`,
  formal: (n, inv) => `Dear ${n}, our records show invoice ${inv.id} for ${inv.owed} USDC, due ${inv.dueDate}, is outstanding. Kindly arrange payment at your earliest convenience.`,
  firm: (n, inv) => `${n}, invoice ${inv.id} (${inv.owed} USDC) is now significantly overdue. Please settle it within 2 business days.`,
}

/**
 * @param {{ client: string, tone: 'friendly'|'formal'|'firm', invoice: { id: string, owed: string, dueDate: string, description?: string },
 *           payLink: string, facts: string[] }} input  facts = recalled memories (sentences) the plan relied on
 */
export async function draftReminder(input) {
  const { client, tone, invoice, payLink, facts } = input
  if (!process.env.VERCEL_OIDC_TOKEN && !process.env.AI_GATEWAY_API_KEY) {
    return { text: `${TEMPLATES[tone](client, invoice)}\nPay here: ${payLink}`, source: 'template', reason: 'AI Gateway credentials not configured' }
  }
  try {
    const { text, usage } = await generateText({
      model: MODEL,
      maxOutputTokens: 220,
      temperature: 0.4,
      system:
        'You write short payment reminders for a freelancer to send to a client. Plain text, no subject line, at most 90 words. ' +
        'Use exactly the requested tone. Mention the invoice id, the amount in USDC, the due date and the pay link exactly as given. ' +
        'You may use the facts about this client to be considerate (e.g. their payment rhythm or rules) but never reveal internal scores, ' +
        'predictions or that you remember them. Never invent amounts, dates or links.',
      prompt: JSON.stringify({ client, tone, invoice, payLink, factsAboutClient: facts.slice(0, 8) }),
    })
    const out = text.trim()
    // the money and the link must survive verbatim; otherwise fall back rather than send something wrong
    if (!out.includes(invoice.owed) || !out.includes(payLink)) {
      return { text: `${TEMPLATES[tone](client, invoice)}\nPay here: ${payLink}`, source: 'template', reason: 'model output dropped the amount or link' }
    }
    return { text: out, source: 'llm', model: MODEL, usage }
  } catch (e) {
    return { text: `${TEMPLATES[tone](client, invoice)}\nPay here: ${payLink}`, source: 'template', reason: `AI Gateway: ${e.message}` }
  }
}
