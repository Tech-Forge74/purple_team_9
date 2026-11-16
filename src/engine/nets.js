// Balances are always derived from expenses and payments. Never stored.
// Positive net = owed money. Negative net = owes money.

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export const isLiveExpense = (e) => e && !e.deleted
export const isCountedPayment = (p) => p && (p.status === 'paid' || p.status === 'confirmed')

export function computeNets(memberIds, expenses = [], payments = []) {
  const nets = {}
  for (const id of memberIds) nets[id] = 0
  const add = (id, v) => { nets[id] = (nets[id] ?? 0) + v }
  for (const e of expenses) {
    if (!isLiveExpense(e) || e.mode === 'treat') continue
    add(e.paidBy, e.total)
    for (const [id, share] of Object.entries(e.splits || {})) add(id, -share)
  }
  for (const p of payments) {
    if (!isCountedPayment(p)) continue
    add(p.from, p.amount)
    add(p.to, -p.amount)
  }
  return nets
}

// Throws if the nets are not safe integers, contain strangers, or do not sum to zero.
export function assertNets(nets, memberIds) {
  let sum = 0
  for (const [id, v] of Object.entries(nets)) {
    if (!Number.isSafeInteger(v)) throw new Error('INVARIANT: non-integer net')
    if (memberIds && !memberIds.includes(id)) throw new Error('INVARIANT: unknown member')
    sum += v
  }
  if (sum !== 0) throw new Error('INVARIANT: nets do not sum to zero')
  return true
}

export function treatCounts(expenses = []) {
  const out = {}
  for (const e of expenses) if (isLiveExpense(e) && e.mode === 'treat') out[e.paidBy] = (out[e.paidBy] ?? 0) + 1
  return out
}

// Member with the most negative net (ties broken by id). null if nobody owes.
export function suggestedPayer(nets) {
  let best = null
  for (const id of Object.keys(nets).sort(byId)) {
    if (nets[id] < 0 && (best === null || nets[id] < nets[best])) best = id
  }
  return best
}

// One line per expense or payment touching the member. Lines sum to the net.
export function breakdown(memberId, expenses = [], payments = [], nameOf = (id) => id) {
  const lines = []
  for (const e of expenses) {
    if (!isLiveExpense(e) || e.mode === 'treat') continue
    const paid = e.paidBy === memberId ? e.total : 0
    const share = e.splits?.[memberId] ?? 0
    if (!paid && !share) continue
    lines.push({ id: e.id, label: e.title, effect: paid - share, paid, share, kind: 'expense' })
  }
  for (const p of payments) {
    if (!isCountedPayment(p)) continue
    if (p.from === memberId) lines.push({ id: p.id, label: `Payment to ${nameOf(p.to)}`, effect: p.amount, kind: 'payment' })
    else if (p.to === memberId) lines.push({ id: p.id, label: `Payment from ${nameOf(p.from)}`, effect: -p.amount, kind: 'payment' })
  }
  return lines
}

// Every directed debt implied by the raw expenses (participant owes payer), merged by pair.
export function rawPairs(expenses = []) {
  const map = new Map()
  for (const e of expenses) {
    if (!isLiveExpense(e) || e.mode === 'treat') continue
    for (const [id, share] of Object.entries(e.splits || {})) {
      if (id === e.paidBy || share <= 0) continue
      const k = `${id}\u0000${e.paidBy}`
      map.set(k, (map.get(k) ?? 0) + share)
    }
  }
  return [...map.entries()]
    .map(([k, amount]) => { const [from, to] = k.split('\u0000'); return { from, to, amount } })
    .sort((a, b) => byId(a.from, b.from) || byId(a.to, b.to))
}
