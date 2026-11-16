// Actions not covered by actions.test.js: group creation, members, links,
// invite codes, deletes, claims and the fresh-pay check.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}

const A = await import('./actions.js')
const db = (await import('./db.js')).default
const S = await import('./session.js')
const { buildLedger } = await import('./engine/ledger.js')
const { owedBetween } = await import('./engine/settle.js')
const { uuid } = await import('./ids.js')

const L = async (gid) => buildLedger(await db.getSnapshot(gid))

async function demo() {
  const r = await A.loadDemoGroup()
  const snap = await db.getSnapshot(r.groupId)
  const id = Object.fromEntries(snap.group.members.map((m) => [m.name, m.id]))
  return { gid: r.groupId, id, snap }
}

// Pretend to be a different phone: new device id, no sessions.
function newDevice() {
  for (const k of [...mem.keys()]) if (k.startsWith('tally:session:') || k === 'tally:device' || k.startsWith('tally:rl:')) mem.delete(k)
}

async function realGroup() {
  const r = await A.createGroup({ groupName: 'Flat 4B', name: 'Asha', upiId: 'asha@okaxis' })
  expect(r.ok).toBe(true)
  const g = await db.getGroup(r.groupId)
  return { gid: r.groupId, g, creator: g.creatorId }
}

beforeEach(() => mem.clear())

