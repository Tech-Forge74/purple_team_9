// localStorage backend. One key per group: tally:g:<id> = { group, expenses:{}, payments:{}, claims:{} }
// plus tally:codes = { inviteCode: groupId }. Falls back to memory when storage is unavailable.
// Two tabs on the same browser sync live through the 'storage' event.

const mem = new Map()
const memStore = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
}

// Resolved on every call so tests (and private windows) work.
export function kv() {
  try {
    const ls = globalThis.localStorage
    if (ls) {
      ls.setItem('tally:__probe', '1')
      ls.removeItem('tally:__probe')
      return ls
    }
  } catch { /* blocked */ }
  return memStore
}

export function readJSON(key, fallback) {
  try {
    const raw = kv().getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJSON(key, value) {
  kv().setItem(key, JSON.stringify(value))
}

const COLLS = ['expenses', 'payments', 'claims']
const gkey = (id) => `tally:g:${id}`
const listeners = new Map() // groupId -> Set(cb)

const byTime = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1)

function readGroup(id) {
  return readJSON(gkey(id), null)
}

function toSnapshot(rec) {
  if (!rec) return { group: null, expenses: [], payments: [], claims: [] }
  return {
    group: rec.group,
    expenses: Object.values(rec.expenses || {}).sort(byTime),
    payments: Object.values(rec.payments || {}).sort(byTime),
    claims: Object.values(rec.claims || {}).sort(byTime),
  }
}

function notify(id) {
  const set = listeners.get(id)
  if (!set || !set.size) return
  const snap = toSnapshot(readGroup(id))
  for (const cb of [...set]) queueMicrotask(() => cb(snap))
}

let storageHooked = false
function hookStorage() {
  if (storageHooked || typeof window === 'undefined' || !window.addEventListener) return
  storageHooked = true
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('tally:g:')) notify(e.key.slice(8))
  })
}

function saveRec(id, rec) {
  writeJSON(gkey(id), rec)
  notify(id)
}

export const local = {
  backend: 'local',

  subscribe(groupId, cb) {
    hookStorage()
    if (!listeners.has(groupId)) listeners.set(groupId, new Set())
    listeners.get(groupId).add(cb)
    const snap = toSnapshot(readGroup(groupId))
    queueMicrotask(() => cb(snap))
    return () => listeners.get(groupId)?.delete(cb)
  },

  async getSnapshot(groupId) {
    return toSnapshot(readGroup(groupId))
  },

  async getGroup(groupId) {
    return readGroup(groupId)?.group ?? null
  },

  async findGroupIdByCode(code) {
    const codes = readJSON('tally:codes', {})
    const id = codes[code]
    if (!id) return null
    const g = readGroup(id)?.group
    return g && g.inviteCode === code ? id : null
  },

  async createGroup(group) {
    if (readGroup(group.id)) throw new Error('exists')
    const codes = readJSON('tally:codes', {})
    codes[group.inviteCode] = group.id
    writeJSON('tally:codes', codes)
    saveRec(group.id, { group, expenses: {}, payments: {}, claims: {} })
  },

  async mutateGroup(groupId, fn) {
    const rec = readGroup(groupId)
    if (!rec) throw Object.assign(new Error('Group not found.'), { userMessage: 'Group not found.' })
    const before = rec.group
    const next = fn(structuredClone(before))
    if (!next || next.id !== groupId) throw new Error('bad mutation')
    if (next.inviteCode !== before.inviteCode) {
      const codes = readJSON('tally:codes', {})
      delete codes[before.inviteCode]
      codes[next.inviteCode] = groupId
      writeJSON('tally:codes', codes)
    }
    saveRec(groupId, { ...rec, group: next })
    return next
  },

  async create(coll, doc) {
    if (!COLLS.includes(coll)) throw new Error('bad collection')
    const rec = readGroup(doc.groupId)
    if (!rec) throw Object.assign(new Error('Group not found.'), { userMessage: 'Group not found.' })
    rec[coll] = rec[coll] || {}
    if (rec[coll][doc.id]) return 'exists'
    rec[coll][doc.id] = doc
    saveRec(doc.groupId, rec)
    return 'created'
  },

  async update(coll, id, patch) {
    if (!COLLS.includes(coll)) throw new Error('bad collection')
    const gid = patch.groupId
    // find the record's group: patch must carry groupId, or we search known groups
    const ids = gid ? [gid] : Object.values(readJSON('tally:codes', {}))
    for (const g of ids) {
      const rec = readGroup(g)
      if (rec?.[coll]?.[id]) {
        rec[coll][id] = { ...rec[coll][id], ...patch, id, groupId: rec[coll][id].groupId }
        saveRec(g, rec)
        return
      }
    }
    throw new Error('not found')
  },
}
