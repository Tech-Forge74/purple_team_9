import { describe, it, expect } from 'vitest'
import { computeSplit, MODES } from './split.js'
import { computeNets, breakdown } from './nets.js'
import { simplify } from './settle.js'

// Seeded PRNG so failures are reproducible (tests only, never in the app).
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

describe('property: 1,000 random groups', () => {
  it('keeps splits exact, nets at zero, and settle-up clears every net', () => {
    const rand = rng(42)
    const int = (a, b) => a + Math.floor(rand() * (b - a + 1))
    for (let g = 0; g < 1000; g++) {
      const members = Array.from({ length: int(2, 8) }, (_, i) => `m${i}`)
      const expenses = []
      for (let k = 0; k < int(1, 12); k++) {
        const ticked = members.filter(() => rand() < 0.7)
        if (!ticked.length) ticked.push(members[0])
        const payer = members[int(0, members.length - 1)]
        const total = int(1, 10000000)
        const mode = MODES[int(0, MODES.length - 1)]
        const input = { total, payer, participants: ticked, mode, members }
        if (mode === 'my_part') {
          if (!ticked.includes(payer)) ticked.push(payer)
          input.own = int(0, total - 1)
        }
        if (mode === 'custom') {
          const id = ticked[int(0, ticked.length - 1)]
          input.custom = { [id]: int(0, ticked.length === 1 ? total : total) }
          if (ticked.length === 1) input.custom[id] = total
        }
        const a = computeSplit(input)
        const b = computeSplit(input)
        expect(a).toEqual(b) // deterministic
        if (!a.ok) continue
        const s = Object.values(a.splits)
        if (mode !== 'treat') expect(s.reduce((x, y) => x + y, 0)).toBe(total)
        expect(s.every((v) => Number.isSafeInteger(v) && v >= 0)).toBe(true)
        expenses.push({ id: `e${k}`, title: 't', mode, total, paidBy: payer, splits: a.splits })
      }
      const nets = computeNets(members, expenses, [])
      expect(Object.values(nets).reduce((x, y) => x + y, 0)).toBe(0)
      for (const id of members) {
        expect(breakdown(id, expenses, []).reduce((x, l) => x + l.effect, 0)).toBe(nets[id])
      }
      const plan = simplify(nets, members)
      expect(plan).toEqual(simplify(nets, members))
      expect(plan.length).toBeLessThanOrEqual(Math.max(0, members.length - 1))
      const pays = plan.map((p, i) => ({ id: `p${i}`, ...p, status: 'paid' }))
      const after = computeNets(members, expenses, pays)
      expect(Object.values(after).every((v) => v === 0)).toBe(true)
    }
  })
})
