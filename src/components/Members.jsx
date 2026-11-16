// Profile and members sheet: my personal QR, reissue, and creator tools
// (add members up front with a QR card each, regenerate invite code, remove member).

import { useState } from 'react'
import * as actions from '../actions.js'
import { getSession, getCreatorTokens } from '../session.js'
import { Sheet, Button, QRImage, CopyButton, Avatar, Card, useToast, inputClass, ConfirmButton } from './ui.jsx'
import { formatINR } from '../money.js'

export const personalLink = (groupId, token) => `${window.location.origin}/#m=${groupId}.${token}`

function tokenFor(groupId, memberId) {
  const s = getSession(groupId)
  if (s && s.memberId === memberId && s.token) return s.token
  return getCreatorTokens(groupId)?.[memberId] ?? null
}

function QrCard({ name, link }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
      <QRImage text={link} size={180} />
      <p className="font-semibold text-center break-words max-w-full">{name}</p>
      <CopyButton text={link} label="Copy link" />
    </div>
  )
}

export default function MembersSheet({ open, onClose, groupId, group, me, realMe, isCreator, ledger }) {
  const toast = useToast()
  const [, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)
  const [name, setName] = useState('')
  const [upi, setUpi] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState({}) // memberId -> token just issued

  if (!group) return null
  const myToken = fresh[me] ?? tokenFor(groupId, me)
  const meMember = group.members.find((m) => m.id === me)
  const canReissueMine = isCreator || me === realMe

  async function reissue(memberId) {
    setBusy(true)
    try {
      const r = await actions.reissueToken(groupId, realMe, memberId)
      if (!r?.ok) return toast.show(r?.error || 'Could not reissue the link.')
      setFresh((f) => ({ ...f, [memberId]: r.token }))
      toast.show('New link made. The old one no longer works.')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function add(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await actions.addMemberByCreator(groupId, { name, upiId: upi })
      if (!r?.ok) return setError(r?.error || 'Could not add this member.')
      setFresh((f) => ({ ...f, [r.memberId]: r.token }))
      setName('')
      setUpi('')
      toast.show('Member added')
    } finally {
      setBusy(false)
    }
  }

  async function regenerate() {
    setBusy(true)
    try {
      const r = await actions.regenerateInviteCode(groupId, realMe)
      toast.show(r?.ok ? `New invite code: ${r.code}. The old one no longer works.` : r?.error || 'Could not change the code.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(memberId) {
    setBusy(true)
    try {
      const r = await actions.removeMember(groupId, realMe, memberId, ledger)
      toast.show(r?.ok ? 'Member removed' : r?.error || 'Could not remove this member.')
    } finally {
      setBusy(false)
    }
  }

  const active = group.members.filter((m) => !m.removed)

  return (
    <Sheet open={open} onClose={onClose} title="Profile and members">
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="font-semibold">Your personal QR</h3>
          <p className="text-sm text-slate-500">
            Scan this on another device to open the group as {meMember?.name ?? 'you'}. Keep it private.
          </p>
          {myToken ? (
            <QrCard name={meMember?.name ?? ''} link={personalLink(groupId, myToken)} />
          ) : (
            <p className="text-sm text-slate-500">This device does not hold your link. Reissue to make a new one.</p>
          )}
          {canReissueMine && (
            <Button variant="ghost" busy={busy} disabled={busy} onClick={() => reissue(me)}>
              Reissue my link
            </Button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">Members ({active.length}/20)</h3>
          {group.members.map((m) => {
            const net = ledger?.ok ? ledger.nets[m.id] ?? 0 : null
            const token = fresh[m.id] ?? (isCreator ? getCreatorTokens(groupId)?.[m.id] : null)
            return (
              <Card key={m.id}>
                <div className="flex items-center gap-2">
                  <Avatar name={m.name} size={32} />
                  <span className={`font-medium truncate ${m.removed ? 'line-through text-slate-400' : ''}`}>{m.name}</span>
                  {m.id === group.creatorId && <span className="text-xs text-indigo-600">creator</span>}
                  {net !== null && net !== 0 && (
                    <span className={`ml-auto text-sm ${net > 0 ? 'text-green-600' : 'text-red-600'}`}>{formatINR(net)}</span>
                  )}
                </div>
                {isCreator && !m.removed && m.id !== realMe && (
                  <div className="mt-2 space-y-2">
                    {token && <QrCard name={m.name} link={personalLink(groupId, token)} />}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" busy={busy} disabled={busy} onClick={() => reissue(m.id)}>
                        {token ? 'New QR' : 'Make QR'}
                      </Button>
                      <ConfirmButton variant="ghost" label="Remove" confirmLabel="Tap again to remove" busy={busy} disabled={busy} onConfirm={() => remove(m.id)} />
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </section>

        {isCreator && (
          <section className="space-y-2">
            <h3 className="font-semibold">Add a member</h3>
            <form onSubmit={add} className="space-y-2">
              <input
                className={inputClass}
                placeholder="Name"
                maxLength={30}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="UPI ID, like name@bank"
                maxLength={321}
                autoCapitalize="none"
                value={upi}
                onChange={(e) => setUpi(e.target.value)}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" variant="primary" busy={busy} disabled={busy}>
                Add member
              </Button>
            </form>
            <div className="pt-2">
              <ConfirmButton label="Regenerate invite code" confirmLabel="Tap again: old code stops working" busy={busy} disabled={busy} onConfirm={regenerate} />
            </div>
          </section>
        )}
      </div>
    </Sheet>
  )
}
