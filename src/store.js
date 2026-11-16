// React hook: live group data + derived ledger + verified identity.

import { useEffect, useMemo, useState } from 'react'
import db from './db.js'
import { buildLedger } from './engine/ledger.js'
import { verifySessionAsync } from './actions.js'

export function useGroup(groupId) {
  const [data, setData] = useState(null)
  const [auth, setAuth] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!groupId) return undefined
    setData(null)
    return db.subscribe(groupId, setData)
  }, [groupId])

  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    window.addEventListener('tally:session', on)
    return () => window.removeEventListener('tally:session', on)
  }, [])

  // Re-verify when tokens/members change (revoke) or the session changes (switch member).
  const memberKey = data?.group
    ? JSON.stringify(data.group.members.map((m) => [m.id, m.tokenHash, m.removed]))
    : ''
  useEffect(() => {
    if (!groupId) return undefined
    let alive = true
    verifySessionAsync(groupId).then((r) => { if (alive) setAuth(r) })
    return () => { alive = false }
  }, [groupId, memberKey, tick])

  const ledger = useMemo(() => (data?.group ? buildLedger(data) : null), [data])
  const members = data?.group?.members ?? []
  const nameOf = (id) => members.find((m) => m.id === id)?.name ?? 'Unknown'
  const memberOf = (id) => members.find((m) => m.id === id) ?? null

  if (data && !data.group) return { invalid: true, loading: false }
  if (auth && !auth.ok) return { invalid: true, loading: false }
  const loading = !data || !auth
  return {
    data,
    ledger,
    loading,
    me: auth?.me ?? null,
    realMe: auth?.realMe ?? null,
    canSwitch: auth?.canSwitch ?? false,
    isCreator: auth?.isCreator ?? false,
    nameOf,
    memberOf,
  }
}
