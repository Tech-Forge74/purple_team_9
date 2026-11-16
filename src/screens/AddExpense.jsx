import { useState } from 'react'
import { useGroup } from '../store.js'
import { Tabs, ErrorBanner } from '../components/ui.jsx'
import ExpenseForm from '../components/ExpenseForm.jsx'
import ChatBox from '../components/ChatBox.jsx'

export default function AddExpense({ groupId, prefill, onDone }) {
  const g = useGroup(groupId)
  const [tab, setTab] = useState(prefill ? 'form' : 'chat')
  const [formPrefill, setFormPrefill] = useState(prefill ?? null)
  const [formKey, setFormKey] = useState(0)

  if (g.loading) return <p className="p-6 text-center text-slate-500">Loading…</p>
  if (!g.data?.group) return <div className="p-4"><ErrorBanner text="This group could not be loaded." /></div>

  const ctx = { data: g.data, ledger: g.ledger, me: g.me, nameOf: g.nameOf, memberOf: g.memberOf }

  const editDraft = (draft) => {
    setFormPrefill(draft)
    setFormKey((k) => k + 1)
    setTab('form')
  }

  return (
    <div className="space-y-4 p-4 pb-28">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Add expense</h1>
      <Tabs
        tabs={[{ value: 'chat', label: 'Chat' }, { value: 'form', label: 'Form' }]}
        value={tab} onChange={setTab}
      />
      {g.ledger && !g.ledger.ok && <ErrorBanner text={g.ledger.error} />}
      {tab === 'chat' ? (
        <ChatBox groupId={groupId} ctx={ctx} onEdit={editDraft} onManual={() => setTab('form')} />
      ) : (
        <ExpenseForm
          key={formKey} groupId={groupId} data={g.data} ledger={g.ledger} me={g.me}
          nameOf={g.nameOf} prefill={formPrefill} onDone={onDone}
        />
      )}
    </div>
  )
}
