// The chat pipeline: model (optional) -> strict schema -> validator -> engine.
// The model can only suggest a draft. If its output fails any check, the
// rule-based parser runs instead. Nothing here saves anything.

import { cleanText, LIMITS } from '../validate.js'
import { strictParse } from './schema.js'
import { parseFallback } from './fallback.js'
import { toDraft, firstName, REFUSAL } from './draft.js'
import { answer, checkReply } from './bot.js'

// ctx: { members, meId, ledger, data, nameOf }
// model: { parse(message, names), rephrase(facts) } or null
export async function runChat(input, ctx, model) {
  const sentence = cleanText(input).slice(0, LIMITS.CHAT_MAX)
  if (!sentence) return { type: 'question', text: 'Type an expense, like "Ravi paid 1200 for dinner".' }
  const active = ctx.members.filter((m) => !m.removed)
  const names = active.map((m) => firstName(m.name))
  const meName = firstName(ctx.members.find((m) => m.id === ctx.meId)?.name ?? '')
  const vctx = { sentence, members: ctx.members, meId: ctx.meId }

  let result = null
  let source = 'fallback'
  if (model) {
    const r = await model.parse(sentence, names)
    if (r.ok) {
      const parsed = strictParse(r.text)
      if (parsed.ok) {
        const d = toDraft(parsed.value, vctx, { checkDigits: true })
        if (d.type !== 'reject' && d.type !== 'refuse') { result = d; source = 'ai' }
      }
    }
  }
  if (!result) {
    const d = toDraft(parseFallback(sentence, names, meName), vctx, { checkDigits: true })
    result = d.type === 'reject' ? { type: 'question', text: 'I could not read that. Try: "Ravi paid 1200 for dinner, split between me and Sana".' } : d
  }
  if (result.type === 'refuse') return { type: 'refuse', text: REFUSAL }

  if (result.type === 'intent') {
    if (!ctx.ledger?.ok) return { type: 'question', text: 'Balances are not available right now.' }
    const a = answer(result.intent, { meId: ctx.meId, ledger: ctx.ledger, data: ctx.data, nameOf: ctx.nameOf, targets: result.targets })
    let text = a.text
    if (model && !a.rows && !a.claims) {
      const r = await model.rephrase(a.text)
      if (r.ok && checkReply(r.text, a, ctx.members.map((m) => m.name))) text = r.text.trim()
    }
    return { type: 'answer', intent: result.intent, text, rows: a.rows, claims: a.claims, source }
  }
  return { ...result, source }
}
