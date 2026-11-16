import { describe, it, expect } from 'vitest'
import { formatINR, paiseToRupeeString, rupeesToPaise } from './money.js'

describe('money', () => {
  it('formats paise in Indian grouping', () => {
    expect(formatINR(0)).toBe('₹0')
    expect(formatINR(5)).toBe('₹0.05')
    expect(formatINR(45050)).toBe('₹450.50')
    expect(formatINR(10000000)).toBe('₹1,00,000')
    expect(formatINR(12345678)).toBe('₹1,23,456.78')
    expect(formatINR(-170000)).toBe('−₹1,700')
  })

  it('refuses to format anything that is not a safe integer', () => {
    for (const bad of [1.5, NaN, Infinity, '100', null, undefined, 2 ** 60]) expect(formatINR(bad)).toBe('₹—')
  })

  it('paise -> rupee string for UPI links', () => {
    expect(paiseToRupeeString(1)).toBe('0.01')
    expect(paiseToRupeeString(45050)).toBe('450.50')
    expect(paiseToRupeeString(10000000)).toBe('100000.00')
  })

  it('rupees -> paise keeps two decimals and rejects more', () => {
    expect(rupeesToPaise(450)).toBe(45000)
    expect(rupeesToPaise(19.99)).toBe(1999)
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30)
    expect(rupeesToPaise(1.005)).toBe(null)
    for (const bad of ['450', NaN, Infinity, null, 1e300]) expect(rupeesToPaise(bad)).toBe(null)
  })
})
