// Permission and amount rules for payments and claims. Pure functions.
// The UI hides buttons too, but these checks are what actually decide.

import { owedBetween } from './settle.js'

export const UNDO_MS = 5000

// A payment may be recorded only by the person who owes, up to what they owe now.
export function checkPayment({ me, from, to, amount, plan }) {
  if (me !== from) return 'Only the person who owes can mark this as paid.'
  if (from === to) return 'Invalid payment.'
  if (!Number.isSafeInteger(amount) || amount < 1) return 'Amount must be positive.'
  const owed = owedBetween(plan, from, to)
  if (owed === 0) return 'You do not owe this person anything right now.'
  if (amount > owed) return 'You cannot pay more than you owe.'
  return null
}

// A claim may be created only by the person owed, for what is owed right now.
export function claimAmount({ me, from, plan }) {
  return owedBetween(plan, from, me)
}

export function checkClaim({ me, from, plan, existing, now }) {
  if (me === from) return 'You cannot claim from yourself.'
  if (claimAmount({ me, from, plan }) === 0) return 'They do not owe you anything right now.'
  if (existing?.lastSentAt && now - existing.lastSentAt < 10 * 60 * 1000) {
    return 'You reminded them recently. Try again in a few minutes.'
  }
  return null
}

// Received / Not received: only the person who was paid, only on a payment to them.
export function canRespond(me, payment) {
  return Boolean(payment && payment.status === 'paid' && payment.to === me && payment.from !== me)
}

// Undo: only the author, only within 5 seconds, only an unconfirmed payment.
export function canUndo(me, payment, now) {
  return Boolean(payment && payment.status === 'paid' && payment.createdBy === me && now - payment.createdAt <= UNDO_MS)
}
