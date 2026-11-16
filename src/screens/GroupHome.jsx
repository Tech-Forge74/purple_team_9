// Group home: header, requests, red/green cards, balances with "Why?", expense and payment lists.
// Every amount shown comes from the engine (ledger / breakdown), never from UI arithmetic.

import { useMemo, useState } from 'react'
import { useGroup } from '../store.js'
import * as actions from '../actions.js'
import { dismissedDeviceBanner, dismissDeviceBanner } from '../session.js'
import { Card, Button, ErrorBanner, Sheet, useToast, QRImage, CopyButton, Empty, Tabs, Avatar, ConfirmButton, CategoryIcon } from '../components/ui.jsx'
import MembersSheet from '../components/Members.jsx'
import { PayBlock, MarkPaid, ClaimButton, RespondButtons, when } from './SettleUp.jsx'
import { formatINR } from '../money.js'
import { breakdown } from '../engine/nets.js'
import { useActivityNotifications } from '../notify.js'
import { checkedBreakdown } from '../engine/ledger.js'
import { owedBetween } from '../engine/settle.js'

const STATUS = { paid: 'Awaiting confirmation', confirmed: 'Received', disputed: 'Not received', undone: 'Undone' }

function Tag({ tone, children }) {
  const tones = {
    red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    grey: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  }
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>
}