describe('createGroup', () => {
  it('creates a group with the caller as verified creator', async () => {
    const { gid, g, creator } = await realGroup()
    expect(g.demo).toBe(false)
    expect(g.members).toHaveLength(1)
    expect(g.members[0]).not.toHaveProperty('token')
    expect(g.members[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
    const v = await A.verifySessionAsync(gid)
    expect(v).toMatchObject({ ok: true, me: creator, isCreator: true, canSwitch: true })
    expect(S.getCurrentGroupId()).toBe(gid)
    expect(S.listMyGroups()[0]).toEqual({ id: gid, name: 'Flat 4B' })
  })

  it('rejects bad input with group-specific wording', async () => {
    const r = await A.createGroup({ groupName: '', name: 'Asha', upiId: 'asha@okaxis' })
    expect(r).toEqual({ ok: false, error: 'Enter a group name.' })
    expect((await A.createGroup({ groupName: 'x'.repeat(41), name: 'Asha', upiId: 'asha@okaxis' })).error).toMatch(/Group names/)
    expect((await A.createGroup({ groupName: 'Trip', name: '', upiId: 'asha@okaxis' })).ok).toBe(false)
    expect((await A.createGroup({ groupName: 'Trip', name: 'Asha', upiId: 'nope' })).ok).toBe(false)
  })
})

describe('members', () => {
  it('only the creator can add members, and the new link works on another device', async () => {
    const { gid } = await realGroup()
    const add = await A.addMemberByCreator(gid, { name: 'Bala', upiId: 'bala@ybl' })
    expect(add.ok).toBe(true)
    newDevice()
    const open = await A.openPersonalLink(gid, add.token)
    expect(open).toEqual({ ok: true, groupId: gid, newDevice: false })
    const v = await A.verifySessionAsync(gid)
    expect(v).toMatchObject({ ok: true, me: add.memberId, isCreator: false, canSwitch: false })
    expect((await A.addMemberByCreator(gid, { name: 'Chitra', upiId: 'c@ybl' })).ok).toBe(false)
  })

  it('a group is full at 20 members', async () => {
    const { gid } = await realGroup()
    for (let i = 0; i < 19; i++) expect((await A.addMemberByCreator(gid, { name: `M${i}`, upiId: `m${i}@ybl` })).ok).toBe(true)
    expect(await A.addMemberByCreator(gid, { name: 'Late', upiId: 'late@ybl' })).toEqual({ ok: false, error: 'This group is full (20 members).' })
    const { g } = { g: await db.getGroup(gid) }
    newDevice()
    expect((await A.joinGroup({ code: g.inviteCode, name: 'Late', upiId: 'late@ybl' })).error).toMatch(/full/)
  })

  it('name clashes are case-insensitive', async () => {
    const { gid, g } = await realGroup()
    newDevice()
    const r = await A.joinGroup({ code: g.inviteCode.toLowerCase(), name: 'asha', upiId: 'a2@ybl' })
    expect(r).toMatchObject({ ok: true, name: 'asha 2' })
    expect((await db.getGroup(gid)).members).toHaveLength(2)
  })

  it('switchMember is refused for normal members and allowed for the creator', async () => {
    const { gid, creator } = await realGroup()
    const add = await A.addMemberByCreator(gid, { name: 'Bala', upiId: 'bala@ybl' })
    expect((await A.switchMember(gid, add.memberId)).ok).toBe(true)
    expect((await A.verifySessionAsync(gid)).me).toBe(add.memberId)
    expect((await A.switchMember(gid, 'not-a-member-id')).ok).toBe(false)
    expect((await A.switchMember(gid, creator)).ok).toBe(true)
    expect((await A.verifySessionAsync(gid)).me).toBe(creator)
    newDevice()
    await A.openPersonalLink(gid, add.token)
    expect((await A.switchMember(gid, creator)).ok).toBe(false)
  })

  it('a removed member\'s link stops working and they cannot be paid into an expense', async () => {
    const { gid, creator } = await realGroup()
    const add = await A.addMemberByCreator(gid, { name: 'Bala', upiId: 'bala@ybl' })
    expect((await A.removeMember(gid, creator, add.memberId)).ok).toBe(true)
    expect((await A.removeMember(gid, creator, creator)).error).toMatch(/creator cannot/)
    const form = { id: uuid(), title: 'Milk', total: 5000, paidBy: creator, mode: 'equal', participants: [creator, add.memberId] }
    expect((await A.saveExpense(gid, creator, form)).ok).toBe(false)
    newDevice()
    expect((await A.openPersonalLink(gid, add.token)).ok).toBe(false)
  })

  it('reissueToken kills the old link', async () => {
    const { gid } = await realGroup()
    const add = await A.addMemberByCreator(gid, { name: 'Bala', upiId: 'bala@ybl' })
    const re = await A.reissueToken(gid, null, add.memberId)
    expect(re.ok).toBe(true)
    expect(re.token).not.toBe(add.token)
    newDevice()
    expect((await A.openPersonalLink(gid, add.token)).ok).toBe(false)
    newDevice()
    expect((await A.openPersonalLink(gid, re.token)).ok).toBe(true)
    // A normal member cannot reissue someone else's link.
    const { creatorId } = await db.getGroup(gid)
    expect((await A.reissueToken(gid, null, creatorId)).ok).toBe(false)
  })

  it('a member reissuing their own link stays signed in', async () => {
    const { gid } = await realGroup()
    const add = await A.addMemberByCreator(gid, { name: 'Bala', upiId: 'bala@ybl' })
    newDevice()
    await A.openPersonalLink(gid, add.token)
    const re = await A.reissueToken(gid, add.memberId, add.memberId)
    expect(re.ok).toBe(true)
    expect((await A.verifySessionAsync(gid)).ok).toBe(true)
  })
})

describe('invite codes', () => {
  it('regenerating invalidates the old code; only the creator can do it', async () => {
    const { gid, g } = await realGroup()
    const r = await A.regenerateInviteCode(gid)
    expect(r.ok).toBe(true)
    expect(r.code).not.toBe(g.inviteCode)
    newDevice()
    expect((await A.joinGroup({ code: g.inviteCode, name: 'Old', upiId: 'old@ybl' })).ok).toBe(false)
    expect((await A.joinGroup({ code: r.code, name: 'New', upiId: 'new@ybl' })).ok).toBe(true)
    expect((await A.regenerateInviteCode(gid)).ok).toBe(false)
  })
})

describe('expenses', () => {
  it('only the author can delete, the ledger drops it, and a second delete fails', async () => {
    const { gid, id } = await demo()
    const form = { id: uuid(), title: 'Snacks', total: 40000, paidBy: id.Ankit, mode: 'equal', participants: [id.Ankit, id.Ravi] }
    expect((await A.saveExpense(gid, id.Ankit, form)).ok).toBe(true)
    const before = (await L(gid)).nets[id.Ravi]
    await A.switchMember(gid, id.Ravi)
    expect((await A.deleteExpense(gid, id.Ravi, form.id)).error).toMatch(/Only the person/)
    await A.switchMember(gid, id.Ankit)
    expect((await A.deleteExpense(gid, id.Ankit, form.id)).ok).toBe(true)
    expect((await L(gid)).nets[id.Ravi]).toBe(before + 20000)
    expect((await A.deleteExpense(gid, id.Ankit, form.id)).ok).toBe(false)
  })

  it('treat expenses do not change balances but are counted', async () => {
    const { gid, id } = await demo()
    const before = await L(gid)
    const r = await A.saveExpense(gid, id.Ankit, { id: uuid(), title: 'Ice cream', total: 30000, paidBy: id.Ankit, mode: 'treat', participants: [] })
    expect(r.ok).toBe(true)
    const after = await L(gid)
    expect(after.nets).toEqual(before.nets)
    expect(after.treats[id.Ankit]).toBe((before.treats[id.Ankit] ?? 0) + 1)
  })

  it('amount limits and bad ids', async () => {
    const { gid, id } = await demo()
    const base = { title: 'X', paidBy: id.Ankit, mode: 'equal', participants: [id.Ankit, id.Ravi] }
    expect((await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), total: 10000001 })).error).toMatch(/limit/)
    expect((await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), total: 0 })).ok).toBe(false)
    expect((await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), total: 10.5 })).ok).toBe(false)
    expect((await A.saveExpense(gid, id.Ankit, { ...base, id: 'bad id!', total: 100 })).ok).toBe(false)
    expect((await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), total: 100, title: 'see evil.com' })).error).toMatch(/links/)
    expect((await A.saveExpense(gid, id.Ankit, { ...base, id: uuid(), total: 100, mode: 'weird' })).ok).toBe(false)
  })

  it('stops at 500 expenses', async () => {
    const { gid, id } = await demo()
    const have = (await db.getSnapshot(gid)).expenses.length
    for (let i = have; i < 500; i++) {
      await db.create('expenses', { id: `fill-${String(i).padStart(4, '0')}`, groupId: gid, title: 'f', total: 100, paidBy: id.Ankit, mode: 'treat', participants: [], splits: {}, createdBy: id.Ankit, createdAt: i, deleted: false })
    }
    const r = await A.saveExpense(gid, id.Ankit, { id: uuid(), title: 'One more', total: 100, paidBy: id.Ankit, mode: 'equal', participants: [id.Ankit] })
    expect(r.error).toMatch(/500/)
  })
})

