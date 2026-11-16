import { describe, it, expect } from 'vitest'
import { simplify } from './settle.js'
import { computeNets } from './nets.js'
import { buildLedger } from './ledger.js'
import { buildDemoExpenses, DEMO_MEMBERS } from './demo.js'

function applyPlan(nets, plan) {
  const out = { ...nets }
  for (const p of plan) { out[p.from] += p.amount; out[p.to] -= p.amount }
  return out
}

describe('simplify', () => {
  it('a chain A→B 200, B→C 200 becomes A→C 200', () => {
    const exps = [
      { id: '1', mode: 'equal', total: 200, paidBy: 'B', splits: { A: 200 } },
      { id: '2', mode: 'equal', total: 200, paidBy: 'C', splits: { B: 200 } },
    ]
    const nets = computeNets(['A', 'B', 'C'], exps, [])
    expect(simplify(nets)).toEqual([{ from: 'A', to: 'C', amount: 200 }])
  })

  it('a cycle of equal debts becomes zero payments', () => {
    const exps = [
      { id: '1', mode: 'equal', total: 300, paidBy: 'B', splits: { A: 300 } },
      { id: '2', mode: 'equal', total: 300, paidBy: 'C', splits: { B: 300 } },
      { id: '3', mode: 'equal', total: 300, paidBy: 'A', splits: { C: 300 } },
    ]
    expect(simplify(computeNets(['A', 'B', 'C'], exps, []))).toEqual([])
  })

  it('uneven amounts never lose or create a paisa', () => {
    const nets = { a: 333, b: 334, c: -1, d: -666 }
    const plan = simplify(nets)
    expect(plan.reduce((x, p) => x + p.amount, 0)).toBe(667)
    expect(Object.values(applyPlan(nets, plan)).every((v) => v === 0)).toBe(true)
  })

  it('after the plan is paid, every net is zero', () => {
    const nets = { a: 5000, b: -1200, c: -3800, d: 0 }
    const plan = simplify(nets)
    const pays = plan.map((p, i) => ({ id: String(i), ...p, status: 'paid' }))
    const exps = [{ id: 'x', mode: 'custom', total: 5000, paidBy: 'a', splits: { b: 1200, c: 3800 } }]
    expect(computeNets(['a', 'b', 'c', 'd'], exps, pays)).toEqual({ a: 0, b: 0, c: 0, d: 0 })
  })

  it('refuses nets that do not sum to zero', () => {
    expect(() => simplify({ a: 5, b: -4 })).toThrow()
  })

  it('is deterministic with ties broken by id', () => {
    const nets = { z: 100, y: 100, x: -100, w: -100 }
    expect(simplify(nets)).toEqual(simplify({ w: -100, x: -100, y: 100, z: 100 }))
    expect(simplify(nets)[0]).toEqual({ from: 'w', to: 'y', amount: 100 })
  })
})

describe('demo group (section 9 expected results)', () => {
  const ids = { Ankit: 'm1', Ravi: 'm2', Meera: 'm3', Sana: 'm4' }
  let n = 0
  const expenses = buildDemoExpenses('g', ids, () => `e${n++}`, 0)
  const group = { id: 'g', members: DEMO_MEMBERS.map((m) => ({ ...m, id: ids[m.name] })) }
  const L = buildLedger({ group, expenses, payments: [] })

  it('nets match', () => {
    expect(L.nets).toEqual({ m2: 560000, m1: -170000, m3: -210000, m4: -180000 })
  })
  it('11 payments reduced to 3', () => {
    expect(L.raw.length).toBe(11)
    expect(L.plan).toHaveLength(3)
    expect(L.plan).toEqual(expect.arrayContaining([
      { from: 'm1', to: 'm2', amount: 170000 },
      { from: 'm3', to: 'm2', amount: 210000 },
      { from: 'm4', to: 'm2', amount: 180000 },
    ]))
  })
  it('suggested payer is Meera; Ankit has 1 treat', () => {
    expect(L.suggested).toBe('m3')
    expect(L.treats).toEqual({ m1: 1 })
  })
})
