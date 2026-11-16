// Every write goes through here. Each action validates its input, checks who
// is acting, re-checks the money invariants on fresh data, and fails closed.
// Actions never throw: they return { ok: true, ... } or { ok: false, error }.

import db from './db.js'
import * as S from './session.js'
import { uuid, inviteCode, isInviteCode, memberToken, sha256 } from './ids.js'
import { validateName, validateUpi, validateTitle, LIMITS, CATEGORIES, isValidPaise } from './validate.js'
import { computeSplit, MODES } from './engine/split.js'
import { buildLedger, checkWrite } from './engine/ledger.js'
import { owedBetween } from './engine/settle.js'
import { checkPayment, checkClaim, canRespond, canUndo } from './engine/claims.js'
import { buildDemoExpenses, DEMO_MEMBERS } from './engine/demo.js'
import { buildUpiLink } from './upi.js'
import { formatINR } from './money.js'
import { failureGate } from './ratelimit.js'

const GENERIC = 'Something went wrong. Nothing was saved.'
const INVALID_LINK = 'This link is no longer valid.'
const STALE = 'Balances changed. Review before paying'
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const TOKEN_RE = /^[0-9a-f]{32}$/

const fail = (error, extra = {}) => ({ ok: false, error, ...extra })

class UserError extends Error {
  constructor(msg) { super(msg); this.userMessage = msg }
}

async function safe(fn) {
  try {
    return await fn()
  } catch (e) {
    // Quiet errors: never log user data, UPI IDs or links.
    if (!e?.userMessage) console.error('tally action failed')
    return fail(e?.userMessage || GENERIC)
  }
}

const active = (g) => (g?.members ?? []).filter((m) => !m.removed)
const findMember = (g, id) => (g?.members ?? []).find((m) => m.id === id && !m.removed) ?? null

