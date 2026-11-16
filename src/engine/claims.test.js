import { describe, it, expect } from 'vitest'
import { checkPayment, checkClaim, claimAmount, canRespond, canUndo } from './claims.js'
import { buildLedger } from './ledger.js'
import { buildDemoExpenses, DEMO_MEMBERS } from './demo.js'

const ids = { Ankit: 'a', Ravi: 'r', Meera: 'm', Sana: 's' }
let n = 0
const expenses = buildDemoExpenses('g', ids, () => `e${n++}`, 0)
const group = { members: DEMO_MEMBERS.map((x) => ({ ...x, id: ids[x.name] })) }
const L0 = buildLedger({ group, expenses, payments: [] })

describe('claims and payments', () => {
  it('a claim never exceeds what is owed now', () => {
    expect(claimAmount({ me: 'r', from: 's', plan: L0.plan })).toBe(180000)
    expect(claimAmount({ me: 'a', from: 's', plan: L0.plan })).toBe(0)
    expect(checkClaim({ me: 'a', from: 's', plan: L0.plan, now: 0 })).toMatch(/do not owe/)
    expect(checkClaim({ me: 's', from: 's', plan: L0.plan, now: 0 })).toBeTruthy()
    expect(checkClaim({ me: 'r', from: 's', plan: L0.plan, now: 0 })).toBeNull()
  })

  it('10-minute reminder cooldown', () => {
    expect(checkClaim({ me: 'r', from: 's', plan: L0.plan, existing: { lastSentAt: 1000 }, now: 1000 + 60000 })).toMatch(/recently/)
    expect(checkClaim({ me: 'r', from: 's', plan: L0.plan, existing: { lastSentAt: 1000 }, now: 1000 + 600001 })).toBeNull()
  })

  it('a partial payment reduces the debt by exactly the paid amount', () => {
    expect(checkPayment({ me: 's', from: 's', to: 'r', amount: 50000, plan: L0.plan })).toBeNull()
    const L1 = buildLedger({ group, expenses, payments: [{ id: 'p', from: 's', to: 'r', amount: 50000, status: 'paid' }] })
    expect(L1.nets.s).toBe(L0.nets.s + 50000)
    expect(claimAmount({ me: 'r', from: 's', plan: L1.plan })).toBe(130000)
  })

  it('only the debtor pays, never more than owed', () => {
    expect(checkPayment({ me: 'r', from: 's', to: 'r', amount: 100, plan: L0.plan })).toBeTruthy()
    expect(checkPayment({ me: 's', from: 's', to: 'r', amount: 180001, plan: L0.plan })).toMatch(/more than/)
    expect(checkPayment({ me: 's', from: 's', to: 'r', amount: 0, plan: L0.plan })).toBeTruthy()
    expect(checkPayment({ me: 's', from: 's', to: 'a', amount: 100, plan: L0.plan })).toBeTruthy()
  })

  it('marking a payment disputed restores the original balances', () => {
    const p = { id: 'p', from: 's', to: 'r', amount: 180000, status: 'paid' }
    const L1 = buildLedger({ group, expenses, payments: [p] })
    expect(L1.nets.s).toBe(0)
    const L2 = buildLedger({ group, expenses, payments: [{ ...p, status: 'disputed' }] })
    expect(L2.nets).toEqual(L0.nets)
  })

  it('only the payee can respond; only the author can undo within 5 seconds', () => {
    const p = { id: 'p', from: 's', to: 'r', amount: 1, status: 'paid', createdBy: 's', createdAt: 1000 }
    expect(canRespond('r', p)).toBe(true)
    expect(canRespond('s', p)).toBe(false)
    expect(canRespond('a', p)).toBe(false)
    expect(canUndo('s', p, 5999)).toBe(true)
    expect(canUndo('s', p, 6001)).toBe(false)
    expect(canUndo('r', p, 2000)).toBe(false)
  })
})