describe('payments and claims', () => {
  it('checkFreshPay returns a UPI link for the current amount and flags stale amounts', async () => {
    const { gid, id } = await demo()
    const l = await L(gid)
    const { from, to, amount } = l.plan[0]
    const r = await A.checkFreshPay(gid, from, to, amount)
    expect(r.ok).toBe(true)
    expect(r.link).toMatch(/^upi:\/\/pay\?pa=/)
    expect(r.link).toContain(`am=${(amount / 100).toFixed(2)}`)
    expect(await A.checkFreshPay(gid, from, to, amount + 1)).toMatchObject({ ok: false, stale: true })
    expect(id).toBeTruthy()
  })

  it('sendClaim builds the message, link and WhatsApp URL, then enforces the cooldown', async () => {
    const { gid, id } = await demo()
    await A.switchMember(gid, id.Ravi)
    const owed = owedBetween((await L(gid)).plan, id.Meera, id.Ravi)
    expect(owed).toBeGreaterThan(0)
    const r = await A.sendClaim(gid, id.Ravi, { from: id.Meera })
    expect(r.ok).toBe(true)
    expect(r.claim).toMatchObject({ from: id.Meera, to: id.Ravi, amount: owed, status: 'requested' })
    expect(r.message).toContain('Hey Meera')
    expect(r.message).toContain('pa=ravi%40ybl')
    expect(r.whatsapp.startsWith('https://wa.me/?text=')).toBe(true)
    expect((await A.sendClaim(gid, id.Ravi, { from: id.Meera })).error).toMatch(/recently/)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000)
    try {
      const again = await A.sendClaim(gid, id.Ravi, { from: id.Meera })
      expect(again.ok).toBe(true)
      expect(again.claim.id).toBe(r.claim.id)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('you cannot claim from yourself or from someone who owes you nothing', async () => {
    const { gid, id } = await demo()
    expect((await A.sendClaim(gid, id.Ankit, { from: id.Ankit })).ok).toBe(false)
    expect((await A.sendClaim(gid, id.Ankit, { from: id.Ravi })).ok).toBe(false)
  })

  it('only the payee can respond, and only once', async () => {
    const { gid, id } = await demo()
    const amount = owedBetween((await L(gid)).plan, id.Ankit, id.Ravi)
    const pid = uuid()
    expect((await A.recordPayment(gid, id.Ankit, { id: pid, from: id.Ankit, to: id.Ravi, amount })).ok).toBe(true)
    expect((await A.respondPayment(gid, id.Ankit, pid, true)).ok).toBe(false)
    await A.switchMember(gid, id.Meera)
    expect((await A.respondPayment(gid, id.Meera, pid, true)).ok).toBe(false)
    await A.switchMember(gid, id.Ravi)
    expect((await A.respondPayment(gid, id.Ravi, pid, true)).ok).toBe(true)
    expect((await A.respondPayment(gid, id.Ravi, pid, false)).ok).toBe(false)
    expect(owedBetween((await L(gid)).plan, id.Ankit, id.Ravi)).toBe(0)
  })

  it('partial payments reduce what is owed', async () => {
    const { gid, id } = await demo()
    const amount = owedBetween((await L(gid)).plan, id.Ankit, id.Ravi)
    expect((await A.recordPayment(gid, id.Ankit, { id: uuid(), from: id.Ankit, to: id.Ravi, amount: 1000 })).ok).toBe(true)
    expect(owedBetween((await L(gid)).plan, id.Ankit, id.Ravi)).toBe(amount - 1000)
  })
})

describe('actions never throw', () => {
  it('garbage in gives { ok: false }', async () => {
    const calls = [
      () => A.saveExpense('nope', 'me', null),
      () => A.recordPayment('nope', 'me'),
      () => A.deleteExpense(undefined, undefined, undefined),
      () => A.sendClaim('nope', 'me'),
      () => A.openPersonalLink(null, null),
      () => A.joinGroup({}),
      () => A.checkFreshPay('nope', 'a', 'b', 1),
      () => A.removeMember('nope', 'me', 'x'),
      () => A.undoPayment('nope', 'me', 'x'),
      () => A.respondPayment('nope', 'me', 'x', true),
    ]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const c of calls) {
      const r = await c()
      expect(r.ok).toBe(false)
      expect(typeof r.error).toBe('string')
    }
    vi.restoreAllMocks()
  })
})
