// Proves the LLM key is not in the built bundle or the repo.
// Usage: npm run build && npm run check:secrets
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel'])
const SKIP_FILES = new Set(['.env', 'check-secrets.mjs'])
const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|json|html|css|md|txt|map|svg|rules|yml|yaml|example)$/i

function readEnvSecrets() {
  const out = []
  const file = join(root, '.env')
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(GROQ_API_KEY|ANTHROPIC_API_KEY|[A-Z_]*SECRET[A-Z_]*)\s*=\s*(.+?)\s*$/.exec(line)
    if (m && m[2].replace(/^["']|["']$/g, '').length >= 8) out.push(m[2].replace(/^["']|["']$/g, ''))
  }
  return out
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (!SKIP_FILES.has(name) && !name.startsWith('.env.') && TEXT_EXT.test(name) && st.size < 20_000_000) yield p
  }
}

const values = readEnvSecrets()
const patterns = [/sk-ant-[A-Za-z0-9_-]{10,}/, /gsk_[A-Za-z0-9]{20,}/]
const hits = []

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8')
  for (const v of values) if (text.includes(v)) hits.push(`${relative(root, file)}: contains a value from .env`)
  for (const re of patterns) if (re.test(text)) hits.push(`${relative(root, file)}: matches ${re.source.slice(0, 8)}…`)
}

if (!existsSync(join(root, 'dist'))) console.log('Note: dist/ not found. Run `npm run build` first to check the bundle too.')
if (hits.length) {
  console.error('Secret found:\n' + hits.join('\n'))
  process.exit(1)
}
console.log(`No API key found (${values.length} .env secret value(s) checked, dist/ and repo scanned).`)
