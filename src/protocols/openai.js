import { spawn } from 'node:child_process'

export function runCommand(command, args, { timeoutMs = 120000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', data => chunks.push(data))
    child.stderr.on('data', data => errors.push(data))
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      const stdout = Buffer.concat(chunks).toString('utf8').trim()
      const stderr = Buffer.concat(errors).toString('utf8').trim()
      if (code) reject(Object.assign(new Error(stderr || `${command} exited ${code}`), { code, stdout, stderr }))
      else resolve(stdout)
    })
    if (input) child.stdin.write(input)
    child.stdin.end()
  })
}

export async function chatCompletions({
  baseUrl = process.env.LIVE_VOICE_OPENAI_BASE || 'https://api.openai.com/v1',
  apiKey = process.env.LIVE_VOICE_OPENAI_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
  model = process.env.LIVE_VOICE_OPENAI_MODEL || 'gpt-4o-mini',
  messages,
  fetchImpl = globalThis.fetch,
  headers = {},
} = {}) {
  if (!apiKey) throw new Error('OpenAI-compatible brain needs LIVE_VOICE_OPENAI_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY')
  const url = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ model, messages }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error?.message || `chat completions failed: ${response.status}`)
  }
  return payload.choices?.[0]?.message?.content ?? ''
}

export function createOpenAIAsk(options = {}) {
  return async text => chatCompletions({
    ...options,
    messages: [{ role: 'user', content: String(text ?? '') }],
  })
}

export function createOpenRouterAsk(options = {}) {
  return createOpenAIAsk({
    baseUrl: process.env.LIVE_VOICE_OPENROUTER_BASE || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || process.env.LIVE_VOICE_OPENAI_KEY,
    model: process.env.LIVE_VOICE_OPENROUTER_MODEL || options.model || 'openai/gpt-4o-mini',
    headers: {
      'HTTP-Referer': options.referer || 'https://github.com/davidjdseo/live-voice-agent',
      'X-OpenRouter-Title': options.title || 'Live Voice Agent',
    },
    ...options,
  })
}
