import { useEffect, useRef, useState } from 'react'
import { runChat } from '../ai/chat.js'
import { llm } from '../ai/parse.js'
import { chatGate } from '../ratelimit.js'
import { formatINR } from '../money.js'
import { buildUpiLink } from '../upi.js'
import { uuid } from '../ids.js'
import { LIMITS } from '../validate.js'
import * as actions from '../actions.js'
import { offsetLines } from './ExpenseForm.jsx'
import { Button, Card, CopyButton, useToast, inputClass } from './ui.jsx'

const gate = chatGate()

function SourceTag({ source }) {
  if (!source) return null
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${source === 'ai' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
      {source === 'ai' ? 'AI' : 'offline parser'}
    </span>
  )
}

function Bubble({ role, children }) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 ${role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/70'}`}>
        {children}
      </div>
    </div>
  )
}

function ExpenseCard({ msg, ctx, groupId, onEdit, update }) {
  const toast = useToast()
  const { draft } = msg.result
  const { nameOf, data, me } = ctx
  // Offset lines describe an unsaved draft; once saved the live balances already include it.
  const offsets = msg.status === 'saved' ? [] : offsetLines(data, draft, nameOf)

  async function confirm() {
    if (msg.busy || msg.status !== 'open') return
    update({ busy: true })
    const r = await actions.saveExpense(groupId, me, { id: msg.draftId, ...draft, source: 'ai' })
    if (!r?.ok) { update({ busy: false }); toast.show(r?.error ?? 'Could not save. Nothing was saved.'); return }
    update({ busy: false, status: 'saved' })
    toast.show('Expense added')
  }

  return (
    <Card className="space-y-2 p-4">
      <p className="text-sm font-semibold text-slate-500">Here’s what I understood<SourceTag source={msg.result.source} /></p>
      <p className="text-lg font-semibold text-slate-900">{draft.title} · {formatINR(draft.total)}</p>
      <p className="text-slate-700">Paid by {nameOf(draft.paidBy)}</p>
      {draft.mode === 'treat' ? (
        <p className="text-purple-700">Treat. Nobody owes anything.</p>
      ) : (
        Object.entries(draft.splits).map(([id, v]) => (
          <p key={id} className="text-slate-800">{nameOf(id)} pays {formatINR(v)}</p>
        ))
      )}
      {offsets.map((l) => <p key={l} className="text-sm text-slate-600">{l}</p>)}
      {msg.status === 'open' ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" busy={msg.busy} disabled={msg.busy} onClick={confirm}>Confirm</Button>
          <Button variant="ghost" disabled={msg.busy} onClick={() => onEdit({ ...draft, source: 'ai' })}>Edit</Button>
          <Button variant="ghost" disabled={msg.busy} onClick={() => update({ status: 'cancelled' })}>Cancel</Button>
        </div>
      ) : (
        <p className={`text-sm font-medium ${msg.status === 'saved' ? 'text-green-700' : 'text-slate-500'}`}>
          {msg.status === 'saved' ? 'Saved' : 'Cancelled. Nothing was saved.'}
        </p>
      )}
    </Card>
  )
}

function PayRow({ row, ctx, groupId }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const payee = ctx.memberOf(row.to)
  async function pay() {
    setBusy(true)
    const r = await actions.checkFreshPay(groupId, row.from, row.to, row.amount)
    setBusy(false)
    if (!r?.ok) { toast.show(r?.error ?? 'Balances changed. Review before paying'); return }
    const link = payee && buildUpiLink({ upiId: payee.upiId, name: payee.name, paise: row.amount })
    if (!link) { toast.show('This UPI ID is not valid.'); return }
    window.location.href = link
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3">
      <div className="min-w-0">
        <p className="font-medium text-red-800">You owe {ctx.nameOf(row.to)} {formatINR(row.amount)}</p>
        {payee && <p className="truncate text-xs text-slate-600">to {payee.upiId}</p>}
      </div>
      <Button variant="danger" busy={busy} disabled={busy} onClick={pay}>Pay</Button>
    </div>
  )
}

