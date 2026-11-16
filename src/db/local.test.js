import { describe, it, expect, beforeEach } from 'vitest'

const mem = new Map()
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}
globalThis.localStorage = storage
globalThis.window = new EventTarget()

const { local, kv, readJSON } = await import('./local.js')

const tick = () => new Promise((r) => setTimeout(r, 0))
const group = (id = 'group-0001', code = 'ABCDEF') => ({ id, name: 'G', inviteCode: code, members: [{ id: 'mem-00001' }] })
const exp = (id, groupId = 'group-0001', createdAt = 1) => ({ id, groupId, createdAt, total: 100 })

beforeEach(() => mem.clear())

describe('local backend', () => {
  it('creates a group and finds it by invite code', async () => {
    await local.createGroup(group())
    expect(await local.getGroup('group-0001')).toMatchObject({ name: 'G' })
    expect(await local.findGroupIdByCode('ABCDEF')).toBe('group-0001')
    expect(await local.findGroupIdByCode('ZZZZZZ')).toBe(null)
    await expect(local.createGroup(group())).rejects.toThrow()
  })

  it('missing group gives an empty snapshot', async () => {
    expect(await local.getSnapshot('nope')).toEqual({ group: null, expenses: [], payments: [], claims: [] })
    expect(await local.getGroup('nope')).toBe(null)
  })

  it('create is idempotent and sorted by time', async () => {
    await local.createGroup(group())
    expect(await local.create('expenses', exp('e-b', undefined, 2))).toBe('created')
    expect(await local.create('expenses', exp('e-a', undefined, 1))).toBe('created')
    expect(await local.create('expenses', { ...exp('e-a'), total: 999 })).toBe('exists')
    const s = await local.getSnapshot('group-0001')
    expect(s.expenses.map((e) => e.id)).toEqual(['e-a', 'e-b'])
    expect(s.expenses[0].total).toBe(100)
  })

  it('rejects unknown collections and groups', async () => {
    await local.createGroup(group())
    await expect(local.create('groups', exp('x'))).rejects.toThrow()
    await expect(local.create('expenses', exp('x', 'missing'))).rejects.toThrow()
    await expect(local.update('nope', 'x', {})).rejects.toThrow()
    await expect(local.update('expenses', 'missing', { groupId: 'group-0001' })).rejects.toThrow()
  })

  it('update patches without changing id or groupId, with or without groupId', async () => {
    await local.createGroup(group())
    await local.create('payments', { id: 'p1', groupId: 'group-0001', status: 'paid' })
    await local.update('payments', 'p1', { groupId: 'group-0001', status: 'confirmed', id: 'hacked' })
    await local.update('payments', 'p1', { respondedAt: 5 })
    const [p] = (await local.getSnapshot('group-0001')).payments
    expect(p).toEqual({ id: 'p1', groupId: 'group-0001', status: 'confirmed', respondedAt: 5 })
  })

  it('mutateGroup moves the invite code and refuses bad mutations', async () => {
    await local.createGroup(group())
    await local.mutateGroup('group-0001', (g) => ({ ...g, inviteCode: 'QWERTY' }))
    expect(await local.findGroupIdByCode('ABCDEF')).toBe(null)
    expect(await local.findGroupIdByCode('QWERTY')).toBe('group-0001')
    await expect(local.mutateGroup('group-0001', () => null)).rejects.toThrow()
    await expect(local.mutateGroup('group-0001', (g) => ({ ...g, id: 'other' }))).rejects.toThrow()
    await expect(local.mutateGroup('missing', (g) => g)).rejects.toThrow('Group not found.')
  })

  it('mutateGroup errors from fn leave the group unchanged', async () => {
    await local.createGroup(group())
    await expect(local.mutateGroup('group-0001', (g) => { g.name = 'changed'; throw new Error('no') })).rejects.toThrow('no')
    expect((await local.getGroup('group-0001')).name).toBe('G')
  })

  it('subscribers get the first snapshot, every change, and stop after unsubscribe', async () => {
    await local.createGroup(group())
    const seen = []
    const unsub = local.subscribe('group-0001', (s) => seen.push(s.expenses.length))
    await tick()
    await local.create('expenses', exp('e1'))
    await tick()
    unsub()
    await local.create('expenses', exp('e2'))
    await tick()
    expect(seen).toEqual([0, 1])
  })

  it('another tab writing (storage event) reaches subscribers', async () => {
    await local.createGroup(group())
    const seen = []
    local.subscribe('group-0001', (s) => seen.push(s.expenses.length))
    await tick()
    // Simulate the other tab: write storage directly, then fire the event.
    const rec = JSON.parse(mem.get('tally:g:group-0001'))
    rec.expenses.x = exp('x')
    mem.set('tally:g:group-0001', JSON.stringify(rec))
    const e = new Event('storage')
    Object.defineProperty(e, 'key', { value: 'tally:g:group-0001' })
    window.dispatchEvent(e)
    await tick()
    expect(seen).toEqual([0, 1])
  })

  it('falls back to memory when localStorage is blocked', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() {} }
    try {
      const s = kv()
      expect(s).not.toBe(storage)
      s.setItem('k', '"v"')
      expect(readJSON('k', null)).toBe('v')
    } finally {
      globalThis.localStorage = storage
    }
  })
})
