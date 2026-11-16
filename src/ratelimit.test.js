import { describe, it, expect, beforeEach } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}
const { failureGate, chatGate } = await import('./ratelimit.js')

beforeEach(() => mem.clear())

describe('failureGate', () => {
  it('locks for 30 seconds after 5 failures in a minute', () => {
    const g = failureGate('t')
    const t0 = 1_000_000
    for (let i = 0; i < 4; i++) g.fail(t0 + i)
    expect(g.lockedFor(t0 + 10)).toBe(0)
    g.fail(t0 + 5)
    expect(g.lockedFor(t0 + 5)).toBe(30000)
    expect(g.lockedFor(t0 + 5 + 29999)).toBe(1)
    expect(g.lockedFor(t0 + 5 + 30000)).toBe(0)
  })

  it('old failures fall out of the one-minute window', () => {
    const g = failureGate('t')
    for (let i = 0; i < 4; i++) g.fail(i)
    g.fail(70000)
    expect(g.lockedFor(70000)).toBe(0)
  })

  it('survives corrupted storage', () => {
    mem.set('t', '{not json')
    const g = failureGate('t')
    expect(g.lockedFor(0)).toBe(0)
    expect(() => g.fail(0)).not.toThrow()
  })
})

describe('chatGate', () => {
  it('one message per 2 seconds', () => {
    const g = chatGate('c')
    expect(g.check(0)).toBe(null)
    expect(g.check(1999)).toMatch(/2 seconds/)
    expect(g.check(2000)).toBe(null)
  })

  it('30 messages per hour', () => {
    const g = chatGate('c')
    for (let i = 0; i < 30; i++) expect(g.check(i * 2000)).toBe(null)
    expect(g.check(30 * 2000)).toMatch(/30 messages/)
    expect(g.check(3600000 + 2000)).toBe(null)
  })
})
