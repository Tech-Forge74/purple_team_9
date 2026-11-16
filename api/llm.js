// Vercel serverless function: POST /api/llm
import { handleLLM } from './_core.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const { status, json } = await handleLLM(req.body, { ip })
  res.status(status).json(json)
}
