// Random values come from crypto.getRandomValues only. Never Math.random.

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0, O, 1, I

function bytes(n) {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

export function uuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const b = bytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function inviteCode() {
  // 32 letters divide 256 exactly, so x % 32 has no bias.
  return [...bytes(6)].map((x) => INVITE_ALPHABET[x % 32]).join('')
}

export function isInviteCode(s) {
  return typeof s === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(s)
}

// 128 random bits, not derived from the name, id or invite code.
export function memberToken() {
  return hex(bytes(16))
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text)
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data)))
}
