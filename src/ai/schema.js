// Strict allow-list parser for model output. Anything unexpected is rejected.

import { validateTitle, validateName, CATEGORIES } from '../validate.js'
import { MODES } from '../engine/split.js'

export const INTENTS = ['add_expense', 'who_owes', 'next_payer', 'explain_balance', 'claim', 'settle_me', 'unclear']

const KEYS = ['intent', 'title', 'total_rupees', 'payer', 'participants', 'mode', 'own_rupees', 'custom', 'category', 'question']
const SPECIAL_NAMES = ['me', 'all']
const MAX_RUPEES = 100000

const reject = (why) => ({ ok: false, error: why })
const isNull = (v) => v === null || v === undefined

function okName(n) {
  if (typeof n !== 'string') return false
  if (SPECIAL_NAMES.includes(n.toLowerCase())) return true
  return validateName(n).ok
}

function okRupees(v, min) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= MAX_RUPEES && Math.abs(Math.round(v * 100) - v * 100) < 1e-6
}

export function strictParse(text) {
  if (typeof text !== 'string' || text.length > 4000) return reject('not text')
  const t = text.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return reject('not bare JSON')
  let o
  try { o = JSON.parse(t) } catch { return reject('invalid JSON') }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return reject('not an object')
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) return reject(`unknown key ${k}`)
  if (!INTENTS.includes(o.intent)) return reject('bad intent')
  if (!isNull(o.title) && !(typeof o.title === 'string' && validateTitle(o.title).ok)) return reject('bad title')
  if (!isNull(o.total_rupees) && !okRupees(o.total_rupees, 0.01)) return reject('bad total')
  if (!isNull(o.own_rupees) && !okRupees(o.own_rupees, 0)) return reject('bad own')
  if (!isNull(o.payer) && !okName(o.payer)) return reject('bad payer')
  if (!isNull(o.mode) && !MODES.includes(o.mode)) return reject('bad mode')
  if (!isNull(o.category) && !CATEGORIES.includes(o.category)) return reject('bad category')
  if (!isNull(o.question) && !(typeof o.question === 'string' && o.question.length <= 200)) return reject('bad question')
  if (!isNull(o.participants)) {
    if (!Array.isArray(o.participants) || o.participants.length > 20 || !o.participants.every(okName)) return reject('bad participants')
  }
  if (!isNull(o.custom)) {
    if (!Array.isArray(o.custom) || o.custom.length > 20) return reject('bad custom')
    for (const c of o.custom) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return reject('bad custom row')
      const ks = Object.keys(c)
      if (ks.length !== 2 || !ks.includes('name') || !ks.includes('rupees')) return reject('bad custom keys')
      if (!okName(c.name) || !okRupees(c.rupees, 0)) return reject('bad custom value')
    }
  }
  const value = {}
  for (const k of KEYS) value[k] = isNull(o[k]) ? null : o[k]
  return { ok: true, value }
}
