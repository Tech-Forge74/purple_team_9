import { useMemo, useRef, useState } from 'react'
import { computeSplit, customRemaining } from '../engine/split.js'
import { computeNets } from '../engine/nets.js'
import { parseRupeesInput, parseRupeesNonNeg, validateTitle, CATEGORIES } from '../validate.js'
import { formatINR, paiseToRupeeString } from '../money.js'
import { uuid } from '../ids.js'
import * as actions from '../actions.js'
import { Button, Card, ErrorBanner, useToast, inputClass, CategoryIcon } from './ui.jsx'

const MODE_OPTIONS = [
  { value: 'equal', label: 'Equal' },
  { value: 'my_part', label: 'I pay my part' },
  { value: 'full', label: 'I pay the full bill' },
  { value: 'custom', label: 'Custom' },
  { value: 'treat', label: 'Treat' },
]

function describeNet(v) {
  if (v < 0) return `owes ${formatINR(-v)}`
  if (v > 0) return `is owed ${formatINR(v)}`
  return 'is settled'
}

// Offset preview: the same computeNets before and after the draft expense.
export function offsetLines(data, draft, nameOf) {
  if (!data?.group || !draft || draft.mode === 'treat') return []
  const ids = data.group.members.map((m) => m.id)
  const before = computeNets(ids, data.expenses, data.payments)
  const after = computeNets(ids, [...data.expenses, { ...draft, id: '__draft__', deleted: false }], data.payments)
  const lines = []
  for (const id of ids) {
    if (before[id] === after[id] || before[id] === 0) continue
    lines.push(`${nameOf(id)} ${describeNet(before[id])} now. After this bill: ${describeNet(after[id])}.`)
  }
  return lines
}

const toText = (paise) => (Number.isSafeInteger(paise) ? paiseToRupeeString(paise).replace(/\.00$/, '') : '')

