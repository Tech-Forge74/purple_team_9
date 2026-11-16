// Pure, deterministic split engine. No I/O, no Date, no randomness.
// All amounts are integer paise. computeSplit never throws.

import { LIMITS } from '../validate.js'

export const MODES = ['equal', 'my_part', 'full', 'custom', 'treat']

const isAmount = (n) => Number.isSafeInteger(n) && n >= 1 && n <= LIMITS.MAX_PAISE
const isNonNeg = (n) => Number.isSafeInteger(n) && n >= 0 && n <= LIMITS.MAX_PAISE
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// floor(total / n) each, leftover paise handed out one by one in sorted id order.
export function divideEqually(total, ids) {
  const sorted = [...ids].sort(byId)
  const out = {}
  if (!sorted.length) return out
  const base = Math.floor(total / sorted.length)
  let left = total - base * sorted.length
  for (const id of sorted) {
    out[id] = base + (left > 0 ? 1 : 0)
    if (left > 0) left--
  }
  return out
}

function checkIds(list, members, label) {
  if (!Array.isArray(list)) return `${label} must be a list.`
  if (list.some((x) => typeof x !== 'string' || !x)) return `${label} has an invalid member.`
  if (new Set(list).size !== list.length) return `${label} has a duplicate member.`
  if (members && list.some((x) => !members.includes(x))) return `${label} has someone who is not in the group.`
  return null
}

function dropZeros(splits) {
  const out = {}
  for (const k of Object.keys(splits).sort(byId)) if (splits[k] > 0) out[k] = splits[k]
  return out
}

function compute({ total, payer, participants, mode, own, custom, poster, members }) {
  if (!MODES.includes(mode)) return { ok: false, error: 'Unknown split mode.' }
  if (!isAmount(total)) {
    if (Number.isSafeInteger(total) && total > LIMITS.MAX_PAISE) return { ok: false, error: 'That amount is above the ₹1,00,000 limit.' }
    return { ok: false, error: 'Amount must be a positive number of rupees.' }
  }
  if (typeof payer !== 'string' || !payer) return { ok: false, error: 'Choose who paid.' }
  if (members && !members.includes(payer)) return { ok: false, error: 'The payer is not in the group.' }
  const bad = checkIds(participants, members, 'Split list')
  if (bad) return { ok: false, error: bad }

  if (mode === 'treat') return { ok: true, splits: {} }
  if (participants.length === 0) return { ok: false, error: 'Tick at least one person.' }

  if (mode === 'equal' || mode === 'full') {
    return { ok: true, splits: dropZeros(divideEqually(total, participants)) }
  }

  if (mode === 'my_part') {
    const who = poster ?? payer
    if (!participants.includes(who)) return { ok: false, error: 'Tick yourself to use "I pay my part".' }
    if (!isNonNeg(own)) return { ok: false, error: 'Enter your own share.' }
    if (own > total) return { ok: false, error: 'Your share is more than the bill.' }
    const others = participants.filter((p) => p !== who)
    if (!others.length) return { ok: false, error: 'Tick at least one other person.' }
    if (own === total) return { ok: false, error: 'Your share is the whole bill, so nobody else owes anything.' }
    const splits = { ...divideEqually(total - own, others), [who]: own }
    return { ok: true, splits: dropZeros(splits) }
  }

  // custom
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return { ok: false, error: 'Enter the custom amounts.' }
  const locked = Object.keys(custom)
  const badLocked = checkIds(locked, participants, 'Custom amounts')
  if (badLocked) return { ok: false, error: 'Custom amounts must be for ticked people.' }
  let sum = 0
  for (const id of locked) {
    if (!isNonNeg(custom[id])) return { ok: false, error: 'Custom amounts must be zero or more.' }
    sum += custom[id]
  }
  if (sum > total) return { ok: false, error: 'Custom amounts add up to more than the bill.' }
  const unlocked = participants.filter((p) => !locked.includes(p))
  if (!unlocked.length && sum !== total) return { ok: false, error: 'Custom amounts must add up to the bill.' }
  const splits = { ...divideEqually(total - sum, unlocked) }
  for (const id of locked) splits[id] = custom[id]
  return { ok: true, splits: dropZeros(splits) }
}

export function computeSplit(input) {
  try {
    const r = compute(input || {})
    if (!r.ok) return r
    const sum = Object.values(r.splits).reduce((a, b) => a + b, 0)
    if (input.mode !== 'treat' && sum !== input.total) return { ok: false, error: 'Split does not add up. Nothing was saved.' }
    if (Object.values(r.splits).some((v) => !Number.isSafeInteger(v) || v < 0)) return { ok: false, error: 'Invalid share.' }
    return r
  } catch {
    return { ok: false, error: 'Could not compute this split.' }
  }
}

// Remaining to assign in custom mode (for the live preview). Never negative-hidden.
export function customRemaining(total, custom) {
  const sum = Object.values(custom || {}).reduce((a, b) => a + (Number.isSafeInteger(b) ? b : 0), 0)
  return total - sum
}
