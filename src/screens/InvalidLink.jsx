import React from 'react'
import { Button } from '../components/ui.jsx'

// Safe failure: no group data and no hint about which part was wrong.
export default function InvalidLink({ onHome }) {
  return (
    <div className="flex min-h-[80dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200 text-2xl font-black text-slate-500" aria-hidden="true">
        T
      </div>
      <h1 className="text-xl font-semibold text-slate-900">This link is no longer valid</h1>
      <p className="text-slate-600">Ask the group creator for a new link or invite code.</p>
      <Button onClick={onHome}>Go to Tally home</Button>
    </div>
  )
}
