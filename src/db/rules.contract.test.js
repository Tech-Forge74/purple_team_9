// Checks that every record the app writes would pass firestore.rules field
// whitelists and value rules. Reads the allowed keys straight from the rules
// file, so a change on either side that breaks Firebase fails here.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}

const A = await import('../actions.js')
const db = (await import('../db.js')).default
const { buildLedger } = await import('../engine/ledger.js')
const { owedBetween } = await import('../engine/settle.js')
const { uuid } = await import('../ids.js')

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
const listAfter = (re) => {
  const m = re.exec(rules)
  if (!m) throw new Error(`rules pattern not found: ${re}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
const createKeys = (coll) => listAfter(new RegExp(`match /${coll}/[\\s\\S]*?allow create: if onlyKeys\\(\\[([\\s\\S]*?)\\]\\)`))
const updateKeys = (coll) => listAfter(new RegExp(`match /${coll}/[\\s\\S]*?allow update: if request\\.resource\\.data\\.diff\\(resource\\.data\\)\\.affectedKeys\\(\\)\\.hasOnly\\(\\[([\\s\\S]*?)\\]\\)`))
const groupKeys = listAfter(/function validGroup\(\)[\s\S]*?onlyKeys\(\[([\s\S]*?)\]\)/)
const memberKeys = listAfter(/function validMember\(m\)[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/)

const ID = /^[A-Za-z0-9_-]{8,64}$/
const paise = (v) => Number.isInteger(v) && v >= 1 && v <= 10000000
const subset = (obj, keys) => Object.keys(obj).filter((k) => !keys.includes(k))

// Record every write the app makes.
const writes = { create: [], update: [], group: [] }
let snap

beforeAll(async () => {
  const origCreate = db.create
  const origUpdate = db.update
  const origCreateGroup = db.createGroup
  const origMutate = db.mutateGroup
  db.create = async (c, d) => { writes.create.push([c, structuredClone(d)]); return origCreate(c, d) }
  db.update = async (c, id, p) => { writes.update.push([c, id, structuredClone(p)]); return origUpdate(c, id, p) }
  db.createGroup = async (g) => { writes.group.push(structuredClone(g)); return origCreateGroup(g) }
  db.mutateGroup = async (id, fn) => { const g = await origMutate(id, fn); writes.group.push(structuredClone(g)); return g }

  const { groupId: gid } = await A.loadDemoGroup()
  const g = await db.getGroup(gid)
  const id = Object.fromEntries(g.members.map((m) => [m.name, m.id]))
  const L = async () => buildLedger(await db.getSnapshot(gid))

  // Every split mode, an AI-sourced expense, a delete.
  const base = { title: 'Dinner', category: 'food', total: 90000, paidBy: id.Ankit, participants: [id.Ankit, id.Ravi, id.Meera] }
  await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), mode: 'equal' })
  await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), mode: 'my_part', own: 10000 })
  await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), mode: 'full', participants: [id.Ravi] })
  await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), mode: 'custom', custom: { [id.Ankit]: 30000, [id.Ravi]: 30000, [id.Meera]: 30000 } })
  await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), mode: 'treat', participants: [], source: 'ai' })
  const del = { ...base, id: uuid(), mode: 'equal', category: 'nonsense' }
  await A.saveExpense(gid, id.Ankit, del)
  await A.deleteExpense(gid, id.Ankit, del.id)

  // Claim -> pay -> confirm; pay -> undo; pay -> dispute.
  await A.switchMember(gid, id.Ravi)
  for (const debtor of (await L()).plan.filter((p) => p.to === id.Ravi).map((p) => p.from)) await A.sendClaim(gid, id.Ravi, { from: debtor })
  const plan = (await L()).plan
  const [p1, p2] = plan
  await A.switchMember(gid, p1.from)
  const pay1 = uuid()
  await A.recordPayment(gid, p1.from, { id: pay1, from: p1.from, to: p1.to, amount: 100 })
  const pay2 = uuid()
  await A.recordPayment(gid, p1.from, { id: pay2, from: p1.from, to: p1.to, amount: 100 })
  await A.undoPayment(gid, p1.from, pay2)
  await A.switchMember(gid, p1.to)
  await A.respondPayment(gid, p1.to, pay1, true)
  if (p2) {
    await A.switchMember(gid, p2.from)
    const pay3 = uuid()
    await A.recordPayment(gid, p2.from, { id: pay3, from: p2.from, to: p2.to, amount: owedBetween((await L()).plan, p2.from, p2.to) })
    await A.switchMember(gid, p2.to)
    await A.respondPayment(gid, p2.to, pay3, false)
  }

  // Group mutations.
  await A.switchMember(gid, id.Ankit)
  await A.addMemberByCreator(gid, { name: 'Zoya', upiId: 'zoya@ybl' })
  await A.regenerateInviteCode(gid)
  await A.reissueToken(gid, id.Ankit, id.Meera)
  snap = await db.getSnapshot(gid)
  vi.restoreAllMocks()
})

describe('records match firestore.rules', () => {
  it('the scenario exercised every kind of write', () => {
    const kinds = new Set(writes.create.map(([c]) => c))
    expect([...kinds].sort()).toEqual(['claims', 'expenses', 'payments'])
    expect(writes.update.map(([c]) => c)).toEqual(expect.arrayContaining(['claims', 'expenses', 'payments']))
    expect(writes.group.length).toBeGreaterThan(3)
  })

  it('groups and members use only allowed keys and valid values', () => {
    for (const g of writes.group) {
      expect(subset(g, groupKeys)).toEqual([])
      expect(g.id).toMatch(ID)
      expect(g.creatorId).toMatch(ID)
      expect(g.inviteCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
      expect(Number.isInteger(g.createdAt) && g.createdAt > 0).toBe(true)
      expect(g.members.length).toBeGreaterThanOrEqual(1)
      expect(g.members.length).toBeLessThanOrEqual(20)
      for (const m of g.members) {
        expect(subset(m, memberKeys)).toEqual([])
        expect(m.id).toMatch(ID)
        expect(m.tokenHash).toMatch(/^[0-9a-f]{64}$/)
        expect(Array.isArray(m.devices) && m.devices.length <= 10).toBe(true)
        expect(typeof m.removed).toBe('boolean')
      }
    }
  })

  it('created expenses, payments and claims pass the create rules', () => {
    const allowed = { expenses: createKeys('expenses'), payments: createKeys('payments'), claims: createKeys('claims') }
    for (const [coll, d] of writes.create) {
      expect({ coll, extra: subset(d, allowed[coll]) }).toEqual({ coll, extra: [] })
      expect(d.id).toMatch(ID)
      expect(d.groupId).toMatch(ID)
      if (coll === 'expenses') {
        expect(paise(d.total)).toBe(true)
        expect(d.title.length).toBeLessThanOrEqual(40)
        expect(d.deleted).toBe(false)
        expect(d.paidBy).toMatch(ID)
        expect(d.createdBy).toMatch(ID)
        expect(Object.keys(d.splits).length).toBeLessThanOrEqual(20)
        if ('own' in d) expect(Number.isInteger(d.own) && d.own >= 0).toBe(true)
      }
      if (coll === 'payments') {
        expect(d.createdBy).toBe(d.from)
        expect(d.status).toBe('paid')
        expect(paise(d.amount)).toBe(true)
      }
      if (coll === 'claims') {
        expect(d.createdBy).toBe(d.to)
        expect(d.status).toBe('requested')
        expect(paise(d.amount)).toBe(true)
      }
    }
  })

  it('updates only touch the fields the rules allow (groupId is stripped by the Firebase backend)', () => {
    const allowed = { expenses: updateKeys('expenses'), payments: updateKeys('payments'), claims: updateKeys('claims') }
    for (const [coll, , patch] of writes.update) {
      const { groupId: _g, ...rest } = patch
      expect({ coll, extra: subset(rest, allowed[coll]) }).toEqual({ coll, extra: [] })
    }
  })

  it('payment status only moves away from "paid"', () => {
    for (const [coll, id, patch] of writes.update) {
      if (coll !== 'payments') continue
      expect(['confirmed', 'disputed', 'undone']).toContain(patch.status)
      expect(snap.payments.find((p) => p.id === id)).toBeTruthy()
    }
  })
})
