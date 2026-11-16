import { describe, it, expect } from 'vitest'
import { buildUpiLink } from './upi.js'

describe('buildUpiLink', () => {
  it('builds the exact format', () => {
    expect(buildUpiLink({ upiId: 'ravi@ybl', name: 'Ravi', paise: 170000 }))
      .toBe('upi://pay?pa=ravi%40ybl&pn=Ravi&am=1700.00&cu=INR&tn=Tally')
  })

  it('encodes the name and uses 2 decimals from paise', () => {
    expect(buildUpiLink({ upiId: 'a.b-c_d@okhdfc', name: "Ravi K & Co's", paise: 5 }))
      .toBe("upi://pay?pa=a.b-c_d%40okhdfc&pn=Ravi%20K%20%26%20Co's&am=0.05&cu=INR&tn=Tally")
  })

  it('emits only the five allowed parameters', () => {
    const link = buildUpiLink({ upiId: 'ravi@ybl', name: 'Ravi', paise: 100 })
    const keys = link.split('?')[1].split('&').map((p) => p.split('=')[0])
    expect(keys).toEqual(['pa', 'pn', 'am', 'cu', 'tn'])
  })

  it.each([
    'ravi', 'ravi@', '@ybl', 'r@ybl', 'ravi@y', 'ravi@ybl1', 'ravi@ybl&am=1', 'ravi@ybl?x=1',
    'ra vi@ybl', 'hacker@upi&pa=evil@ybl', '', null, 42,
  ])('rejects UPI id %s', (upiId) => {
    expect(buildUpiLink({ upiId, name: 'Ravi', paise: 100 })).toBeNull()
  })

  it.each([0, -1, 1.5, NaN, Infinity, 10000001, '100'])('rejects amount %s', (paise) => {
    expect(buildUpiLink({ upiId: 'ravi@ybl', name: 'Ravi', paise })).toBeNull()
  })

  it('rejects names that fail validation', () => {
    expect(buildUpiLink({ upiId: 'ravi@ybl', name: '<script>', paise: 100 })).toBeNull()
    expect(buildUpiLink({ upiId: 'ravi@ybl', name: 'x'.repeat(31), paise: 100 })).toBeNull()
  })
})
