import { validateUpi, validateName, isValidPaise } from './validate.js'
import { paiseToRupeeString } from './money.js'

// The only place a UPI link is built. Never fed AI output or free text.
export function buildUpiLink({ upiId, name, paise }) {
  const u = validateUpi(upiId)
  const n = validateName(name)
  if (!u.ok || !n.ok || !isValidPaise(paise)) return null
  const params = [
    ['pa', u.value],
    ['pn', n.value],
    ['am', paiseToRupeeString(paise)],
    ['cu', 'INR'],
    ['tn', 'Tally'],
  ]
  return 'upi://pay?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}
