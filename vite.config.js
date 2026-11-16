import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev only: serve POST /api/llm from api/_core.js so the chat can use the model
// locally. The key is read into the dev server's process.env only. It is never
// passed to `define` and never uses a VITE_ prefix, so it cannot reach the bundle.
function devLlmProxy(serverEnv) {
  return {
    name: 'tally-dev-llm-proxy',
    apply: 'serve',
    configureServer(server) {
      for (const k of ['GROQ_API_KEY', 'GROQ_MODEL', 'LLM_DAILY_CAP']) {
        if (serverEnv[k] && !process.env[k]) process.env[k] = serverEnv[k]
      }
      server.middlewares.use('/api/llm', async (req, res) => {
        const send = (status, json) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(json))
        }
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
        let raw = ''
        let tooBig = false
        req.on('data', (c) => {
          raw += c
          if (raw.length > 8000) { tooBig = true; req.destroy() }
        })
        req.on('end', async () => {
          if (tooBig) return send(413, { error: 'too large' })
          let body = null
          try { body = JSON.parse(raw) } catch { return send(400, { error: 'bad request' }) }
          try {
            const { handleLLM } = await server.ssrLoadModule('/api/_core.js')
            const { status, json } = await handleLLM(body, { ip: req.socket.remoteAddress || 'local' })
            send(status, json)
          } catch {
            send(502, { error: 'unavailable' })
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss(), devLlmProxy(serverEnv)],
    // The only large chunk is the Firebase SDK. It is loaded with import() and only
    // when VITE_FIREBASE_* is set, so it never slows the default (local) app.
    build: { chunkSizeWarningLimit: 650 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.js'],
    },
  }
})
