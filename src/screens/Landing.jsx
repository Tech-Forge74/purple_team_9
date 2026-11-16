import React, { useState } from 'react'
import { Button, Card, ErrorBanner, Field, inputClass, Tabs, Empty } from '../components/ui.jsx'
import { validateName, validateTitle, validateUpi } from '../validate.js'
import { createGroup, joinGroup, loadDemoGroup } from '../actions.js'
import { listMyGroups } from '../session.js'

function CreateForm({ onOpenGroup }) {
  const [groupName, setGroupName] = useState('')
  const [name, setName] = useState('')
  const [upiId, setUpiId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const g = validateTitle(groupName)
    if (!g.ok) return setError(g.error.replace('Titles', 'Group names').replace('a title', 'a group name'))
    const n = validateName(name)
    if (!n.ok) return setError(`Your name: ${n.error}`)
    const u = validateUpi(upiId)
    if (!u.ok) return setError(u.error)
    setError('')
    setBusy(true)
    try {
      const r = await createGroup({ groupName: g.value, name: n.value, upiId: u.value })
      if (r.ok) onOpenGroup(r.groupId)
      else setError(r.error || 'Could not create the group.')
    } catch {
      setError('Could not create the group. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Group name">
        <input className={inputClass} value={groupName} maxLength={40} onChange={(e) => setGroupName(e.target.value)} placeholder="Goa Trip" />
      </Field>
      <Field label="Your name">
        <input className={inputClass} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Ankit" autoComplete="given-name" />
      </Field>
      <Field label="Your UPI ID" hint="Friends pay you here. Example: ankit@okhdfc">
        <input className={inputClass} value={upiId} maxLength={321} onChange={(e) => setUpiId(e.target.value)} placeholder="name@bank" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </Field>
      <ErrorBanner text={error} />
      <Button type="submit" busy={busy} className="w-full">Create group</Button>
    </form>
  )
}

function JoinForm({ onOpenGroup, initialCode }) {
  const [code, setCode] = useState(initialCode ?? '')
  const [name, setName] = useState('')
  const [upiId, setUpiId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const c = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(c)) return setError('Enter the 6-character invite code.')
    const n = validateName(name)
    if (!n.ok) return setError(`Your name: ${n.error}`)
    const u = validateUpi(upiId)
    if (!u.ok) return setError(u.error)
    setError('')
    setBusy(true)
    try {
      const r = await joinGroup({ code: c, name: n.value, upiId: u.value })
      if (r.ok) onOpenGroup(r.groupId)
      else setError(r.error || 'Could not join the group.')
    } catch {
      setError('Could not join. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {initialCode && (
        <p className="rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          You opened an invite link. Enter your name and UPI ID to join.
        </p>
      )}
      <Field label="Invite code">
        <input
          className={`${inputClass} font-mono uppercase tracking-[0.3em]`}
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC234"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field label="Your name">
        <input className={inputClass} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Meera" autoComplete="given-name" />
      </Field>
      <Field label="Your UPI ID">
        <input className={inputClass} value={upiId} maxLength={321} onChange={(e) => setUpiId(e.target.value)} placeholder="name@bank" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </Field>
      <ErrorBanner text={error} />
      <Button type="submit" busy={busy} className="w-full">Join group</Button>
    </form>
  )
}

export default function Landing({ onOpenGroup, joinCode }) {
  const [tab, setTab] = useState(joinCode ? 'join' : 'create')
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoError, setDemoError] = useState('')
  let groups = []
  try { groups = listMyGroups() } catch { groups = [] }

  async function demo() {
    if (demoBusy) return
    setDemoBusy(true)
    setDemoError('')
    try {
      const r = await loadDemoGroup()
      if (r.ok) onOpenGroup(r.groupId)
      else setDemoError(r.error || 'Could not load the demo group.')
    } catch {
      setDemoError('Could not load the demo group.')
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="space-y-5 px-4 pb-10 pt-8">
      <header className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-black text-white shadow-md" aria-hidden="true">
          T
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Tally</h1>
        <p className="mt-1 text-slate-600">Every shared expense in one place. Fewest payments. One-tap UPI.</p>
      </header>

      <Button className="w-full py-3 text-base" busy={demoBusy} onClick={demo}>
        Load demo group (Goa Trip)
      </Button>
      <ErrorBanner text={demoError} />

      <Card>
        <Tabs
          tabs={[{ value: 'create', label: 'Create group' }, { value: 'join', label: 'Join with code' }]}
          value={tab}
          onChange={setTab}
          className="mb-4"
        />
        {tab === 'create' ? <CreateForm onOpenGroup={onOpenGroup} /> : <JoinForm onOpenGroup={onOpenGroup} initialCode={joinCode} />}
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Your groups</h2>
        {groups.length === 0 ? (
          <Empty title="No groups yet" hint="Create one, join with a code, or load the demo." />
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onOpenGroup(g.id)}
                  className="flex min-h-11 w-full items-center justify-between rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <span className="truncate font-medium">{g.name}</span>
                  <span className="text-slate-400" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
