import { describe, it, expect } from 'vitest'
import { newActivity } from './notify.js'

describe('newActivity', () => {
  const data = {
    expenses: [
      { id: 'e1', createdBy: 'a', createdAt: 10 },
      { id: 'e2', createdBy: 'b', createdAt: 10 },
      { id: 'e3', createdBy: 'b', createdAt: 5 },
      { id: 'e4', createdBy: 'b', createdAt: 20, deleted: true },
    ],
    payments: [
      { id: 'p1', createdBy: 'b', createdAt: 11, status: 'paid' },
      { id: 'p2', createdBy: 'b', createdAt: 11, status: 'undone' },
      { id: 'p3', createdBy: 'a', createdAt: 11, status: 'paid' },
    ],
  }

  it('only shows other people\'s live items newer than the last visit', () => {
    const r = newActivity(data, 'a', 6)
    expect(r.expenses.map((e) => e.id)).toEqual(['e2'])
    expect(r.payments.map((p) => p.id)).toEqual(['p1'])
  })

  it('handles missing data', () => {
    expect(newActivity(null, 'a', 0)).toEqual({ expenses: [], payments: [] })
  })
})
