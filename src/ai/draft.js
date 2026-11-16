// Turns parsed JSON (from the model or the fallback parser) into a draft.
// Names map to real member ids, amounts must appear in the user's sentence,
// and the engine computes the split. Nothing here saves anything.

import { validateTitle, validateName, LIMITS, CATEGORIES } from '../validate.js'
import { rupeesToPaise } from '../money.js'
import { computeSplit } from '../engine/split.js'
import { amountsInSentence } from './numbers.js'

export const REFUSAL = 'I can only add expenses and answer questions about your balances.'

const ME = ['me', 'i', 'myself']
const ALL = ['all', 'everyone', 'everybody', 'us']

export const firstName = (name) => String(name).split(/\s+/)[0]

// ctx: { sentence, members: [{id, name, removed}], meId }
export function resolveName(raw, ctx) {
  const n = String(raw ?? '').trim().toLowerCase()
  const active = ctx.members.filter((m) => !m.removed)
  if (ME.includes(n)) return { ids: [ctx.meId] }
  if (ALL.includes(n)) return { ids: active.map((m) => m.id) }
  const exact = active.filter((m) => m.name.toLowerCase() === n)
  if (exact.length === 1) return { ids: [exact[0].id] }
  const first = active.filter((m) => firstName(m.name).toLowerCase() === n)
  if (first.length === 1) return { ids: [first[0].id] }
  return { unknown: raw }
}

// Only echo an unknown name back if it is a clean name the user really typed.
function whoIs(name, sentence) {
  const v = validateName(String(name ?? ''))
  if (v.ok && String(sentence).toLowerCase().includes(v.value.toLowerCase())) {
    return `Who is ${v.value}? They are not in this group.`
  }
  return 'Someone you mentioned is not in this group.'
}

function amountCheck(rupees, sentenceSet, { allowZero = false } = {}) {
  if (typeof rupees !== 'number' || Number.isNaN(rupees)) return { error: 'I could not read the amount. Try writing it as digits, like 2400.' }
  if (rupees < 0) return { error: 'Amount must be positive.' }
  const p = rupeesToPaise(rupees)
  if (p === null) return { error: 'I could not read the amount. Try writing it as digits, like 2400.' }
  if (p === 0 && !allowZero) return { error: 'Amount must be positive.' }
  if (p > LIMITS.MAX_PAISE) return { error: 'That amount is above the ₹1,00,000 limit.' }
  if (sentenceSet && !sentenceSet.has(p)) return { reject: true }
  return { paise: p }
}

// opts.checkDigits: true for model output (amounts must appear in the sentence).
export function toDraft(parsed, ctx, opts = {}) {
  const sentenceSet = opts.checkDigits ? amountsInSentence(ctx.sentence) : null
  const q = (text) => ({ type: 'question', text })
  // A name the user typed gets a clarifying question. A name the model made up
  // (not in the sentence) means the model output is rejected.
  const unknownName = (name) => {
    const typed = String(ctx.sentence).toLowerCase().includes(String(name ?? '').trim().toLowerCase())
    if (opts.checkDigits && !typed) return { type: 'reject' }
    return q(whoIs(name, ctx.sentence))
  }

  if (!parsed || parsed.intent === 'unclear') return { type: 'refuse' }

  const resolveList = (list) => {
    const ids = []
    for (const n of list ?? []) {
      const r = resolveName(n, ctx)
      if (r.unknown !== undefined) return { unknown: r.unknown }
      for (const id of r.ids) if (!ids.includes(id)) ids.push(id)
    }
    return { ids }
  }

  if (parsed.intent !== 'add_expense') {
    const r = resolveList(parsed.participants)
    if (r.unknown !== undefined) return unknownName(r.unknown)
    return { type: 'intent', intent: parsed.intent, targets: r.ids }
  }

  // add_expense
  if (parsed.total_rupees === null) return q('How much was it? Try: "Ravi paid 1200 for dinner".')
  const t = amountCheck(parsed.total_rupees, sentenceSet)
  if (t.reject) return { type: 'reject' }
  if (t.error) return q(t.error)

  const people = resolveList(parsed.participants)
  if (people.unknown !== undefined) return unknownName(people.unknown)
  for (const c of parsed.custom ?? []) {
    const r = resolveName(c.name, ctx)
    if (r.unknown !== undefined || r.ids.length !== 1) return unknownName(c.name)
  }

  const mode = parsed.mode ?? 'equal'
  let payer = null
  if (parsed.payer === null) {
    if (mode === 'treat' || mode === 'full') payer = ctx.meId
    else return q('Who paid? Try: "Ravi paid 1200 for dinner".')
  } else {
    const r = resolveName(parsed.payer, ctx)
    if (r.unknown !== undefined) return unknownName(r.unknown)
    if (r.ids.length !== 1) return q('Who paid? Name one person.')
    payer = r.ids[0]
  }

  const activeIds = ctx.members.filter((m) => !m.removed).map((m) => m.id)
  let participants = people.ids.length ? people.ids : activeIds
  if (mode === 'full') { participants = activeIds; payer = ctx.meId }

  let own
  if (mode === 'my_part') {
    if (parsed.own_rupees === null) return q('What is your own share?')
    const o = amountCheck(parsed.own_rupees, sentenceSet, { allowZero: true })
    if (o.reject) return { type: 'reject' }
    if (o.error) return q(o.error)
    own = o.paise
    if (!participants.includes(ctx.meId)) participants = [...participants, ctx.meId]
  }

  let custom
  if (mode === 'custom') {
    custom = {}
    for (const c of parsed.custom ?? []) {
      const id = resolveName(c.name, ctx).ids[0]
      const a = amountCheck(c.rupees, sentenceSet, { allowZero: true })
      if (a.reject) return { type: 'reject' }
      if (a.error) return q(a.error)
      custom[id] = a.paise
    }
  }

  let title = 'Expense'
  if (parsed.title !== null) {
    const v = validateTitle(parsed.title)
    if (!v.ok) return opts.checkDigits ? { type: 'reject' } : q(v.error)
    title = v.value
  }
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'other'

  const split = computeSplit({
    total: t.paise, payer, participants, mode, own, custom, poster: ctx.meId, members: ctx.members.map((m) => m.id),
  })
  if (!split.ok) return q(split.error)

  return {
    type: 'expense',
    draft: { title, category, total: t.paise, paidBy: payer, participants, mode, own, custom, splits: split.splits },
  }
}
