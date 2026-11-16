// Before / after picture of who pays whom. Inline SVG, no chart library.
// Names are plain SVG text (React escapes them) and capped with an ellipsis.

import { useId } from 'react'
import { formatINR } from '../money.js'

const SIZE = 300
const C = SIZE / 2
const RING = 105
const NODE = 20

const short = (name) => {
  const s = String(name ?? '')
  return s.length > 8 ? s.slice(0, 7) + '…' : s
}

const shortMoney = (paise) => formatINR(paise).replace(/\.\d{2}$/, '')

function positions(members) {
  const n = members.length || 1
  const out = {}
  members.forEach((m, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    out[m.id] = { x: C + RING * Math.cos(a), y: C + RING * Math.sin(a) }
  })
  return out
}

function Arrow({ from, to, label, both, markerId, className }) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // Curve sideways when the pair has arrows both ways, so they do not overlap.
  const bend = both ? 22 : 0
  const sx = from.x + ux * NODE
  const sy = from.y + uy * NODE
  const ex = to.x - ux * (NODE + 4)
  const ey = to.y - uy * (NODE + 4)
  const mx = (sx + ex) / 2 - uy * bend
  const my = (sy + ey) / 2 + ux * bend
  return (
    <g className={className}>
      <path d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`} fill="none" strokeWidth="2" stroke="currentColor" markerEnd={`url(#${markerId})`} />
      <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize="11" className="fill-slate-700 dark:fill-slate-200" paintOrder="stroke" style={{ stroke: 'var(--card)' }} strokeWidth="3">
        {label}
      </text>
    </g>
  )
}

function Ring({ title, members, edges, tone, nameOf }) {
  const markerId = useId().replace(/:/g, '_') + 'arrow'
  const pos = positions(members)
  const keys = new Set(edges.map((e) => `${e.from}>${e.to}`))
  return (
    <figure className="flex-1 min-w-0">
      <figcaption className="text-center text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">{title}</figcaption>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={`w-full max-w-[300px] mx-auto block ${tone}`} role="img" aria-label={`${title}: ${edges.length} payments`}>
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edges.map((e) =>
          pos[e.from] && pos[e.to] ? (
            <Arrow
              key={`${e.from}>${e.to}`}
              from={pos[e.from]}
              to={pos[e.to]}
              both={keys.has(`${e.to}>${e.from}`)}
              label={shortMoney(e.amount)}
              markerId={markerId}
              className="tally-arrow"
            />
          ) : null,
        )}
        {members.map((m) => (
          <g key={m.id}>
            <circle cx={pos[m.id].x} cy={pos[m.id].y} r={NODE} className="fill-indigo-100 stroke-indigo-500 dark:fill-indigo-900" strokeWidth="2" />
            <text x={pos[m.id].x} y={pos[m.id].y} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" className="fill-indigo-700 dark:fill-indigo-200">
              {String(nameOf(m.id)).charAt(0).toUpperCase()}
            </text>
            <text x={pos[m.id].x} y={pos[m.id].y + NODE + 12} textAnchor="middle" fontSize="11" className="fill-slate-600 dark:fill-slate-300">
              {short(nameOf(m.id))}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  )
}

export default function SettleVisual({ members, raw, plan, nameOf }) {
  const shown = members.filter((m) => !m.removed || raw.some((e) => e.from === m.id || e.to === m.id) || plan.some((e) => e.from === m.id || e.to === m.id))
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <style>{`.tally-arrow{animation:tallyFade .6s ease both}@keyframes tallyFade{from{opacity:0}to{opacity:1}}@media (prefers-reduced-motion: reduce){.tally-arrow{animation:none}}`}</style>
      <Ring title="Before" members={shown} edges={raw} tone="text-slate-400" nameOf={nameOf} />
      <Ring title="After" members={shown} edges={plan} tone="text-indigo-600 dark:text-indigo-400" nameOf={nameOf} />
    </div>
  )
}
