import React, { useEffect, useState } from 'react'
import { ToastProvider } from './components/ui.jsx'
import Landing from './screens/Landing.jsx'
import InvalidLink from './screens/InvalidLink.jsx'
import GroupHome from './screens/GroupHome.jsx'
import AddExpense from './screens/AddExpense.jsx'
import SettleUp from './screens/SettleUp.jsx'
import { openPersonalLink } from './actions.js'
import { getCurrentGroupId, setCurrentGroupId } from './session.js'
import { useGroup } from './store.js'
import { isInviteCode } from './ids.js'

// Read what the URL asks for, then strip secrets from the address bar.
function readLocation() {
  const hash = window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(window.location.search)
  const hashParams = new URLSearchParams(hash)
  const join = (hashParams.get('join') || params.get('join') || '').trim().toUpperCase()
  const m = hashParams.get('m')
  if (m) {
    const dot = m.indexOf('.')
    return { kind: 'member', groupId: dot > 0 ? m.slice(0, dot) : '', token: dot > 0 ? m.slice(dot + 1) : '' }
  }
  if (join) return { kind: 'join', code: isInviteCode(join) ? join : '' }
  return { kind: 'none' }
}

function clearUrl() {
  try {
    window.history.replaceState(null, '', window.location.pathname)
  } catch { /* ignore */ }
}

const NAV = [
  { id: 'home', label: 'Home', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { id: 'add', label: 'Add', icon: 'M12 5v14M5 12h14' },
  { id: 'settle', label: 'Settle', icon: 'M4 7h13l-3-3M20 17H7l3 3' },
]

function BottomNav({ tab, onChange }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 safe-bottom" aria-label="Main">
      <div className="mx-auto flex max-w-md items-end border-t border-slate-200 bg-white/95 backdrop-blur">
        {NAV.map((n) => {
          const active = tab === n.id
          const icon = (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={n.icon} />
            </svg>
          )
          if (n.id === 'add') {
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onChange(n.id)}
                aria-current={active ? 'page' : undefined}
                className="flex h-16 flex-1 flex-col items-center justify-end gap-0.5 pb-1.5 text-xs font-semibold text-slate-600"
              >
                <span className={`-mt-6 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white transition ${active ? 'bg-indigo-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                  {icon}
                </span>
                <span className={active ? 'text-indigo-700' : ''}>Add expense</span>
              </button>
            )
          }
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onChange(n.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition ${active ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {active && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-indigo-600" aria-hidden="true" />}
              {icon}
              {n.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function GroupView({ groupId, onLeave }) {
  const [tab, setTab] = useState('home')
  const g = useGroup(groupId)
  const invalid = g.invalid || (!g.loading && (!g.data?.group || !g.me))

  useEffect(() => { window.scrollTo(0, 0) }, [tab])

  if (g.loading) {
    return (
      <div className="space-y-3 px-4 pt-8" aria-busy="true">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
      </div>
    )
  }
  if (invalid) return <InvalidLink onHome={onLeave} />

  return (
    <div className="pb-24">
      {tab === 'home' && <GroupHome groupId={groupId} onAdd={() => setTab('add')} onSettle={() => setTab('settle')} onLeave={onLeave} />}
      {tab === 'add' && <AddExpense groupId={groupId} onDone={() => setTab('home')} />}
      {tab === 'settle' && <SettleUp groupId={groupId} />}
      <BottomNav tab={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState(() => {
    const loc = readLocation()
    if (loc.kind === 'member') return { screen: 'opening', loc }
    if (loc.kind === 'join') return { screen: 'landing', joinCode: loc.code }
    let current = null
    try { current = getCurrentGroupId() } catch { current = null }
    return current ? { screen: 'group', groupId: current } : { screen: 'landing' }
  })

  // Personal link: open as that member, then remove the token from the address bar.
  useEffect(() => {
    if (route.screen !== 'opening') return
    let alive = true
    const { groupId, token } = route.loc
    clearUrl()
    ;(async () => {
      let r = { ok: false }
      try { r = groupId && token ? await openPersonalLink(groupId, token) : { ok: false } } catch { r = { ok: false } }
      if (!alive) return
      if (r.ok) {
        setCurrentGroupId(r.groupId)
        setRoute({ screen: 'group', groupId: r.groupId })
      } else {
        setRoute({ screen: 'invalid' })
      }
    })()
    return () => { alive = false }
  }, [route])

  // A link opened while the app is already open in this tab only changes the hash.
  useEffect(() => {
    const onHash = () => {
      const loc = readLocation()
      if (loc.kind === 'member') setRoute({ screen: 'opening', loc })
      else if (loc.kind === 'join') setRoute({ screen: 'landing', joinCode: loc.code })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Join links only prefill the form; strip them from the URL too.
  useEffect(() => {
    if (route.screen === 'landing' && route.joinCode !== undefined) clearUrl()
  }, [route])

  const openGroup = (groupId) => {
    setCurrentGroupId(groupId)
    setRoute({ screen: 'group', groupId })
  }
  const goHome = () => {
    setCurrentGroupId(null)
    setRoute({ screen: 'landing' })
  }

  return (
    <ToastProvider>
      <div className="app-col">
        {route.screen === 'opening' && (
          <div className="flex min-h-[80dvh] items-center justify-center text-slate-500" aria-busy="true">Opening your group…</div>
        )}
        {route.screen === 'invalid' && <InvalidLink onHome={goHome} />}
        {route.screen === 'landing' && <Landing onOpenGroup={openGroup} joinCode={route.joinCode || undefined} />}
        {route.screen === 'group' && (
          <GroupView
            key={route.groupId}
            groupId={route.groupId}
            onLeave={goHome}
          />
        )}
      </div>
    </ToastProvider>
  )
}