function Header({ groupId, group, me, canSwitch, onProfile }) {
  const toast = useToast()
  const [qr, setQr] = useState(false)
  const joinLink = `${window.location.origin}/#join=${group.inviteCode}`

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my Tally group', text: `Join "${group.name}" on Tally with code ${group.inviteCode}`, url: joinLink })
        return
      } catch (err) {
        // The person closed the share sheet on purpose: do nothing.
        if (err?.name === 'AbortError') return
        /* share failed: fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(joinLink)
      toast.show('Invite link copied')
    } catch {
      toast.show('Could not copy. The code is ' + group.inviteCode)
    }
  }

  async function onSwitch(e) {
    const r = await actions.switchMember(groupId, e.target.value)
    if (r && r.ok === false) toast.show(r.error || 'Switching is not allowed here.')
  }

  return (
    <header className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight break-words text-slate-900">{group.name}</h1>
          {group.demo && <p className="text-xs text-indigo-600">Demo group</p>}
        </div>
        <button type="button" onClick={onProfile} className="min-h-11 min-w-11 flex items-center justify-center rounded-full" aria-label="Profile and members">
          <Avatar name={group.members.find((m) => m.id === me)?.name ?? '?'} size={40} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
          <span className="text-slate-500">Code</span>
          <span className="font-mono font-bold tracking-widest text-slate-900">{group.inviteCode}</span>
        </span>
        <CopyButton text={group.inviteCode} label="Copy" />
        <Button variant="ghost" onClick={share}>
          Share
        </Button>
        <Button variant="ghost" onClick={() => setQr(true)}>
          Invite QR
        </Button>
      </div>
      {canSwitch && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Acting as</span>
          <select
            className="min-h-11 rounded-xl border-0 bg-white px-3 ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-500"
            value={me}
            onChange={onSwitch}
          >
            {group.members
              .filter((m) => !m.removed)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <Sheet open={qr} onClose={() => setQr(false)} title="Invite to group">
        <div className="flex flex-col items-center gap-2">
          <QRImage text={joinLink} size={240} />
          <p className="text-center text-sm">
            Scan to join {group.name}. Code {group.inviteCode}
          </p>
          <CopyButton text={joinLink} label="Copy link" />
        </div>
      </Sheet>
    </header>
  )
}

// Top-of-screen answer to "where do I stand?". Amounts come from the ledger.
function Summary({ net, spent }) {
  const tone = net < 0 ? 'from-rose-600 to-red-600' : net > 0 ? 'from-emerald-600 to-teal-600' : 'from-indigo-600 to-violet-600'
  const line = net < 0 ? 'You owe overall' : net > 0 ? 'You are owed overall' : 'You are all settled'
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${tone} p-4 text-white shadow-md`}>
      <p className="text-sm font-medium text-white/80">{line}</p>
      <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{formatINR(Math.abs(net))}</p>
      <p className="mt-2 text-xs text-white/80">Group spending so far: {formatINR(spent)}</p>
    </div>
  )
}

function WhySheet({ memberId, onClose, data, ledger, nameOf }) {
  if (!memberId) return null
  const { lines, ok } = checkedBreakdown(memberId, data, ledger, nameOf)
  return (
    <Sheet open onClose={onClose} title={`Why? ${nameOf(memberId)}`}>
      {!ok && <ErrorBanner text="These lines do not add up to the balance. Please report this." />}
      {lines.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {lines.map((l) => (
          <li key={l.kind + l.id} className="py-2 flex items-start gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words">
              {l.label}
              {l.kind === 'expense' && (
                <span className="block text-xs text-slate-500">
                  {l.paid ? `paid ${formatINR(l.paid)}, ` : ''}share {formatINR(l.share)}
                </span>
              )}
            </span>
            <span className={`font-semibold ${l.effect >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {l.effect >= 0 ? '+' : ''}
              {formatINR(l.effect)}
            </span>
          </li>
        ))}
      </ul>
      {ledger.ok && (
        <p className="pt-2 text-sm font-semibold">
          Balance: {formatINR(ledger.nets[memberId] ?? 0)}
        </p>
      )}
    </Sheet>
  )
}

export default function GroupHome({ groupId, onAdd, onSettle, onLeave }) {
  const { data, ledger, loading, me, realMe, canSwitch, isCreator, nameOf, memberOf } = useGroup(groupId)
  const toastN = useToast()
  useActivityNotifications(groupId, data, me, nameOf, toastN)
  const toast = useToast()
  const [tab, setTab] = useState('expenses')
  const [profile, setProfile] = useState(false)
  const [why, setWhy] = useState(null)
  const [bannerHidden, setBannerHidden] = useState(() => {
    try {
      return dismissedDeviceBanner(groupId)
    } catch {
      return false
    }
  })

  // Per-expense effect for me, from the engine's breakdown (paid minus share).
  const myEffect = useMemo(() => {
    const map = {}
    if (data && me) for (const l of breakdown(me, data.expenses ?? [], [], nameOf)) map[l.id] = l.effect
    return map
  }, [data, me, nameOf])

  if (loading) return <p className="p-4 text-slate-500">Loading…</p>
  if (!data?.group) {
    return (
      <div className="p-4 space-y-3">
        <ErrorBanner text="This group could not be found." />
        {onLeave && <Button onClick={onLeave}>Back</Button>}
      </div>
    )
  }

  const group = data.group
  const ok = ledger?.ok
  const plan = ok ? ledger.plan : []
  const iOwe = plan.filter((p) => p.from === me)
  const owedToMe = plan.filter((p) => p.to === me)
  const myClaims = (data.claims ?? []).filter((c) => c.from === me && c.status !== 'closed')
  const toConfirm = (data.payments ?? []).filter((p) => p.status === 'paid' && p.to === me && p.from !== me)
  const meMember = group.members.find((m) => m.id === me)
  const multiDevice = (meMember?.devices?.length ?? 0) > 1 && !bannerHidden
  const expenses = [...(data.expenses ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  const totalSpent = expenses.reduce((sum, e) => (e.deleted || e.mode === 'treat' ? sum : sum + e.total), 0)
  const payments = [...(data.payments ?? [])].filter((p) => p.status !== 'undone').sort((a, b) => b.createdAt - a.createdAt)

  async function del(e) {
    const r = await actions.deleteExpense(groupId, me, e.id)
    toast.show(r?.ok ? 'Expense deleted. History is kept.' : r?.error || 'Could not delete.')
  }

  function expenseTag(e) {
    if (e.deleted) return <Tag tone="grey">Deleted</Tag>
    if (e.mode === 'treat') return <Tag tone="purple">Treat</Tag>
    const eff = myEffect[e.id]
    if (eff === undefined || eff === 0) return <Tag tone="grey">Not involved</Tag>
    return eff < 0 ? <Tag tone="red">You owe {formatINR(-eff)}</Tag> : <Tag tone="green">You lent {formatINR(eff)}</Tag>
  }

  return (
    <div className="space-y-4 p-4 pb-28">
      <Header groupId={groupId} group={group} me={me} canSwitch={canSwitch} onProfile={() => setProfile(true)} />

      {ok && <Summary net={ledger.nets[me] ?? 0} spent={totalSpent} />}

      {multiDevice && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm flex items-start gap-2">
          <span className="flex-1">Opened on a new device. If this was not you, reissue your link from your profile.</span>
          <button
            type="button"
            className="min-h-11 px-2 font-semibold"
            onClick={() => {
              try {
                dismissDeviceBanner(groupId)
              } catch {
                /* ignore */
              }
              setBannerHidden(true)
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {!ok && <ErrorBanner text={ledger?.error || 'Balances could not be computed.'} />}

      {ok &&
        myClaims.map((c) => {
          const current = owedBetween(plan, me, c.to)
          return (
            <Card key={c.id} className="border-l-4 border-red-500">
              <p className="font-semibold text-red-700 dark:text-red-300">
                {nameOf(c.to)} requested {formatINR(c.amount)}
              </p>
              {c.status === 'awaiting' && <p className="text-sm text-slate-500">Awaiting confirmation</p>}
              {current !== c.amount && (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {current > 0 ? `Updated to ${formatINR(current)}` : 'Nothing is owed now.'}
                </p>
              )}
              {c.status === 'requested' && current > 0 && (
                <div className="mt-2 space-y-3">
                  <PayBlock groupId={groupId} me={me} payee={memberOf(c.to)} amount={current} />
                  <MarkPaid groupId={groupId} me={me} to={c.to} owed={current} claimId={c.id} />
                </div>
              )}
            </Card>
          )
        })}

      {toConfirm.map((p) => (
        <Card key={p.id} className="border-l-4 border-amber-500">
          <p className="font-semibold">
            {nameOf(p.from)} marked {formatINR(p.amount)} as paid
          </p>
          <p className="text-xs text-slate-500 mb-2">{when(p.createdAt)}</p>
          <RespondButtons groupId={groupId} me={me} payment={p} />
        </Card>
      ))}

      {ok && (
        <section className="space-y-3">
          {iOwe.length === 0 && owedToMe.length === 0 && (
            <Card>
              <p className="font-semibold text-green-700 dark:text-green-300">All settled up</p>
            </Card>
          )}
          {iOwe.map((p) => (
            <Card key={`o${p.to}`} className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900">
              <p className="font-semibold text-red-700 dark:text-red-300 mb-2">
                You owe {formatINR(p.amount)} to {nameOf(p.to)}
              </p>
              <div className="space-y-3">
                <PayBlock groupId={groupId} me={me} payee={memberOf(p.to)} amount={p.amount} />
                <MarkPaid groupId={groupId} me={me} to={p.to} owed={p.amount} />
              </div>
            </Card>
          ))}
          {owedToMe.map((p) => (
            <Card key={`i${p.from}`} className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900">
              <p className="font-semibold text-green-700 dark:text-green-300 mb-2">
                {nameOf(p.from)} owes you {formatINR(p.amount)}
              </p>
              <ClaimButton groupId={groupId} me={me} from={p.from} label="Claim / Remind" />
            </Card>
          ))}
        </section>
      )}

      {ok && (
        <Card>
          <h2 className="font-semibold mb-1">Balances</h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {group.members
              .filter((m) => !m.removed || ledger.nets[m.id])
              .map((m) => {
                const net = ledger.nets[m.id] ?? 0
                const treats = ledger.treats[m.id] ?? 0
                return (
                  <li key={m.id}>
                    <button type="button" className="w-full min-h-11 py-2 flex items-center gap-2 text-left" onClick={() => setWhy(m.id)}>
                      <Avatar name={m.name} size={32} />
                      <span className="min-w-0 flex-1 truncate">
                        {m.name}
                        {m.id === me ? ' (you)' : ''}
                        {treats > 0 && (
                          <span className="ml-2 text-xs text-purple-600">
                            {treats} {treats === 1 ? 'treat' : 'treats'} given
                          </span>
                        )}
                      </span>
                      <span className={`font-semibold ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        {net > 0 ? '+' : ''}
                        {formatINR(net)}
                      </span>
                      <span className="text-xs text-indigo-600">Why?</span>
                    </button>
                  </li>
                )
              })}
          </ul>
          <p className="pt-2 text-sm text-slate-500">Group total: {formatINR(Object.values(ledger.nets).reduce((a, b) => a + b, 0))} ✓</p>
          {onSettle && (
            <div className="pt-2">
              <Button variant="ghost" onClick={onSettle}>
                Open settle up
              </Button>
            </div>
          )}
        </Card>
      )}

      <Tabs
        tabs={[
          { value: 'expenses', label: 'Expenses' },
          { value: 'payments', label: 'Payments' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'expenses' && (
        <section className="space-y-2">
          {expenses.length === 0 && (
            <Empty title="No expenses yet" hint="Add the first one by chat or with the form.">
              {onAdd && <Button onClick={onAdd}>Add expense</Button>}
            </Empty>
          )}
          {expenses.map((e) => (
            <Card key={e.id} className={e.deleted ? 'opacity-60' : ''}>
              <div className="flex items-start gap-3">
                <CategoryIcon category={e.category} />
                <div className="min-w-0 flex-1">
                  <p className={`font-medium break-words ${e.deleted ? 'line-through' : ''}`}>{e.title}</p>
                  <p className="text-xs text-slate-500">
                    {e.mode === 'treat' ? `Treat by ${nameOf(e.paidBy)}` : `Paid by ${nameOf(e.paidBy)}`} · Added by {nameOf(e.createdBy)} ·{' '}
                    {when(e.createdAt)}
                    {e.source === 'ai' ? ' · via chat' : ''}
                  </p>
                  {e.deleted && <p className="text-xs text-slate-500">Deleted by {nameOf(e.deletedBy)}</p>}
                </div>
                <div className="text-right space-y-1">
                  <p className={`font-semibold ${e.deleted ? 'line-through' : ''}`}>{formatINR(e.total)}</p>
                  {expenseTag(e)}
                </div>
              </div>
              {!e.deleted && e.createdBy === me && (
                <div className="mt-2 flex justify-end">
                  <ConfirmButton label="Delete" confirmLabel="Tap again to delete" onConfirm={() => del(e)} className="text-xs" />
                </div>
              )}
            </Card>
          ))}
        </section>
      )}

      {tab === 'payments' && (
        <section className="space-y-2">
          {payments.length === 0 && <Empty title="No payments yet" hint="Payments marked as paid show up here." />}
          {payments.map((p) => (
            <Card key={p.id}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {nameOf(p.from)} → {nameOf(p.to)}
                </span>
                <span className={`font-semibold ${p.status === 'disputed' ? 'line-through text-slate-400' : ''}`}>{formatINR(p.amount)}</span>
              </div>
              <p className="text-xs text-slate-500">
                {STATUS[p.status] ?? p.status} · Added by {nameOf(p.createdBy)} · {when(p.createdAt)}
              </p>
            </Card>
          ))}
        </section>
      )}


      <MembersSheet
        open={profile}
        onClose={() => setProfile(false)}
        groupId={groupId}
        group={group}
        me={me}
        realMe={realMe}
        isCreator={isCreator}
        ledger={ledger}
        nameOf={nameOf}
      />
      <WhySheet memberId={why} onClose={() => setWhy(null)} data={data} ledger={ledger} nameOf={nameOf} />
    </div>
  )
}
