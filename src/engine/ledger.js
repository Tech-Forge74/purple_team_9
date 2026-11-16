// One place that turns raw group data into everything the screens show.
// Cards, settle-up, claims and the balance bot all read from this result.

import { computeNets, assertNets, rawPairs, treatCounts, suggestedPayer, breakdown } from './nets.js'
import { simplify } from './settle.js'

export function buildLedger({ group, expenses = [], payments = [] }) {
  const memberIds = (group?.members ?? []).map((m) => m.id)
  try {
    const nets = computeNets(memberIds, expenses, payments)
    assertNets(nets, memberIds)
    const plan = simplify(nets, memberIds)
    return {
      ok: true,
      memberIds,
      nets,
      plan,
      raw: rawPairs(expenses),
      treats: treatCounts(expenses),
      suggested: suggestedPayer(nets),
    }
  } catch {
    return { ok: false, memberIds, error: 'Balances did not add up, so nothing is shown. Please report this.' }
  }
}

// Breakdown lines for a member, checked against the net.
export function checkedBreakdown(memberId, data, ledger, nameOf) {
  const lines = breakdown(memberId, data.expenses, data.payments, nameOf)
  const sum = lines.reduce((a, l) => a + l.effect, 0)
  return { lines, ok: ledger.ok && sum === ledger.nets[memberId] }
}

// Assert the invariants a draft write would keep. Returns error text or null.
export function checkWrite(data, draft) {
  const next = {
    group: data.group,
    expenses: draft.expense ? [...data.expenses.filter((e) => e.id !== draft.expense.id), draft.expense] : data.expenses,
    payments: draft.payment ? [...data.payments.filter((p) => p.id !== draft.payment.id), draft.payment] : data.payments,
  }
  if (draft.expense && draft.expense.mode !== 'treat') {
    const sum = Object.values(draft.expense.splits).reduce((a, b) => a + b, 0)
    if (sum !== draft.expense.total) return 'Split does not add up. Nothing was saved.'
  }
  return buildLedger(next).ok ? null : 'Balances would not add up. Nothing was saved.'
}
