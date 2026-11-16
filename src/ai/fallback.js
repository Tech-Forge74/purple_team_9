// Rule-based parser. No model, so it cannot be injected. It returns the same
// JSON shape as the model, and goes through the same validator and confirm step.

import { extractAmounts } from './numbers.js'

const KEYWORDS = {
  food: ['dinner', 'lunch', 'breakfast', 'chai', 'tea', 'coffee', 'snacks', 'food', 'pizza', 'drinks', 'biryani', 'groceries', 'dessert', 'meal', 'juice', 'icecream'],
  travel: ['cab', 'taxi', 'uber', 'ola', 'auto', 'bus', 'train', 'flight', 'metro', 'toll', 'parking'],
  stay: ['hotel', 'rent', 'room', 'hostel', 'airbnb', 'stay', 'homestay'],
  fuel: ['petrol', 'diesel', 'fuel'],
  fun: ['tickets', 'ticket', 'movie', 'kayaking', 'party', 'game', 'concert', 'trek', 'bowling'],
  shopping: ['shopping', 'clothes', 'gift', 'supplies'],
}

const ME = ['me', 'myself', 'i', 'mine']
const ALL = ['everyone', 'all', 'all of us', 'us', 'everybody', 'the group', 'whole group', 'the gang']
const NOT_PAYER = ['split', 'all', 'rest', 'bill', 'who', 'and', 'also', 'just', 'have', 'has', 'was', 'already']

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const clean = (s) => s.trim().replace(/^the\s+/i, '').replace(/['’]s$/i, '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim()

function findTitle(low) {
  for (const [category, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      if (new RegExp(`\\b${w}\\b`).test(low)) return { title: cap(w), category }
    }
  }
  const m = /\bfor\s+([a-z][a-z ]{1,25}?)(?=\s*(?:[,.!?;]|split|between|among|paid|with|except|$))/.exec(low)
  if (m && !/^(all|everyone|us|everybody)\b/.test(m[1])) return { title: cap(m[1].trim()), category: 'other' }
  return { title: 'Expense', category: 'other' }
}

function parseList(chunk) {
  const cut = chunk.split(/\b(?:for|on|at|paid|rest|my share|my part|equally|each|split)\b/i)[0]
  const out = []
  for (const raw of cut.split(/,|\band\b|&|\+/i)) {
    const t = clean(raw)
    if (!t) continue
    const l = t.toLowerCase()
    if (ME.includes(l)) out.push('me')
    else if (ALL.includes(l)) out.push('all')
    else if (t.split(/\s+/).length <= 2) out.push(t)
  }
  return out
}

function findPayer(text, low, isTreat) {
  let m = /\bpaid\s+by\s+([\p{L}]+)/iu.exec(text)
  if (m) return ME.includes(m[1].toLowerCase()) ? 'me' : m[1]
  if (/\bi(?:['’]m| am)?\s+(?:treating|paid|spent|covered|pay|paying)\b/i.test(text)) return 'me'
  m = /\b([\p{L}]+)\s+(?:is\s+treating|treated|treats|paid|has\s+paid|spent|covered)\b/iu.exec(text)
  if (m && !NOT_PAYER.includes(m[1].toLowerCase())) return ME.includes(m[1].toLowerCase()) ? 'me' : m[1]
  if (isTreat) return 'me'
  return null
}

function detectIntent(low, hasAmount) {
  if (/who should pay|pay next|next bill|next payer|whose turn/.test(low)) return 'next_payer'
  if (/\b(claim|collect|request)\b|\bremind\b/.test(low)) return 'claim'
  if (/\bsettle (me|up|my)\b/.test(low)) return 'settle_me'
  if (/\bwhy\b.*\bowe\b|how much do i owe|what do i owe|\bmy balance\b|how much .*\bowe\b|\bexplain\b/.test(low)) return 'explain_balance'
  if (/\bwho owes\b/.test(low)) return 'who_owes'
  if (hasAmount) return 'add_expense'
  return 'unclear'
}

export function parseFallback(sentence, memberNames = [], meName = null) {
  const text = String(sentence ?? '').slice(0, 300)
  const low = text.toLowerCase()
  const amounts = extractAmounts(text)
  const base = { intent: 'unclear', title: null, total_rupees: null, payer: null, participants: null, mode: null, own_rupees: null, custom: null, category: null, question: null }
  const intent = detectIntent(low, amounts.length > 0)
  base.intent = intent

  const named = memberNames.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))

  if (intent !== 'add_expense') {
    if (/\b(everyone|everybody|all)\b/.test(low)) base.participants = ['all']
    else if (named.length) base.participants = named
    return base
  }

  // Own share: the first amount after "my share/part is".
  const ownAt = low.search(/\bmy\s+(?:share|part|portion)\b/)
  let ownAmt = null
  if (ownAt >= 0) ownAmt = amounts.find((a) => a.index > ownAt) ?? null
  const totalAmt = amounts.find((a) => a !== ownAmt)
  if (!totalAmt) return { ...base, intent: 'add_expense' }

  const toRupees = (a) => (a.valid ? (a.negative ? -1 : 1) * a.paise / 100 : NaN)
  base.total_rupees = toRupees(totalAmt)
  const isTreat = /\btreat(?:ing|ed|s)?\b/.test(low)
  if (isTreat) base.mode = 'treat'
  else if (ownAmt) { base.mode = 'my_part'; base.own_rupees = toRupees(ownAmt) }
  else if (/\b(full bill|whole bill|paid for everyone)\b/.test(low)) base.mode = 'full'
  else base.mode = 'equal'

  base.payer = findPayer(text, low, isTreat)
  Object.assign(base, findTitle(low))

  let m
  if ((m = /\b(?:except|but not|excluding|apart from)\s+(.+?)(?:[.!?;]|$)/i.exec(text))) {
    const excluded = parseList(m[1])
    const unknown = excluded.filter((n) => n !== 'me' && n !== 'all' && !memberNames.some((x) => x.toLowerCase() === n.toLowerCase()))
    const ex = excluded.map((n) => (n === 'me' && meName ? meName : n).toLowerCase())
    base.participants = unknown.length ? unknown : memberNames.filter((n) => !ex.includes(n.toLowerCase()))
  } else if ((m = /\bonly\s+(.+?)(?:[.!?;]|$)/i.exec(text)) || (m = /\b(?:between|among|amongst|split with|shared with|with)\s+(.+?)(?:[.!?;]|$)/i.exec(text))) {
    const list = parseList(m[1])
    if (list.length) base.participants = list
  } else if (/\bfor (all of us|everyone|everybody|us all)\b/.test(low)) {
    base.participants = ['all']
  }
  return base
}
