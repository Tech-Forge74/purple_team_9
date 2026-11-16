import { describe, it, expect } from 'vitest'
import { computeSplit } from './split.js'
import { computeNets, treatCounts, breakdown } from './nets.js'

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
const M = ['a', 'b', 'c', 'd']

describe('computeSplit', () => {
  it('equal ₹100 among 3 gives 3334, 3333, 3333', () => {
    const r = computeSplit({ total: 10000, payer: 'a', participants: ['c', 'a', 'b'], mode: 'equal' })
    expect(r.ok).toBe(true)
    expect(r.splits).toEqual({ a: 3334, b: 3333, c: 3333 })
    expect(sum(r.splits)).toBe(10000)
  })

  it('my part: own ₹300 on ₹2,400 among 4 gives the other three ₹700 each', () => {
    const r = computeSplit({ total: 240000, payer: 'a', participants: M, mode: 'my_part', own: 30000 })
    expect(r.splits).toEqual({ a: 30000, b: 70000, c: 70000, d: 70000 })
  })

  it('my part rejects own above the total', () => {
    const r = computeSplit({ total: 1000, payer: 'a', participants: M, mode: 'my_part', own: 2000 })
    expect(r.ok).toBe(false)
  })

  it('my part where the poster is not the payer', () => {
    const r = computeSplit({ total: 800000, payer: 'b', poster: 'a', participants: M, mode: 'my_part', own: 150000 })
    expect(r.ok).toBe(true)
    expect(r.splits.a).toBe(150000)
    expect(sum(r.splits)).toBe(800000)
    expect(r.splits.b + r.splits.c + r.splits.d).toBe(650000)
  })

  it('custom: one person locked at ₹1,000, the rest split equally', () => {
    const r = computeSplit({ total: 400000, payer: 'a', participants: M, mode: 'custom', custom: { b: 100000 } })
    expect(r.splits).toEqual({ a: 100000, b: 100000, c: 100000, d: 100000 })
    const r2 = computeSplit({ total: 400000, payer: 'a', participants: M, mode: 'custom', custom: { b: 250000 } })
    expect(r2.splits).toEqual({ a: 50000, b: 250000, c: 50000, d: 50000 })
  })

  it('custom: locked above the total is rejected', () => {
    const r = computeSplit({ total: 100000, payer: 'a', participants: M, mode: 'custom', custom: { b: 100001 } })
    expect(r.ok).toBe(false)
  })

  it('custom: everyone locked must add up to the total', () => {
    expect(computeSplit({ total: 300, payer: 'a', participants: ['a', 'b'], mode: 'custom', custom: { a: 100, b: 100 } }).ok).toBe(false)
    expect(computeSplit({ total: 300, payer: 'a', participants: ['a', 'b'], mode: 'custom', custom: { a: 100, b: 200 } }).ok).toBe(true)
  })

  it('treat produces no debts; only the treat counter changes', () => {
    const r = computeSplit({ total: 30000, payer: 'a', participants: M, mode: 'treat' })
    expect(r).toEqual({ ok: true, splits: {} })
    const e = { id: 'e', mode: 'treat', total: 30000, paidBy: 'a', splits: {} }
    expect(computeNets(M, [e], [])).toEqual({ a: 0, b: 0, c: 0, d: 0 })
    expect(treatCounts([e])).toEqual({ a: 1 })
  })

  it('payer not in the ticked list is valid', () => {
    const r = computeSplit({ total: 900, payer: 'a', participants: ['b', 'c'], mode: 'equal' })
    expect(r.ok).toBe(true)
    const nets = computeNets(M, [{ id: 'e', mode: 'equal', total: 900, paidBy: 'a', splits: r.splits }], [])
    expect(nets).toEqual({ a: 900, b: -450, c: -450, d: 0 })
  })

  it('guards bad input and never throws', () => {
    const bad = [
      { total: 0, payer: 'a', participants: M, mode: 'equal' },
      { total: -5, payer: 'a', participants: M, mode: 'equal' },
      { total: 10.5, payer: 'a', participants: M, mode: 'equal' },
      { total: NaN, payer: 'a', participants: M, mode: 'equal' },
      { total: Infinity, payer: 'a', participants: M, mode: 'equal' },
      { total: 10000001, payer: 'a', participants: M, mode: 'equal' },
      { total: 100, payer: 'a', participants: ['a', 'a'], mode: 'equal' },
      { total: 100, payer: 'a', participants: ['a', 'z'], mode: 'equal', members: M },
      { total: 100, payer: 'z', participants: ['a'], mode: 'equal', members: M },
      { total: 100, payer: 'a', participants: [], mode: 'equal' },
      { total: 100, payer: 'a', participants: M, mode: 'weird' },
      { total: 100, payer: 'a', participants: M, mode: 'custom', custom: { a: -1 } },
      { total: '100', payer: 'a', participants: M, mode: 'equal' },
    ]
    for (const input of bad) expect(computeSplit(input).ok).toBe(false)
    expect(computeSplit(undefined).ok).toBe(false)
    expect(computeSplit({ participants: null }).ok).toBe(false)
  })

  it('nets always sum to zero', () => {
    const r1 = computeSplit({ total: 1001, payer: 'a', participants: M, mode: 'equal' })
    const r2 = computeSplit({ total: 777, payer: 'c', participants: ['a', 'b'], mode: 'equal' })
    const nets = computeNets(M, [
      { id: '1', mode: 'equal', total: 1001, paidBy: 'a', splits: r1.splits },
      { id: '2', mode: 'equal', total: 777, paidBy: 'c', splits: r2.splits },
    ], [{ id: 'p', from: 'b', to: 'a', amount: 100, status: 'paid' }])
    expect(sum(nets)).toBe(0)
  })

  it('breakdown lines sum to the net, disputed payments are excluded', () => {
    const exps = [{ id: '1', title: 'Hotel', mode: 'equal', total: 800000, paidBy: 'a', splits: { a: 200000, b: 200000, c: 200000, d: 200000 } }]
    const pays = [
      { id: 'p1', from: 'b', to: 'a', amount: 100000, status: 'paid' },
      { id: 'p2', from: 'c', to: 'a', amount: 50000, status: 'disputed' },
    ]
    const nets = computeNets(M, exps, pays)
    for (const id of M) {
      const lines = breakdown(id, exps, pays)
      expect(lines.reduce((x, l) => x + l.effect, 0)).toBe(nets[id])
    }
    const disputedOff = computeNets(M, exps, [pays[0]])
    expect(nets).toEqual(disputedOff)
  })
})
