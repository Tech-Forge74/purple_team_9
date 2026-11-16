// In-app notifications: toast when someone else adds an expense or payment,
// and a one-time summary of what changed since this device last opened the group.

import { useEffect, useRef } from 'react'
import { formatINR } from './money.js'

const key = (groupId) => `tally:lastSeen:${groupId}`

function readLastSeen(groupId) {
  try {
    return Number(localStorage.getItem(key(groupId))) || 0
  } catch {
    return 0
  }
}

function writeLastSeen(groupId, t) {
  try {
    localStorage.setItem(key(groupId), String(t))
  } catch {}
}

// Items created by someone other than me, newer than `since`.
export function newActivity(data, me, since) {
  const expenses = (data?.expenses ?? []).filter((e) => !e.deleted && e.createdBy !== me && e.createdAt > since)
  const payments = (data?.payments ?? []).filter((p) => p.status !== 'undone' && p.createdBy !== me && p.createdAt > since)
  return { expenses, payments }
}

export function useActivityNotifications(groupId, data, me, nameOf, toast) {
  const since = useRef(null)

  useEffect(() => {
    if (!data || !me) return
    const first = since.current === null
    if (first) since.current = readLastSeen(groupId)

    const { expenses, payments } = newActivity(data, me, since.current)
    const count = expenses.length + payments.length

    if (first && since.current > 0 && count > 0) {
      toast.show(`${count} new ${count === 1 ? 'update' : 'updates'} since your last visit`)
    } else if (!first) {
      for (const e of expenses) toast.show(`${nameOf(e.createdBy)} added ${e.title ?? 'an expense'} · ${formatINR(e.total)}`)
      for (const p of payments) toast.show(`${nameOf(p.createdBy)} recorded a payment · ${formatINR(p.amount)}`)
    }

    since.current = Date.now()
    writeLastSeen(groupId, since.current)
  }, [groupId, data, me, nameOf, toast])
}
