// Balance assistant. Code computes every fact; the model may only rephrase it.
// Any reply is checked: every number and every member name must come from the facts.

import { formatINR } from '../money.js'
import { breakdown } from '../engine/nets.js'

const UNSAFE = /(https?:|www\.|upi:|:\/\/|\]\(|[<>`*_#|\\]|@)/i

// Template answers. Returns { text, amounts: [string], names: [string], rows? }
export function answer(intent, { meId, ledger, data, nameOf, targets = [] }) {
  const facts = { amounts: [], names: [] }
  const money = (p) => { const s = formatINR(p); facts.amounts.push(s); return s }
  const who = (id) => { const n = nameOf(id); facts.names.push(n); return n }
  const net = ledger.nets[meId] ?? 0
  const iOwe = ledger.plan.filter((p) => p.from === meId)
  const owedToMe = ledger.plan.filter((p) => p.to === meId)

  if (intent === 'next_payer') {
    if (!ledger.suggested) return { ...facts, text: 'Nobody owes anything right now, so anyone can pay next.' }
    return { ...facts, text: `${who(ledger.suggested)} should pay the next bill. They owe ${money(-ledger.nets[ledger.suggested])} overall.` }
  }

  if (intent === 'who_owes') {
    if (!owedToMe.length) return { ...facts, text: 'Nobody owes you anything right now.' }
    return { ...facts, text: owedToMe.map((p) => `${who(p.from)} owes you ${money(p.amount)}.`).join(' ') }
  }

  if (intent === 'settle_me') {
    if (!iOwe.length) return { ...facts, text: 'You do not owe anyone. You are all settled up.' }
    return { ...facts, text: 'Here is what you need to pay:', rows: iOwe }
  }

  if (intent === 'claim') {
    const rows = owedToMe.filter((p) => !targets.length || targets.includes(p.from))
    if (!rows.length) return { ...facts, text: 'Nobody in that list owes you money right now.' }
    return { ...facts, text: 'Here are draft claims. Each one is sent only when you tap Send.', claims: rows }
  }

  // explain_balance
  if (targets.length === 1 && targets[0] !== meId) {
    const other = targets[0]
    const owe = iOwe.find((p) => p.to === other)
    const lent = owedToMe.find((p) => p.from === other)
    const lines = breakdown(meId, data.expenses, data.payments, nameOf).slice(-5)
    const why = lines.map((l) => `${l.label} ${l.effect >= 0 ? '+' : ''}${money(l.effect)}`).join(', ')
    if (owe) return { ...facts, text: `You owe ${who(other)} ${money(owe.amount)}. Your recent lines: ${why}.` }
    if (lent) return { ...facts, text: `${who(other)} owes you ${money(lent.amount)}. Your recent lines: ${why}.` }
    return { ...facts, text: `You and ${who(other)} have nothing to settle directly.` }
  }
  if (net === 0) return { ...facts, text: 'You are all settled up.' }
  if (net < 0) {
    const parts = iOwe.map((p) => `${money(p.amount)} to ${who(p.to)}`).join(', ')
    return { ...facts, text: `You owe ${money(-net)} in total: ${parts}.` }
  }
  const parts = owedToMe.map((p) => `${who(p.from)} owes you ${money(p.amount)}`).join(', ')
  return { ...facts, text: `You are owed ${money(net)} in total: ${parts}.` }
}

// Checks a rephrased reply against the facts. Returns true only if it is safe to show.
export function checkReply(reply, facts, memberNames = []) {
  if (typeof reply !== 'string') return false
  const r = reply.trim()
  if (!r || r.length > 400 || UNSAFE.test(r)) return false
  const allowedNums = new Set()
  for (const a of facts.amounts) for (const n of a.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) allowedNums.add(n.replace(/,/g, ''))
  for (const n of r.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    if (!allowedNums.has(n.replace(/,/g, ''))) return false
  }
  const lower = r.toLowerCase()
  for (const name of memberNames) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower) && !facts.names.includes(name)) return false
  }
  return true
}
