// Greedy debt simplification: at most (members - 1) payments.
// Pure, integer paise, ties broken by member id so output is always the same.

import { assertNets } from './nets.js'

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const order = (a, b) => b.v - a.v || byId(a.id, b.id)

export function simplify(nets, memberIds) {
  assertNets(nets, memberIds)
  const cr = []
  const db = []
  const out = []
  for (const id of Object.keys(nets).sort(byId)) {
    const v = nets[id]
    if (v > 0) cr.push({ id, v })
    else if (v < 0) db.push({ id, v: -v })
  }
  while (cr.length && db.length) {
    cr.sort(order)
    db.sort(order)
    const c = cr[0]
    const d = db[0]
    const amount = Math.min(c.v, d.v)
    out.push({ from: d.id, to: c.id, amount })
    c.v -= amount
    d.v -= amount
    if (c.v === 0) cr.shift()
    if (d.v === 0) db.shift()
  }
  // Post-conditions
  const positive = Object.values(nets).reduce((a, v) => a + (v > 0 ? v : 0), 0)
  const paid = out.reduce((a, p) => a + p.amount, 0)
  if (paid !== positive) throw new Error('INVARIANT: payments do not cover the debts')
  for (const p of out) {
    if (p.from === p.to || !Number.isSafeInteger(p.amount) || p.amount <= 0) throw new Error('INVARIANT: bad payment')
    if (memberIds && (!memberIds.includes(p.from) || !memberIds.includes(p.to))) throw new Error('INVARIANT: unknown member')
  }
  return out
}

// How much `from` currently owes `to` in the simplified plan (0 if nothing).
export function owedBetween(plan, from, to) {
  return plan.find((p) => p.from === from && p.to === to)?.amount ?? 0
}
