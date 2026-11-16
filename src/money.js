// Display helpers only. All money maths happens in integer paise inside src/engine.

export function formatINR(paise) {
  if (!Number.isSafeInteger(paise)) return '₹—'
  const abs = Math.abs(paise)
  const s = String(Math.floor(abs / 100))
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  const p = abs % 100
  return (paise < 0 ? '−' : '') + '₹' + grouped + (p ? '.' + String(p).padStart(2, '0') : '')
}

export function paiseToRupeeString(paise) {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`
}

// Rupees (number, at most 2 decimals) -> paise, or null.
export function rupeesToPaise(r) {
  if (typeof r !== 'number' || !Number.isFinite(r)) return null
  const p = Math.round(r * 100)
  if (Math.abs(p - r * 100) > 1e-6) return null
  return Number.isSafeInteger(p) ? p : null
}
