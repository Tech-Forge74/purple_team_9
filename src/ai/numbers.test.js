import { describe, it, expect } from 'vitest'
import { extractAmounts, amountsInSentence, normalise } from './numbers.js'

const first = (s) => extractAmounts(s)[0]?.paise

describe('amount normalisation', () => {
  it.each([
    ['Dinner 2400', 240000],
    ['Dinner 2,400', 240000],
    ['Dinner ₹2400', 240000],
    ['Dinner Rs 2400', 240000],
    ['Dinner rs.2400', 240000],
    ['Dinner 2.4k', 240000],
    ['Dinner २४००', 240000],
    ['Dinner two thousand four hundred', 240000],
    ['Dinner two thousand and four hundred', 240000],
    ['Dinner 450.50', 45050],
    ['1,00,000 rent', 10000000],
  ])('%s', (s, p) => expect(first(s)).toBe(p))

  it('flags negatives and too many decimals', () => {
    expect(extractAmounts('Paid -500 for lunch')[0]).toMatchObject({ paise: 50000, negative: true })
    expect(extractAmounts('Paid 5.123')[0].valid).toBe(false)
  })

  it('keeps other words intact', () => {
    expect(normalise('Ravi paid two hundred for tea')).toBe('Ravi paid 200 for tea')
    expect(normalise('everyone')).toBe('everyone')
  })

  it('ignores digits inside words', () => {
    expect(amountsInSentence('m2 paid 300').has(30000)).toBe(true)
    expect(amountsInSentence('m2 paid 300').has(200)).toBe(false)
  })

  it('never crashes on odd input', () => {
    for (const s of ['', null, undefined, '₹', '..,,', 'k', '🙂🙂', 'x'.repeat(5000), '9'.repeat(40)]) {
      expect(() => extractAmounts(s)).not.toThrow()
    }
  })
})
