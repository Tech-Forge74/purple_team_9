// Shared UI kit. All user text is rendered as plain React text.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

const cx = (...c) => c.filter(Boolean).join(' ')

const AVATAR_COLORS = ['bg-indigo-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500']

function initials(name) {
  const parts = String(name ?? '?').trim().split(/\s+/).filter(Boolean)
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)
  return s.toUpperCase()
}

function colorFor(name) {
  let h = 0
  for (const ch of String(name ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function Avatar({ name, size = 40, className }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', colorFor(name), className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  )
}

export function Card({ className, children, ...rest }) {
  return (
    <div className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70', className)} {...rest}>
      {children}
    </div>
  )
}

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  ghost: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  subtle: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:text-indigo-300',
}

export function Button({ variant = 'primary', busy = false, disabled, className, children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed',
        VARIANTS[variant] ?? VARIANTS.primary,
        className,
      )}
      {...rest}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function ErrorBanner({ text, className }) {
  if (!text) return null
  return (
    <div role="alert" className={cx('rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200', className)}>
      {text}
    </div>
  )
}

export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl safe-bottom">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full text-xl text-slate-500 hover:bg-slate-100" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const ToastCtx = createContext({ show: () => {} })
let toastSeq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])
  const show = useCallback((text, opts = {}) => {
    toastSeq += 1
    const id = `t${toastSeq}`
    setToasts((t) => [...t.slice(-2), { id, text: String(text), action: opts.action, tone: opts.tone }])
    timers.current.set(id, setTimeout(() => dismiss(id), opts.ms ?? 3500))
    return id
  }, [dismiss])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  return (
    <ToastCtx.Provider value={{ show, dismiss }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm text-white shadow-lg',
              t.tone === 'error' ? 'bg-red-700' : 'bg-slate-900',
            )}
          >
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-lg px-2 font-semibold text-indigo-300 hover:text-indigo-200"
                onClick={() => { t.action.onClick(); dismiss(t.id) }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

// QR generated in the browser. Nothing is sent to a third party.
export function QRImage({ text, size = 220, label }) {
  const [src, setSrc] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    setErr(false)
    if (!text) { setSrc(null); return undefined }
    QRCode.toDataURL(String(text), { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setSrc(url) })
      .catch(() => { if (alive) setErr(true) })
    return () => { alive = false }
  }, [text, size])
  if (err) return <p className="text-sm text-slate-500">Could not draw the QR code. Use the Copy link button.</p>
  return (
    <div className="flex justify-center">
      {src ? (
        <img src={src} width={size} height={size} alt={label ?? 'QR code'} className="rounded-xl bg-white p-2 ring-1 ring-slate-200" />
      ) : (
        <div style={{ width: size, height: size }} className="animate-pulse rounded-xl bg-slate-100" />
      )}
    </div>
  )
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text))
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = String(text)
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function CopyButton({ text, label = 'Copy', variant = 'ghost', className }) {
  const toast = useToast()
  return (
    <Button
      variant={variant}
      className={className}
      onClick={async () => {
        const ok = await copyText(text)
        toast.show(ok ? 'Copied' : 'Could not copy. Select the text and copy it.', ok ? {} : { tone: 'error' })
      }}
    >
      {label}
    </Button>
  )
}

export function Empty({ title, hint, children }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cx('flex gap-1 rounded-xl bg-slate-100 p-1', className)}>
      {tabs.map((t) => {
        const id = typeof t === 'string' ? t : t.value
        const label = typeof t === 'string' ? t : t.label
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cx(
              'min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition',
              active ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function Field({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  )
}

export const inputClass =
  'block min-h-11 w-full rounded-xl border-0 bg-white px-3 py-2 text-base text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500'

// Two-tap confirm for destructive actions: first tap arms, second tap acts.
// Disarms itself after a few seconds so a stray tap later does nothing.
export function ConfirmButton({ onConfirm, label, confirmLabel = 'Tap again to confirm', variant = 'ghost', busy, disabled, className }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Button
      variant={armed ? 'danger' : variant}
      busy={busy}
      disabled={disabled}
      className={className}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}

const CATEGORY_STYLE = {
  food: ['bg-orange-100 text-orange-700', 'M4 3v8a3 3 0 0 0 6 0V3M7 3v18M17 3c-2 0-3 2-3 6s1 5 3 5v7'],
  travel: ['bg-sky-100 text-sky-700', 'M3 13l18-7-7 18-2-8z'],
  stay: ['bg-violet-100 text-violet-700', 'M3 20V8l9-5 9 5v12M9 20v-6h6v6'],
  fuel: ['bg-amber-100 text-amber-700', 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 10h2a2 2 0 0 1 2 2v4a2 2 0 0 0 4 0V8l-3-3'],
  fun: ['bg-pink-100 text-pink-700', 'M12 3l2.6 5.6 6 .6-4.5 4 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.5-4 6-.6z'],
  shopping: ['bg-emerald-100 text-emerald-700', 'M5 7h14l-1 13H6zM9 7a3 3 0 0 1 6 0'],
  other: ['bg-slate-100 text-slate-600', 'M5 12h.01M12 12h.01M19 12h.01'],
}

export function CategoryIcon({ category, size = 40 }) {
  const [tone, path] = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.other
  return (
    <span aria-hidden="true" className={cx('inline-flex shrink-0 items-center justify-center rounded-xl', tone)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  )
}
