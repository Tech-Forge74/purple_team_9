// Every input is checked here, at the boundary, before it is used or saved.

export const LIMITS = {
  NAME_MAX: 30,
  TITLE_MAX: 40,
  MIN_PAISE: 1,
  MAX_PAISE: 10000000, // ₹1,00,000
  MAX_MEMBERS: 20,
  MAX_EXPENSES: 500,
  CHAT_MAX: 300,
}

const NAME_RE = /^[\p{L}\p{M}\p{N} .,'\-_&()]+$/u
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g
const URL_RE = /(https?:|ftp:|www\.|:\/\/|\]\(|\b[a-z0-9-]+\.(com|in|net|org|io|xyz|ly|me|co|app|dev|link)\b)/i

const fail = (error) => ({ ok: false, error })
const pass = (value) => ({ ok: true, value })

export function cleanText(s) {
  return String(s ?? '').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim()
}

export function validateName(input) {
  if (typeof input !== 'string') return fail('Enter a name.')
  const s = cleanText(input)
  if (s.length < 1) return fail('Enter a name.')
  if (s.length > LIMITS.NAME_MAX) return fail(`Names can be at most ${LIMITS.NAME_MAX} characters.`)
  if (!NAME_RE.test(s)) return fail('Names can use letters, digits, spaces and basic punctuation only.')
  return pass(s)
}

export function validateTitle(input) {
  if (typeof input !== 'string') return fail('Enter a title.')
  const s = cleanText(input)
  if (s.length < 1) return fail('Enter a title.')
  if (s.length > LIMITS.TITLE_MAX) return fail(`Titles can be at most ${LIMITS.TITLE_MAX} characters.`)
  if (URL_RE.test(s)) return fail('Titles cannot contain links.')
  if (s.includes('@')) return fail('Titles cannot contain "@".')
  return pass(s)
}

export function validateUpi(input) {
  if (typeof input !== 'string') return fail('Enter a UPI ID like name@bank.')
  const s = input.trim()
  if (!UPI_RE.test(s)) return fail('Enter a valid UPI ID like name@bank.')
  return pass(s)
}

export function isValidPaise(n) {
  return Number.isSafeInteger(n) && n >= LIMITS.MIN_PAISE && n <= LIMITS.MAX_PAISE
}

export function validatePaise(n) {
  if (!Number.isSafeInteger(n)) return fail('Enter a valid amount.')
  if (n < LIMITS.MIN_PAISE) return fail('Amount must be positive.')
  if (n > LIMITS.MAX_PAISE) return fail('That amount is above the ₹1,00,000 limit.')
  return pass(n)
}

function toPaise(input) {
  const s = String(input ?? '').trim().replace(/,/g, '')
  if (s === '') return fail('Enter an amount.')
  if (/^[-−]/.test(s)) return fail('Amount must be positive.')
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return fail('Enter an amount like 450 or 450.50.')
  return pass(Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')))
}

// "1,234.50" typed in a form -> integer paise (1 to max). No floats are kept.
export function parseRupeesInput(input) {
  const r = toPaise(input)
  return r.ok ? validatePaise(r.value) : r
}

// Same, but 0 is allowed (own share, custom amounts).
export function parseRupeesNonNeg(input) {
  const r = toPaise(input)
  if (!r.ok) return r
  if (r.value > LIMITS.MAX_PAISE) return fail('That amount is above the ₹1,00,000 limit.')
  return r
}

export const CATEGORIES = ['food', 'travel', 'stay', 'fuel', 'fun', 'shopping', 'other']
