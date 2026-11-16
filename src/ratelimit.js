// Small per-device limiters kept in localStorage.

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}

function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage blocked */ }
}

// Wrong invite codes and bad personal links: 5 per minute, then a 30-second lock.
export function failureGate(key = 'tally:rl:fail') {
  return {
    lockedFor(now = Date.now()) {
      const s = load(key, { hits: [], lockUntil: 0 })
      return Math.max(0, (s.lockUntil || 0) - now)
    },
    fail(now = Date.now()) {
      const s = load(key, { hits: [], lockUntil: 0 })
      const hits = (s.hits || []).filter((t) => now - t < 60000)
      hits.push(now)
      if (hits.length >= 5) save(key, { hits: [], lockUntil: now + 30000 })
      else save(key, { hits, lockUntil: s.lockUntil || 0 })
    },
  }
}

// Chat: one message per 2 seconds, 30 per hour per device.
export function chatGate(key = 'tally:rl:chat') {
  return {
    check(now = Date.now()) {
      const hits = load(key, []).filter((t) => now - t < 3600000)
      if (hits.length && now - hits[hits.length - 1] < 2000) return 'Slow down a little. Try again in 2 seconds.'
      if (hits.length >= 30) return 'You have reached 30 messages this hour. Use the form instead.'
      hits.push(now)
      save(key, hits)
      return null
    },
  }
}

// Claims: one reminder to the same person every 10 minutes.
export const REMIND_COOLDOWN_MS = 10 * 60 * 1000