function uniqueName(name, members) {
  const taken = new Set(members.map((m) => m.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  for (let i = 2; i < 100; i++) {
    const suffix = ` ${i}`
    const candidate = name.slice(0, LIMITS.NAME_MAX - suffix.length).trim() + suffix
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  throw new UserError('That name is taken. Try another.')
}

async function newMember(name, upiId, devices = []) {
  const token = memberToken()
  const member = {
    id: uuid(), name, upiId, tokenHash: await sha256(token), devices, removed: false, joinedAt: Date.now(),
  }
  return { member, token }
}

function checkIdentity(name, upiId) {
  const n = validateName(name)
  if (!n.ok) return n
  const u = validateUpi(upiId)
  if (!u.ok) return u
  return { ok: true, name: n.value, upiId: u.value }
}

async function freshCode() {
  for (let i = 0; i < 6; i++) {
    const c = inviteCode()
    if (!(await db.findGroupIdByCode(c))) return c
  }
  throw new UserError('Could not create an invite code. Try again.')
}

function enter(groupId, name, session) {
  S.setSession(groupId, session)
  S.rememberGroup(groupId, name)
  S.setCurrentGroupId(groupId)
}

// ---------- identity ----------

export async function verifySessionAsync(groupId) {
  try {
    const s = S.getSession(groupId)
    if (!s) return { ok: false, error: INVALID_LINK }
    const group = await db.getGroup(groupId)
    const member = findMember(group, s.memberId)
    if (!member || member.tokenHash !== (await sha256(s.token))) return { ok: false, error: INVALID_LINK }
    const isCreator = Boolean(s.creator && group.creatorId === member.id)
    const canSwitch = Boolean(group.demo || isCreator)
    const me = canSwitch && s.actingAs && findMember(group, s.actingAs) ? s.actingAs : member.id
    return { ok: true, me, realMe: member.id, canSwitch, isCreator, group }
  } catch {
    return { ok: false, error: INVALID_LINK }
  }
}

// `me` passed from the UI must be who this device is acting as.
async function authorise(groupId, me) {
  const v = await verifySessionAsync(groupId)
  if (!v.ok || v.me !== me) throw new UserError('You are not signed in to this group on this device.')
  return v
}

export async function createGroup({ groupName, name, upiId }) {
  return safe(async () => {
    const gn = validateTitle(groupName ?? '')
    if (!gn.ok) return fail(gn.error.replace('Titles', 'Group names').replace('a title', 'a group name'))
    const id = checkIdentity(name, upiId)
    if (!id.ok) return fail(id.error)
    const { member, token } = await newMember(id.name, id.upiId, [S.getDeviceId()])
    const group = {
      id: uuid(), name: gn.value, inviteCode: await freshCode(), createdAt: Date.now(), demo: false,
      creatorId: member.id, members: [member],
    }
    await db.createGroup(group)
    S.saveCreatorToken(group.id, member.id, token)
    enter(group.id, group.name, { memberId: member.id, token, creator: true })
    return { ok: true, groupId: group.id }
  })
}

export async function loadDemoGroup() {
  return safe(async () => {
    const made = []
    for (const m of DEMO_MEMBERS) made.push(await newMember(m.name, m.upiId))
    const ids = {}
    made.forEach(({ member }) => { ids[member.name] = member.id })
    const ankit = made[0]
    ankit.member.devices = [S.getDeviceId()]
    const group = {
      id: uuid(), name: 'Goa Trip', inviteCode: await freshCode(), createdAt: Date.now(), demo: true,
      creatorId: ankit.member.id, members: made.map((x) => x.member),
    }
    await db.createGroup(group)
    const expenses = buildDemoExpenses(group.id, ids, uuid, Date.now() - 60000)
    for (const e of expenses) await db.create('expenses', e)
    for (const { member, token } of made) S.saveCreatorToken(group.id, member.id, token)
    enter(group.id, group.name, { memberId: ankit.member.id, token: ankit.token, creator: true })
    return { ok: true, groupId: group.id }
  })
}

export async function joinGroup({ code, name, upiId }) {
  return safe(async () => {
    const gate = failureGate('tally:rl:join')
    const wait = gate.lockedFor()
    if (wait > 0) return fail(`Too many wrong codes. Try again in ${Math.ceil(wait / 1000)} seconds.`)
    const id = checkIdentity(name, upiId)
    if (!id.ok) return fail(id.error)
    const c = String(code ?? '').trim().toUpperCase()
    const groupId = isInviteCode(c) ? await db.findGroupIdByCode(c) : null
    if (!groupId) {
      gate.fail()
      return fail('That code did not work. Check it and try again.')
    }
    const { member, token } = await newMember(id.name, id.upiId, [S.getDeviceId()])
    const group = await db.mutateGroup(groupId, (g) => {
      if (g.inviteCode !== c) throw new UserError('That code did not work. Check it and try again.')
      if (active(g).length >= LIMITS.MAX_MEMBERS) throw new UserError('This group is full (20 members).')
      member.name = uniqueName(member.name, active(g))
      g.members.push(member)
      return g
    })
    enter(groupId, group.name, { memberId: member.id, token, creator: false })
    return { ok: true, groupId, name: member.name }
  })
}

export async function addMemberByCreator(groupId, { name, upiId }) {
  return safe(async () => {
    const v = await verifySessionAsync(groupId)
    if (!v.ok || !v.isCreator) return fail('Only the group creator can add members.')
    const id = checkIdentity(name, upiId)
    if (!id.ok) return fail(id.error)
    const { member, token } = await newMember(id.name, id.upiId)
    await db.mutateGroup(groupId, (g) => {
      if (active(g).length >= LIMITS.MAX_MEMBERS) throw new UserError('This group is full (20 members).')
      member.name = uniqueName(member.name, active(g))
      g.members.push(member)
      return g
    })
    S.saveCreatorToken(groupId, member.id, token)
    return { ok: true, memberId: member.id, token, name: member.name }
  })
}

export async function openPersonalLink(groupId, token) {
  return safe(async () => {
    const gate = failureGate('tally:rl:link')
    if (gate.lockedFor() > 0) return fail(INVALID_LINK)
    if (typeof groupId !== 'string' || !ID_RE.test(groupId) || typeof token !== 'string' || !TOKEN_RE.test(token)) {
      gate.fail()
      return fail(INVALID_LINK)
    }
    const group = await db.getGroup(groupId)
    const hash = await sha256(token)
    const member = active(group).find((m) => m.tokenHash === hash)
    if (!member) {
      gate.fail()
      return fail(INVALID_LINK)
    }
    const deviceId = S.getDeviceId()
    const devices = member.devices ?? []
    const newDevice = devices.length > 0 && !devices.includes(deviceId)
    if (!devices.includes(deviceId)) {
      await db.mutateGroup(groupId, (g) => {
        const m = g.members.find((x) => x.id === member.id)
        if (m) m.devices = [...(m.devices ?? []), deviceId].slice(-10)
        return g
      })
    }
    const prev = S.getSession(groupId)
    const creator = Boolean(prev?.creator && prev.memberId === member.id)
    enter(groupId, group.name, { memberId: member.id, token, creator })
    return { ok: true, groupId, newDevice }
  })
}

export async function switchMember(groupId, memberId) {
  return safe(async () => {
    const v = await verifySessionAsync(groupId)
    if (!v.ok || !v.canSwitch) return fail('Switch member is only available in demo groups or on the device that created the group.')
    if (!findMember(v.group, memberId)) return fail('That member is not in the group.')
    const s = S.getSession(groupId)
    S.setSession(groupId, { ...s, actingAs: memberId === v.realMe ? undefined : memberId })
    return { ok: true }
  })
}

export async function reissueToken(groupId, me, memberId) {
  return safe(async () => {
    const v = await verifySessionAsync(groupId)
    if (!v.ok) return fail(INVALID_LINK)
    if (!(v.isCreator || v.realMe === memberId)) return fail('Only the creator or the member can make a new link.')
    if (!findMember(v.group, memberId)) return fail('That member is not in the group.')
    const token = memberToken()
    const tokenHash = await sha256(token)
    await db.mutateGroup(groupId, (g) => {
      const m = g.members.find((x) => x.id === memberId)
      if (!m || m.removed) throw new UserError('That member is not in the group.')
      m.tokenHash = tokenHash
      m.devices = memberId === v.realMe ? [S.getDeviceId()] : []
      return g
    })
    if (memberId === v.realMe) {
      const s = S.getSession(groupId)
      S.setSession(groupId, { ...s, token })
    }
    if (v.isCreator || memberId === v.realMe) S.saveCreatorToken(groupId, memberId, token)
    return { ok: true, token }
  })
}

export async function regenerateInviteCode(groupId, _me) {
  return safe(async () => {
    const v = await verifySessionAsync(groupId)
    if (!v.ok || !v.isCreator) return fail('Only the group creator can change the invite code.')
    const code = await freshCode()
    await db.mutateGroup(groupId, (g) => ({ ...g, inviteCode: code }))
    return { ok: true, code }
  })
}

export async function removeMember(groupId, me, memberId, _ledger) {
  return safe(async () => {
    const v = await verifySessionAsync(groupId)
    if (!v.ok || !v.isCreator) return fail('Only the group creator can remove members.')
    if (memberId === v.group.creatorId) return fail('The creator cannot be removed.')
    const snap = await db.getSnapshot(groupId)
    const L = buildLedger(snap)
    if (!L.ok) return fail(L.error)
    if ((L.nets[memberId] ?? 0) !== 0) return fail('Members with balances cannot be removed. Settle up first.')
    await db.mutateGroup(groupId, (g) => {
      const m = g.members.find((x) => x.id === memberId)
      if (!m) throw new UserError('That member is not in the group.')
      m.removed = true
      return g
    })
    return { ok: true }
  })
}

// ---------- expenses ----------

export async function saveExpense(groupId, me, form) {
  return safe(async () => {
    await authorise(groupId, me)
    const f = form ?? {}
    if (typeof f.id !== 'string' || !ID_RE.test(f.id)) return fail(GENERIC)
    const snap = await db.getSnapshot(groupId)
    if (!snap.group) return fail('Group not found.')
    if (snap.expenses.some((e) => e.id === f.id)) return { ok: true, duplicate: true }
    if (snap.expenses.length >= LIMITS.MAX_EXPENSES) return fail('This group has reached 500 expenses.')
    const t = validateTitle(f.title ?? '')
    if (!t.ok) return fail(t.error)
    if (!isValidPaise(f.total)) {
      return fail(Number.isSafeInteger(f.total) && f.total > LIMITS.MAX_PAISE ? 'That amount is above the ₹1,00,000 limit.' : 'Enter a valid amount.')
    }
    if (!MODES.includes(f.mode)) return fail('Choose a split mode.')
    const activeIds = active(snap.group).map((m) => m.id)
    if (!activeIds.includes(f.paidBy)) return fail('The payer must be a current member.')
    const participants = Array.isArray(f.participants) ? f.participants : []
    if (participants.some((p) => !activeIds.includes(p))) return fail('Everyone ticked must be a current member.')
    if (f.mode !== 'treat' && !participants.length) return fail('Tick at least one person.')
    const split = computeSplit({
      total: f.total, payer: f.paidBy, participants, mode: f.mode, own: f.own, custom: f.custom,
      poster: me, members: activeIds,
    })
    if (!split.ok) return fail(split.error)
    const expense = {
      id: f.id, groupId, title: t.value, category: CATEGORIES.includes(f.category) ? f.category : 'other',
      total: f.total, paidBy: f.paidBy, mode: f.mode, participants, splits: split.splits,
      ...(f.mode === 'my_part' ? { own: f.own } : {}),
      source: f.source === 'ai' ? 'ai' : 'form', createdBy: me, createdAt: Date.now(), deleted: false,
    }
    const bad = checkWrite(snap, { expense })
    if (bad) return fail(bad)
    const r = await db.create('expenses', expense)
    return { ok: true, duplicate: r === 'exists', expense }
  })
}

export async function deleteExpense(groupId, me, expenseId) {
  return safe(async () => {
    await authorise(groupId, me)
    const snap = await db.getSnapshot(groupId)
    const e = snap.expenses.find((x) => x.id === expenseId)
    if (!e || e.deleted) return fail('That expense was not found.')
    if (e.createdBy !== me) return fail('Only the person who added an expense can delete it.')
    await db.update('expenses', expenseId, { groupId, deleted: true, deletedBy: me, deletedAt: Date.now() })
    return { ok: true }
  })
}

// ---------- payments ----------

function activeClaim(snap, from, to) {
  return snap.claims.find((c) => c.from === from && c.to === to && c.status !== 'closed') ?? null
}

export async function checkFreshPay(groupId, from, to, expectedAmount) {
  return safe(async () => {
    const snap = await db.getSnapshot(groupId)
    const L = buildLedger(snap)
    if (!L.ok) return fail(L.error)
    if (owedBetween(L.plan, from, to) !== expectedAmount) return fail(STALE, { stale: true })
    const payee = findMember(snap.group, to)
    const link = payee ? buildUpiLink({ upiId: payee.upiId, name: payee.name, paise: expectedAmount }) : null
    if (!link) return fail('This person has no valid UPI ID.')
    return { ok: true, link, upiId: payee.upiId, name: payee.name, amount: expectedAmount }
  })
}

export async function recordPayment(groupId, me, { id, from, to, amount, claimId, expectedAmount } = {}) {
  return safe(async () => {
    await authorise(groupId, me)
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail(GENERIC)
    const snap = await db.getSnapshot(groupId)
    if (!snap.group) return fail('Group not found.')
    if (snap.payments.some((p) => p.id === id)) return { ok: true, duplicate: true }
    const L = buildLedger(snap)
    if (!L.ok) return fail(L.error)
    if (expectedAmount !== undefined && owedBetween(L.plan, from, to) !== expectedAmount) return fail(STALE, { stale: true })
    const err = checkPayment({ me, from, to, amount, plan: L.plan })
    if (err) return fail(err)
    const payment = {
      id, groupId, from, to, amount, status: 'paid', claimId: typeof claimId === 'string' ? claimId : null,
      createdBy: me, createdAt: Date.now(),
    }
    const bad = checkWrite(snap, { payment })
    if (bad) return fail(bad)
    const r = await db.create('payments', payment)
    const claim = activeClaim(snap, from, to)
    if (r === 'created' && claim && claim.status === 'requested') {
      await db.update('claims', claim.id, { groupId, status: 'awaiting' })
    }
    return { ok: true, duplicate: r === 'exists', payment }
  })
}

export async function undoPayment(groupId, me, paymentId) {
  return safe(async () => {
    await authorise(groupId, me)
    const snap = await db.getSnapshot(groupId)
    const p = snap.payments.find((x) => x.id === paymentId)
    if (!canUndo(me, p, Date.now())) return fail('This payment can no longer be undone.')
    await db.update('payments', paymentId, { groupId, status: 'undone', respondedAt: Date.now() })
    const claim = activeClaim(snap, p.from, p.to)
    if (claim && claim.status === 'awaiting') await db.update('claims', claim.id, { groupId, status: 'requested' })
    return { ok: true }
  })
}

export async function respondPayment(groupId, me, paymentId, received) {
  return safe(async () => {
    await authorise(groupId, me)
    const snap = await db.getSnapshot(groupId)
    const p = snap.payments.find((x) => x.id === paymentId)
    if (!canRespond(me, p)) return fail('Only the person who was paid can confirm this.')
    await db.update('payments', paymentId, { groupId, status: received ? 'confirmed' : 'disputed', respondedAt: Date.now() })
    const claim = activeClaim(snap, p.from, p.to)
    if (claim) await db.update('claims', claim.id, { groupId, status: received ? 'closed' : 'requested' })
    return { ok: true }
  })
}

// ---------- claims ----------

export async function sendClaim(groupId, me, { from } = {}) {
  return safe(async () => {
    await authorise(groupId, me)
    const snap = await db.getSnapshot(groupId)
    const L = buildLedger(snap)
    if (!L.ok) return fail(L.error)
    const debtor = findMember(snap.group, from)
    const creditor = findMember(snap.group, me)
    if (!debtor || !creditor) return fail('That member is not in the group.')
    const now = Date.now()
    const existing = activeClaim(snap, from, me)
    const err = checkClaim({ me, from, plan: L.plan, existing, now })
    if (err) return fail(err)
    const amount = owedBetween(L.plan, from, me)
    const link = buildUpiLink({ upiId: creditor.upiId, name: creditor.name, paise: amount })
    if (!link) return fail('Your UPI ID is not valid. Update it first.')
    let claim
    if (existing) {
      claim = { ...existing, amount, status: 'requested', lastSentAt: now }
      await db.update('claims', existing.id, { groupId, amount, status: 'requested', lastSentAt: now })
    } else {
      claim = { id: uuid(), groupId, from, to: me, amount, status: 'requested', createdBy: me, createdAt: now, lastSentAt: now }
      await db.create('claims', claim)
    }
    const message = `Hey ${debtor.name}, you owe me ${formatINR(amount)} for ${snap.group.name}. Pay here: ${link}`
    return { ok: true, claim, message, link, whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}` }
  })
}