export default function ExpenseForm({ groupId, data, ledger, me, nameOf, prefill, onDone }) {
  const toast = useToast()
  const members = data.group.members
  const active = members.filter((m) => !m.removed)
  const activeIds = active.map((m) => m.id)
  const memberIds = members.map((m) => m.id)

  const [title, setTitle] = useState(prefill?.title ?? '')
  const [amountText, setAmountText] = useState(toText(prefill?.total))
  const [category, setCategory] = useState(prefill?.category ?? 'food')
  const [payer, setPayer] = useState(prefill?.paidBy ?? me)
  const [mode, setMode] = useState(prefill?.mode ?? 'equal')
  const [ticked, setTicked] = useState(prefill?.participants ?? activeIds)
  const [ownText, setOwnText] = useState(toText(prefill?.own))
  const [customText, setCustomText] = useState(() => {
    const o = {}
    for (const [id, v] of Object.entries(prefill?.custom ?? {})) o[id] = toText(v)
    return o
  })
  const [confirmTreat, setConfirmTreat] = useState(false)
  const [busy, setBusy] = useState(false)
  const idRef = useRef(uuid())
  const source = prefill?.source ?? 'form'

  const amount = parseRupeesInput(amountText)
  const own = mode === 'my_part' ? parseRupeesNonNeg(ownText) : null
  const titleV = validateTitle(title)

  const { custom, customErr } = useMemo(() => {
    if (mode !== 'custom') return { custom: undefined, customErr: null }
    const c = {}
    for (const id of ticked) {
      const t = (customText[id] ?? '').trim()
      if (!t) continue
      const r = parseRupeesNonNeg(t)
      if (!r.ok) return { custom: c, customErr: `${nameOf(id)}: ${r.error}` }
      c[id] = r.value
    }
    return { custom: c, customErr: null }
  }, [mode, ticked, customText, nameOf])

  const split = amount.ok
    ? computeSplit({
        total: amount.value, payer, participants: ticked, mode,
        own: own?.ok ? own.value : undefined, custom, poster: me, members: memberIds,
      })
    : null

  const valid = Boolean(amount.ok && split?.ok && titleV.ok && (mode !== 'my_part' || own?.ok) && !customErr)
  const draft = valid ? { mode, total: amount.value, paidBy: payer, splits: split.splits } : null
  const offsets = valid ? offsetLines(data, draft, nameOf) : []

  const problem =
    (title && !titleV.ok && titleV.error) ||
    (amountText && !amount.ok && amount.error) ||
    (mode === 'my_part' && ownText && !own?.ok && own?.error) ||
    customErr ||
    (amount.ok && split && !split.ok && split.error) ||
    null

  const pickMode = (m) => {
    setMode(m)
    setConfirmTreat(false)
    if (m === 'full') { setPayer(me); setTicked(activeIds) }
  }
  const toggle = (id) => {
    setConfirmTreat(false)
    setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))
  }

  async function save() {
    if (!valid || busy) return
    if (mode === 'treat' && !confirmTreat) { setConfirmTreat(true); return }
    setBusy(true)
    const r = await actions.saveExpense(groupId, me, {
      id: idRef.current,
      title: titleV.value,
      category,
      total: amount.value,
      paidBy: payer,
      mode,
      participants: ticked,
      own: own?.ok ? own.value : undefined,
      custom,
      source,
    })
    setBusy(false)
    if (!r?.ok) { toast.show(r?.error ?? 'Could not save. Nothing was saved.'); return }
    idRef.current = uuid()
    toast.show('Expense added')
    onDone?.()
  }

  const suggested = ledger?.ok ? ledger.suggested : null
  const remaining = mode === 'custom' && amount.ok ? customRemaining(amount.value, custom) : null
  const unlocked = mode === 'custom' ? ticked.filter((id) => !(id in (custom ?? {}))).length : 0

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-600">Title</span>
          <input
            className={`mt-1 ${inputClass}`}
            value={title} maxLength={40} placeholder="Dinner"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600">Amount (₹)</span>
          <input
            className={`mt-1 ${inputClass} text-2xl! font-semibold`}
            inputMode="decimal" value={amountText} placeholder="0"
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c} type="button" onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm capitalize transition ${category === c ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              <CategoryIcon category={c} size={28} />
              {c}
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-600">Paid by</span>
          <select
            className={`mt-1 ${inputClass}`}
            value={payer} onChange={(e) => setPayer(e.target.value)} disabled={mode === 'full'}
          >
            {active.map((m) => (
              <option key={m.id} value={m.id}>{m.id === me ? `${m.name} (you)` : m.name}</option>
            ))}
          </select>
        </label>
        {suggested && suggested !== payer && mode !== 'full' && (
          <button
            type="button" onClick={() => setPayer(suggested)}
            className="min-h-[44px] rounded-full bg-amber-50 px-4 text-sm text-amber-800 ring-1 ring-amber-200"
          >
            Suggested payer: {nameOf(suggested)} (owes {formatINR(-ledger.nets[suggested])})
          </button>
        )}
        <div>
          <span className="text-sm font-medium text-slate-600">How to split</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.value} type="button" onClick={() => pickMode(o.value)}
                aria-pressed={mode === o.value}
                className={`min-h-11 rounded-xl px-3 text-sm font-medium transition ${mode === o.value ? (o.value === 'treat' ? 'bg-purple-600 text-white' : 'bg-indigo-600 text-white') : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'my_part' && (
          <label className="block">
            <span className="text-sm font-medium text-slate-600">Your own share (₹)</span>
            <input
              className={`mt-1 ${inputClass}`}
              inputMode="decimal" value={ownText} placeholder="0"
              onChange={(e) => setOwnText(e.target.value)}
            />
          </label>
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Split among</span>
          <div className="flex gap-2">
            <button type="button" className="min-h-11 px-2 text-sm font-medium text-indigo-600 disabled:text-slate-300" disabled={mode === 'full'} onClick={() => { setTicked(activeIds); setConfirmTreat(false) }}>Select all</button>
            <button type="button" className="min-h-11 px-2 text-sm text-slate-500 disabled:text-slate-300" disabled={mode === 'full'} onClick={() => { setTicked([]); setConfirmTreat(false) }}>Clear</button>
          </div>
        </div>
        {active.map((m) => (
          <div key={m.id} className="flex min-h-[44px] items-center gap-3">
            <label className="flex flex-1 items-center gap-3">
              <input
                type="checkbox" className="h-5 w-5 accent-indigo-600"
                checked={ticked.includes(m.id)} disabled={mode === 'full'} onChange={() => toggle(m.id)}
              />
              <span className="text-base">{m.id === me ? `${m.name} (you)` : m.name}</span>
            </label>
            {mode === 'custom' && ticked.includes(m.id) && (
              <input
                className={`${inputClass} w-28! text-right`}
                inputMode="decimal" placeholder="auto"
                value={customText[m.id] ?? ''}
                onChange={(e) => setCustomText((c) => ({ ...c, [m.id]: e.target.value }))}
              />
            )}
          </div>
        ))}
        {mode === 'custom' && remaining !== null && (
          <p className={`text-sm ${remaining < 0 ? 'text-red-600' : 'text-slate-600'}`}>
            Remaining to assign: {formatINR(remaining)}{unlocked ? ` (split among ${unlocked} unlocked)` : ''}
          </p>
        )}
      </Card>

      {problem && <ErrorBanner text={problem} />}

      {valid && (
        <Card className="space-y-1 p-4">
          <p className="text-sm font-semibold text-slate-700">Preview</p>
          {mode === 'treat' ? (
            <p className="text-purple-700">Treat by {nameOf(payer)}. Nobody owes anything.</p>
          ) : (
            Object.entries(split.splits).map(([id, v]) => (
              <p key={id} className="text-slate-800">{nameOf(id)} pays {formatINR(v)}</p>
            ))
          )}
          {offsets.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
              {offsets.map((l) => <p key={l} className="text-sm text-slate-600">{l}</p>)}
            </div>
          )}
        </Card>
      )}

      {confirmTreat ? (
        <Card className="space-y-3 p-4">
          <p className="font-medium text-purple-800">Nobody will owe you for this. Continue?</p>
          <div className="flex gap-2">
            <Button variant="primary" busy={busy} disabled={busy} onClick={save}>Yes, it’s a treat</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmTreat(false)}>Back</Button>
          </div>
        </Card>
      ) : (
        <Button variant="primary" className="w-full" busy={busy} disabled={!valid || busy} onClick={save}>
          Save expense
        </Button>
      )}
    </div>
  )
}
