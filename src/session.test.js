import { describe, it, expect, beforeEach } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}
const S = await import('./session.js')

beforeEach(() => mem.clear())

describe('session', () => {
  it('device id is created once and kept', () => {
    const a = S.getDeviceId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(S.getDeviceId()).toBe(a)
  })

  it('sessions round-trip and malformed ones are ignored', () => {
    expect(S.getSession('g1')).toBe(null)
    S.setSession('g1', { memberId: 'm', token: 't', creator: true })
    expect(S.getSession('g1')).toEqual({ memberId: 'm', token: 't', creator: true })
    S.clearSession('g1')
    expect(S.getSession('g1')).toBe(null)
    mem.set('tally:session:g2', JSON.stringify({ memberId: 5, token: 't' }))
    expect(S.getSession('g2')).toBe(null)
    mem.set('tally:session:g3', '{broken')
    expect(S.getSession('g3')).toBe(null)
  })

  it('current group id', () => {
    expect(S.getCurrentGroupId()).toBe(null)
    S.setCurrentGroupId('g1')
    expect(S.getCurrentGroupId()).toBe('g1')
    S.setCurrentGroupId(null)
    expect(S.getCurrentGroupId()).toBe(null)
  })

  it('remembered groups: newest first, no duplicates, at most 20', () => {
    S.rememberGroup('a', 'A')
    S.rememberGroup('b', 'B')
    S.rememberGroup('a', 'A2')
    expect(S.listMyGroups()).toEqual([{ id: 'a', name: 'A2' }, { id: 'b', name: 'B' }])
    for (let i = 0; i < 30; i++) S.rememberGroup(`g${i}`, `G${i}`)
    expect(S.listMyGroups()).toHaveLength(20)
    expect(S.listMyGroups()[0].id).toBe('g29')
    S.forgetGroup('g29')
    expect(S.listMyGroups()[0].id).toBe('g28')
    mem.set('tally:groups', '"nope"')
    expect(S.listMyGroups()).toEqual([])
  })

  it('creator tokens and the device banner', () => {
    S.saveCreatorToken('g', 'm1', 't1')
    S.saveCreatorToken('g', 'm2', 't2')
    expect(S.getCreatorTokens('g')).toEqual({ m1: 't1', m2: 't2' })
    expect(S.getCreatorTokens('other')).toEqual({})
    expect(S.dismissedDeviceBanner('g')).toBe(false)
    S.dismissDeviceBanner('g')
    expect(S.dismissedDeviceBanner('g')).toBe(true)
  })
})
