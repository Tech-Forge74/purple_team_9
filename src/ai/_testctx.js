// Test helper: the demo group as a chat context. Used only by tests and scripts.
import { buildDemoExpenses, DEMO_MEMBERS } from '../engine/demo.js'
import { buildLedger } from '../engine/ledger.js'

export const IDS = { Ankit: 'a', Ravi: 'r', Meera: 'm', Sana: 's' }

export function demoCtx(meName = 'Ankit') {
  let n = 0
  const expenses = buildDemoExpenses('g', IDS, () => `e${n++}`, 0)
  const members = DEMO_MEMBERS.map((x) => ({ ...x, id: IDS[x.name] }))
  const group = { id: 'g', members }
  const data = { group, expenses, payments: [], claims: [] }
  const ledger = buildLedger(data)
  const nameOf = (id) => members.find((m) => m.id === id)?.name ?? 'Unknown'
  return { members, meId: IDS[meName], ledger, data, nameOf }
}

// Mock model: parse returns a fixed text (or function of message); rephrase likewise.
export function mockModel({ parse, rephrase } = {}) {
  const calls = { parse: 0, rephrase: 0 }
  return {
    calls,
    parse: async (message, names) => {
      calls.parse++
      const t = typeof parse === 'function' ? parse(message, names) : parse
      return t === undefined ? { ok: false } : { ok: true, text: t }
    },
    rephrase: async (facts) => {
      calls.rephrase++
      const t = typeof rephrase === 'function' ? rephrase(facts) : rephrase
      return t === undefined ? { ok: false } : { ok: true, text: t }
    },
  }
}

export const json = (o) =>
  JSON.stringify({
    intent: 'add_expense', title: null, total_rupees: null, payer: null, participants: null,
    mode: null, own_rupees: null, custom: null, category: null, question: null, ...o,
  })
