// Who this device is, per group. Kept in localStorage (memory fallback).
// The raw member token lives only here and in the URL fragment it came from.

import { readJSON, writeJSON, kv } from './db/local.js'
import { uuid } from './ids.js'

function changed() {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('tally:session'))
  } catch { /* ignore */ }
}

export function getDeviceId() {
  let id = readJSON('tally:device', null)
  if (typeof id !== 'string' || !id) {
    id = uuid()
    writeJSON('tally:device', id)
  }
  return id
}

export function getSession(groupId) {
  const s = readJSON(`tally:session:${groupId}`, null)
  return s && typeof s.memberId === 'string' && typeof s.token === 'string' ? s : null
}

export function setSession(groupId, s) {
  writeJSON(`tally:session:${groupId}`, s)
  changed()
}

export function clearSession(groupId) {
  try { kv().removeItem(`tally:session:${groupId}`) } catch { /* ignore */ }
  changed()
}

export function getCurrentGroupId() {
  const id = readJSON('tally:current', null)
  return typeof id === 'string' ? id : null
}

export function setCurrentGroupId(id) {
  writeJSON('tally:current', id ?? null)
  changed()
}

export function listMyGroups() {
  const list = readJSON('tally:groups', [])
  return Array.isArray(list) ? list.filter((g) => g && typeof g.id === 'string') : []
}

export function rememberGroup(id, name) {
  const list = listMyGroups().filter((g) => g.id !== id)
  list.unshift({ id, name })
  writeJSON('tally:groups', list.slice(0, 20))
}

export function forgetGroup(id) {
  writeJSON('tally:groups', listMyGroups().filter((g) => g.id !== id))
}

export function saveCreatorToken(groupId, memberId, token) {
  const t = readJSON(`tally:tokens:${groupId}`, {})
  t[memberId] = token
  writeJSON(`tally:tokens:${groupId}`, t)
}

export function getCreatorTokens(groupId) {
  const t = readJSON(`tally:tokens:${groupId}`, {})
  return t && typeof t === 'object' ? t : {}
}

export function dismissedDeviceBanner(groupId) {
  return readJSON(`tally:devbanner:${groupId}`, false) === true
}

export function dismissDeviceBanner(groupId) {
  writeJSON(`tally:devbanner:${groupId}`, true)
  changed()
}
