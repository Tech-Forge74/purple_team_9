// Finds amounts written in a sentence: "2400", "2,400", "₹2400", "Rs 2400",
// "2.4k", "२४००", "two thousand four hundred". Returns integer paise.

const DEVANAGARI = '०१२३४५६७८९'

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALES = { hundred: 100, thousand: 1000, lakh: 100000, lac: 100000, lakhs: 100000 }

const isNumWord = (w) => w in UNITS || w in TENS || w in SCALES

function wordsToNumber(words) {
  let total = 0
  let current = 0
  for (const w of words) {
    if (w in UNITS) current += UNITS[w]
    else if (w in TENS) current += TENS[w]
    else if (w === 'hundred') current = (current || 1) * 100
    else if (w in SCALES) { total += (current || 1) * SCALES[w]; current = 0 }
  }
  return total + current
}

const SEP = /^[ \t-]+$/

// Replace runs of number words ("two thousand four hundred") with digits.
export function replaceNumberWords(text) {
  const toks = text.match(/[A-Za-z]+|[^A-Za-z]+/g) || []
  const low = toks.map((t) => t.toLowerCase())
  let out = ''
  let i = 0
  while (i < toks.length) {
    if (!isNumWord(low[i])) { out += toks[i]; i++; continue }
    const words = [low[i]]
    let end = i
    let j = i + 1
    while (j + 1 < toks.length && SEP.test(toks[j])) {
      if (isNumWord(low[j + 1])) { words.push(low[j + 1]); end = j + 1; j += 2 }
      else if (low[j + 1] === 'and' && j + 3 < toks.length && SEP.test(toks[j + 2]) && isNumWord(low[j + 3])) j += 2
      else break
    }
    out += String(wordsToNumber(words))
    i = end + 1
  }
  return out
}

export function normalise(text) {
  let s = String(text ?? '')
  s = s.replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)))
  s = replaceNumberWords(s)
  return s
}

const AMOUNT_RE = /(^|[^\w.])([-−]\s?)?(?:₹|rs\.?|inr)?\s?([-−])?(\d+(?:,\d+)*)(?:\.(\d+))?(\s?k\b)?/gi

// Returns [{ paise, negative, index, valid }]. `valid` is false for more than 2 decimals.
export function extractAmounts(text) {
  const s = normalise(text)
  const out = []
  for (const m of s.matchAll(AMOUNT_RE)) {
    const intPart = m[4].replace(/,/g, '')
    const frac = m[5] ?? ''
    const negative = Boolean(m[2] || m[3])
    const valid = frac.length <= 2 && intPart.length <= 12
    let paise = valid ? Number(intPart) * 100 + Number(frac.padEnd(2, '0')) : NaN
    if (m[6] && valid) paise *= 1000
    out.push({ paise, negative, index: m.index + m[1].length, valid })
  }
  return out
}

// The set of amounts the user really typed, used to check model output.
export function amountsInSentence(text) {
  return new Set(extractAmounts(text).filter((a) => a.valid).map((a) => a.paise))
}
