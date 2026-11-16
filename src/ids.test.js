import { describe, it, expect } from 'vitest'
import { uuid, inviteCode, isInviteCode, memberToken, sha256 } from './ids.js'

describe('ids', () => {
  it('uuid is v4 shaped and unique', () => {
    const seen = new Set()
    for (let i = 0; i < 200; i++) {
      const u = uuid()
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      seen.add(u)
    }
    expect(seen.size).toBe(200)
  })

  it('invite codes use the unambiguous alphabet and validate', () => {
    for (let i = 0; i < 500; i++) {
      const c = inviteCode()
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
      expect(isInviteCode(c)).toBe(true)
    }
    for (const bad of ['ABCDE', 'ABCDEFG', 'ABCDE0', 'ABCDEO', 'ABCDE1', 'ABCDEI', 'abcdef', null, 123456]) {
      expect(isInviteCode(bad)).toBe(false)
    }
  })

  it('member tokens are 128-bit hex', () => {
    const a = memberToken()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(memberToken()).not.toBe(a)
  })

  it('sha256 matches the standard test vector', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
