// Browser side of the model call. The key lives only on the /api/llm proxy.
// Any failure (no proxy, no key, timeout, bad status) returns { ok: false }.

const TIMEOUT_MS = 6000

async function post(body, fetchImpl = globalThis.fetch) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false }
    const data = await res.json()
    return typeof data?.text === 'string' ? { ok: true, text: data.text } : { ok: false }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export const llm = {
  parse: (message, names) => post({ task: 'parse', message, names }),
  rephrase: (facts) => post({ task: 'rephrase', message: facts }),
}