function ClaimCard({ row, ctx, groupId }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null)
  async function send() {
    if (busy || sent) return
    setBusy(true)
    const r = await actions.sendClaim(groupId, ctx.me, { from: row.from })
    setBusy(false)
    if (!r?.ok) { toast.show(r?.error ?? 'Could not create the claim.'); return }
    setSent(r)
  }
  return (
    <div className="space-y-2 rounded-xl bg-green-50 p-3">
      <p className="font-medium text-green-800">Claim {formatINR(row.amount)} from {ctx.nameOf(row.from)}</p>
      {!sent ? (
        <Button variant="success" busy={busy} disabled={busy} onClick={send}>Send</Button>
      ) : (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{sent.message}</p>
          <div className="flex gap-2">
            <CopyButton text={sent.message} label="Copy" />
            <a
              className="inline-flex min-h-[44px] items-center rounded-xl bg-green-600 px-4 text-sm font-medium text-white"
              href={`https://wa.me/?text=${encodeURIComponent(sent.message)}`} target="_blank" rel="noopener noreferrer"
            >
              Share on WhatsApp
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ChatBox({ groupId, ctx, onEdit, onManual }) {
  const [messages, setMessages] = useState([
    { id: 'hello', role: 'bot', kind: 'text', text: 'Describe it: "Ravi paid 2400 for dinner, split between me, Meera and Sana". Or ask "Who should pay next?"' },
  ])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }) }, [messages, loading])

  const add = (m) => setMessages((list) => [...list, { id: uuid(), ...m }])
  const updateMsg = (id, patch) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  async function send(e) {
    e?.preventDefault()
    const input = text.slice(0, LIMITS.CHAT_MAX).trim()
    if (!input || loading) return
    const limit = gate.check()
    if (limit) { add({ role: 'bot', kind: 'text', text: limit }); return }
    setText('')
    add({ role: 'user', kind: 'text', text: input })
    setLoading(true)
    let result
    try {
      result = await runChat(input, {
        members: ctx.data.group.members, meId: ctx.me, ledger: ctx.ledger, data: ctx.data, nameOf: ctx.nameOf,
      }, llm)
    } catch {
      result = { type: 'question', text: 'Something went wrong. Nothing was saved. Try the form.' }
    }
    setLoading(false)
    if (result.type === 'expense') add({ role: 'bot', kind: 'expense', result, draftId: uuid(), status: 'open', busy: false })
    else add({ role: 'bot', kind: 'answer', result, text: result.text })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-3">
        {messages.map((m) => {
          if (m.kind === 'expense') {
            return <ExpenseCard key={m.id} msg={m} ctx={ctx} groupId={groupId} onEdit={onEdit} update={(p) => updateMsg(m.id, p)} />
          }
          return (
            <div key={m.id} className="space-y-2">
              <Bubble role={m.role}>
                {m.text}
                {m.role === 'bot' && m.result && <SourceTag source={m.result.source} />}
              </Bubble>
              {m.result?.rows?.map((row) => <PayRow key={`${row.from}-${row.to}`} row={row} ctx={ctx} groupId={groupId} />)}
              {m.result?.claims?.map((row) => <ClaimCard key={`${row.from}-${row.to}`} row={row} ctx={ctx} groupId={groupId} />)}
            </div>
          )
        })}
        {loading && <Bubble role="bot"><span className="animate-pulse text-slate-400">Thinking…</span></Bubble>}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="sticky bottom-24 space-y-1 rounded-2xl bg-white p-2 shadow-md ring-1 ring-slate-200">
        <div className="flex gap-2">
          <input
            className={`${inputClass} flex-1`}
            value={text} maxLength={LIMITS.CHAT_MAX} placeholder="Ravi paid 1200 for dinner…"
            onChange={(e) => setText(e.target.value.slice(0, LIMITS.CHAT_MAX))} disabled={loading}
          />
          <Button variant="primary" type="submit" busy={loading} disabled={loading || !text.trim()}>Send</Button>
        </div>
        <div className="flex items-center justify-between px-1 text-xs text-slate-500">
          <button type="button" className="min-h-11 font-medium text-indigo-600 underline" onClick={onManual}>Use manual form</button>
          <span>{text.length}/{LIMITS.CHAT_MAX}</span>
        </div>
      </form>
    </div>
  )
}
