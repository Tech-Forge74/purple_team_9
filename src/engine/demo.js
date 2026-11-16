// "Goa Trip" demo seed. Pure: ids come from the caller so tests can fix them.

import { computeSplit } from './split.js'

export const DEMO_MEMBERS = [
  { name: 'Ankit', upiId: 'ankit@okhdfc' },
  { name: 'Ravi', upiId: 'ravi@ybl' },
  { name: 'Meera', upiId: 'meera@paytm' },
  { name: 'Sana', upiId: 'sana@oksbi' },
]

const ROWS = [
  ['Cab (last trip)', 1000, 'Ravi', 'equal', ['Ravi', 'Sana'], 'travel'],
  ['Hotel', 8000, 'Ravi', 'equal', null, 'stay'],
  ['Petrol', 2000, 'Ankit', 'equal', null, 'fuel'],
  ['Tickets', 1600, 'Meera', 'equal', null, 'fun'],
  ['Kayaking', 2400, 'Sana', 'equal', ['Ankit', 'Sana', 'Meera'], 'fun'],
  ['Chai', 300, 'Ankit', 'treat', null, 'food'],
]

// memberIds: { Ankit: id, ... }; newId(): string; now: number
export function buildDemoExpenses(groupId, memberIds, newId, now) {
  const all = Object.values(memberIds)
  return ROWS.map(([title, rupees, payerName, mode, who, category], i) => {
    const participants = who ? who.map((n) => memberIds[n]) : all
    const total = rupees * 100
    const paidBy = memberIds[payerName]
    const r = computeSplit({ total, payer: paidBy, participants, mode })
    if (!r.ok) throw new Error('demo seed invalid')
    return {
      id: newId(),
      groupId,
      title,
      category,
      total,
      paidBy,
      mode,
      participants,
      splits: r.splits,
      source: 'form',
      createdBy: paidBy,
      createdAt: now + i,
      deleted: false,
    }
  })
}
