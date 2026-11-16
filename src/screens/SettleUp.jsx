// Settle up: banner, before/after picture, payment rows and history.
// Also exports the payment widgets GroupHome reuses (Pay, Mark as paid, Claim, Respond).

import { useRef, useState } from 'react'
import { useGroup } from '../store.js'
import * as actions from '../actions.js'
import { Card, Button, ErrorBanner, Sheet, useToast, QRImage, CopyButton, Empty, Avatar, inputClass } from '../components/ui.jsx'
import SettleVisual from '../components/SettleVisual.jsx'
import { formatINR, paiseToRupeeString } from '../money.js'
import { buildUpiLink } from '../upi.js'
import { uuid } from '../ids.js'
import { parseRupeesInput } from '../validate.js'
import { canRespond } from '../engine/claims.js'

export const STALE = 'Balances changed. Review before paying'

export const when = (t) => {
  try {
    return new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

const STATUS = { paid: 'Awaiting confirmation', confirmed: 'Received', disputed: 'Not received', undone: 'Undone' }

// Pay via UPI: plain-text UPI ID and amount beside the button, fresh-balance check first.
export function PayBlock({ groupId, me, payee, amount }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const link = payee ? buildUpiLink({ upiId: payee.upiId, name: payee.name, paise: amount }) : null
  if (!link) return <p className="text-sm text-red-600">This person’s UPI ID is not valid, so a payment link cannot be made.</p>

  async function pay() {
    setBusy(true)
    try {
      const r = await actions.checkFreshPay(groupId, me, payee.id, amount)
      if (!r?.ok) {
        toast.show(r?.stale ? STALE : r?.error || 'Could not check balances. Try again.')
        return
      }
      window.location.href = link
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" busy={busy} onClick={pay}>
          Pay via UPI
        </Button>
        <span className="text-sm text-slate-600 dark:text-slate-300 break-all">
          {formatINR(amount)} to {payee.upiId}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide QR' : 'Pay QR'}
        </Button>
        <CopyButton text={payee.upiId} label="Copy UPI ID" />
      </div>
      {showQr && (
        <div className="flex flex-col items-center gap-1 py-2">
          <QRImage text={link} size={220} />
          <p className="text-sm text-center">
            Pay {payee.name} {formatINR(amount)}
          </p>
          <p className="text-xs text-slate-500 break-all text-center">{payee.upiId}</p>
        </div>
      )}
    </div>
  )
}

// Mark as paid, with an editable partial amount (never more than owed) and a 5-second Undo.
export function MarkPaid({ groupId, me, to, owed, claimId, allowPartial = true }) {
  const toast = useToast()
  const idRef = useRef(uuid())
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(paiseToRupeeString(owed))
  const [error, setError] = useState('')

  async function save() {
    setError('')
    let amount = owed
    if (editing) {
      const p = parseRupeesInput(text)
      if (!p.ok) return setError(p.error)
      if (p.value > owed) return setError('You cannot pay more than you owe.')
      amount = p.value
    }
    setBusy(true)
    try {
      const id = idRef.current
      const r = await actions.recordPayment(groupId, me, { id, from: me, to, amount, claimId, expectedAmount: owed })
      if (!r?.ok) {
        toast.show(r?.stale ? STALE : r?.error || 'Could not save. Nothing was recorded.')
        return
      }
      idRef.current = uuid()
      setEditing(false)
      toast.show(`Marked ${formatINR(amount)} as paid`, {
        ms: 5000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const u = await actions.undoPayment(groupId, me, id)
            toast.show(u?.ok ? 'Payment undone' : u?.error || 'Undo is no longer available.')
          },
        },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {editing && (
        <label className="block text-sm">
          Amount paid (up to {formatINR(owed)})
          <input
            className={`mt-1 ${inputClass}`}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="success" busy={busy} disabled={busy} onClick={save}>
          Mark as paid
        </Button>
        {allowPartial && !editing && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Paid less?
          </Button>
        )}
      </div>
    </div>
  )
}

// Claim: creates the claim and shows a fixed-template message to Copy or Share on WhatsApp.
export function ClaimButton({ groupId, me, from, label = 'Claim' }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function claim() {
    setBusy(true)
    try {
      const r = await actions.sendClaim(groupId, me, { from })
      if (!r?.ok) return toast.show(r?.error || 'Could not create the claim.')
      setResult(r)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="success" busy={busy} disabled={busy} onClick={claim}>
        {label}
      </Button>
      <Sheet open={Boolean(result)} onClose={() => setResult(null)} title="Request sent">
        {result && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-100 dark:bg-slate-800 p-3 text-sm">{result.message}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={result.message} label="Copy" />
              <a
                className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl bg-green-600 text-white font-semibold"
                href={`https://wa.me/?text=${encodeURIComponent(result.message)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Share on WhatsApp
              </a>
            </div>
            {result.link && (
              <div className="flex flex-col items-center gap-1">
                <QRImage text={result.link} size={200} />
                <p className="text-xs text-slate-500 text-center">Pay QR for {formatINR(result.claim?.amount ?? 0)}</p>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}

// Received / Not received, only for the person who was paid.
export function RespondButtons({ groupId, me, payment }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!canRespond(me, payment)) return null
  async function respond(received) {
    setBusy(true)
    try {
      const r = await actions.respondPayment(groupId, me, payment.id, received)
      if (!r?.ok) toast.show(r?.error || 'Could not save. Nothing changed.')
      else toast.show(received ? 'Marked as received' : 'Marked as not received. The debt is back.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex gap-2">
      <Button variant="success" busy={busy} disabled={busy} onClick={() => respond(true)}>
        Received
      </Button>
      <Button variant="danger" busy={busy} disabled={busy} onClick={() => respond(false)}>
        Not received
      </Button>
    </div>
  )
}

export default function SettleUp({ groupId }) {
  const { data, ledger, loading, me, nameOf, memberOf } = useGroup(groupId)

  if (loading || !data?.group) return <p className="p-4 text-slate-500">Loading…</p>
  if (!ledger?.ok) return <div className="p-4"><ErrorBanner text={ledger?.error || 'Balances could not be computed.'} /></div>

  const members = data.group.members
  const plan = ledger.plan
  const rawCount = ledger.raw.length
  const history = [...(data.payments ?? [])].filter((p) => p.status !== 'undone').sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="space-y-4 p-4 pb-28">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settle up</h1>

      {rawCount !== plan.length && (
        <Card>
          <p className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">
            {rawCount} payments reduced to {plan.length}
          </p>
          <p className="text-sm text-slate-500">Debts are netted so the group makes the fewest payments.</p>
        </Card>
      )}

      <Card>
        <SettleVisual members={members} raw={ledger.raw} plan={plan} nameOf={nameOf} />
      </Card>

      <section className="space-y-3">
        <h2 className="font-semibold">Payments</h2>
        {plan.length === 0 && <Empty title="All settled up" hint="Nobody owes anything." />}
        {plan.map((p) => (
          <Card key={`${p.from}>${p.to}`}>
            <div className="flex items-center gap-2 mb-2">
              <Avatar name={nameOf(p.from)} size={32} />
              <span className="font-medium truncate">{nameOf(p.from)}</span>
              <span aria-hidden="true">→</span>
              <Avatar name={nameOf(p.to)} size={32} />
              <span className="font-medium truncate">{nameOf(p.to)}</span>
              <span className="ml-auto font-semibold">{formatINR(p.amount)}</span>
            </div>
            {p.from === me && (
              <div className="space-y-3">
                <PayBlock groupId={groupId} me={me} payee={memberOf(p.to)} amount={p.amount} />
                <MarkPaid groupId={groupId} me={me} to={p.to} owed={p.amount} />
              </div>
            )}
            {p.to === me && <ClaimButton groupId={groupId} me={me} from={p.from} />}
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Payment history</h2>
        {history.length === 0 && <Empty title="No payments yet" hint="Payments you mark as paid show up here." />}
        {history.map((p) => (
          <Card key={p.id}>
            <div className="flex items-center gap-2">
              <span className="truncate">
                {nameOf(p.from)} → {nameOf(p.to)}
              </span>
              <span className="ml-auto font-semibold">{formatINR(p.amount)}</span>
            </div>
            <p className="text-xs text-slate-500">
              {when(p.createdAt)} · {STATUS[p.status] ?? p.status} · Added by {nameOf(p.createdBy)}
            </p>
            <div className="mt-2">
              <RespondButtons groupId={groupId} me={me} payment={p} />
            </div>
          </Card>
        ))}
      </section>
    </div>
  )
}
