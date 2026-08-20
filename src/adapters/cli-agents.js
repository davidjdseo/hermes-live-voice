import { spawn } from 'node:child_process'
import { createPromptAdapter } from './prompt.js'

function run(command, args, { timeoutMs = 120000, input } = {}) {
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

function firstLine(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] ?? ''
}

export function createEchoAsk() {
  return async text => `들었어. ${text}`
}

export function createCodexAsk({ model } = {}) {
  return async text => {
    const args = ['exec', '--skip-git-repo-check']
    if (model) args.push('-m', model)
    args.push(text)
    return run('codex', args)
  }
}

export function createClaudeAsk() {
  return async text => run('claude', ['-p', text, '--output-format', 'text'])
}

export function createPaseoAsk({ agentId } = {}) {
  return async text => {
    const id = agentId || process.env.LIVE_VOICE_PASEO_AGENT
    if (!id) throw new Error('Paseo needs LIVE_VOICE_PASEO_AGENT or --agent <id>')
    return run('paseo', ['send', id, text, '--json'])
  }
}

export function createBrainAsk(kind, options = {}) {
  if (kind === 'echo' || !kind) return createEchoAsk()
  if (kind === 'codex') return createCodexAsk(options)
  if (kind === 'claude') return createClaudeAsk(options)
  if (kind === 'paseo') return createPaseoAsk(options)
  if (kind === 'prompt') {
    if (typeof options.ask !== 'function') throw new TypeError('prompt brain needs ask()')
    return options.ask
  }
  throw new Error(`Unknown brain: ${kind}. Use echo, codex, claude, or paseo.`)
}

export function createAgentBackend({ brain = 'echo', sessionId = 'live', ...options } = {}) {
  return createPromptAdapter({
    sessionId,
    ask: createBrainAsk(brain, options),
  })
}

export { firstLine }
