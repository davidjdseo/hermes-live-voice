import { spawn } from 'node:child_process'
import { createPromptAdapter } from './prompt.js'
import { runCommand, createOpenAIAsk, createOpenRouterAsk } from '../protocols/openai.js'
import { createAcpAsk } from '../protocols/acp.js'

export const BRAINS = Object.freeze([
  'echo',
  'codex',
  'claude',
  'opencode',
  'gemini',
  'paseo',
  'openai',
  'openrouter',
  'orca',
  'acp',
  'prompt',
])

export function createEchoAsk() {
  return async text => `들었어. ${text}`
}

export function createCodexAsk({ model } = {}) {
  return async text => {
    const args = ['exec', '--skip-git-repo-check']
    if (model) args.push('-m', model)
    args.push(text)
    return runCommand('codex', args)
  }
}

export function createClaudeAsk() {
  return async text => runCommand('claude', ['-p', text, '--output-format', 'text'])
}

export function createOpenCodeAsk({ model } = {}) {
  return async text => {
    const args = ['run']
    if (model) args.push('-m', model)
    args.push(String(text ?? ''))
    return runCommand('opencode', args)
  }
}

export function createGeminiAsk({ model } = {}) {
  return async text => {
    const args = ['-p', String(text ?? '')]
    if (model) args.push('-m', model)
    return runCommand('gemini', args)
  }
}

export function createPaseoAsk({ agentId } = {}) {
  return async text => {
    const id = agentId || process.env.LIVE_VOICE_PASEO_AGENT
    if (!id) throw new Error('Paseo needs LIVE_VOICE_PASEO_AGENT or --agent <id>')
    return runCommand('paseo', ['send', id, text, '--json'])
  }
}

export function orcaPromptArgs({
  text,
  terminal,
  agent = process.env.LIVE_VOICE_ORCA_AGENT || 'codex',
  name = process.env.LIVE_VOICE_ORCA_NAME || 'live-voice',
} = {}) {
  if (terminal || process.env.LIVE_VOICE_ORCA_TERMINAL) {
    return ['terminal', 'send', '--terminal', terminal || process.env.LIVE_VOICE_ORCA_TERMINAL, '--text', String(text ?? ''), '--enter']
  }
  return ['worktree', 'create', '--name', name, '--no-parent', '--agent', agent, '--prompt', String(text ?? ''), '--json']
}

export function createOrcaAsk(options = {}) {
  return async text => runCommand('orca', orcaPromptArgs({ ...options, text }))
}

export function createBrainAsk(kind, options = {}) {
  const name = String(kind || 'echo').toLowerCase()
  if (name === 'echo') return createEchoAsk()
  if (name === 'codex') return createCodexAsk(options)
  if (name === 'claude') return createClaudeAsk(options)
  if (name === 'opencode') return createOpenCodeAsk(options)
  if (name === 'gemini') return createGeminiAsk(options)
  if (name === 'paseo') return createPaseoAsk(options)
  if (name === 'openai') return createOpenAIAsk(options)
  if (name === 'openrouter') return createOpenRouterAsk(options)
  if (name === 'orca') return createOrcaAsk(options)
  if (name === 'acp') return createAcpAsk(options)
  if (name === 'prompt') {
    if (typeof options.ask !== 'function') throw new TypeError('prompt brain needs ask()')
    return options.ask
  }
  throw new Error(`Unknown brain: ${kind}. Use ${BRAINS.filter(item => item !== 'prompt').join(', ')}.`)
}

export function createAgentBackend({ brain = 'echo', sessionId = 'live', ask, ...options } = {}) {
  return createPromptAdapter({
    sessionId,
    ask: ask || createBrainAsk(brain, options),
  })
}

export function createCodexAdapter(options = {}) {
  return createAgentBackend({ brain: 'codex', sessionId: 'codex', ...options })
}

export function createClaudeCodeAdapter(options = {}) {
  return createAgentBackend({ brain: 'claude', sessionId: 'claude', ...options })
}

export function createPaseoAdapter({ agentId, ...options } = {}) {
  return createAgentBackend({ brain: 'paseo', sessionId: agentId || 'paseo', agentId, ...options })
}

export function createOrcaAdapter(options = {}) {
  return createAgentBackend({
    brain: 'orca',
    sessionId: options.terminal || options.agent || 'orca',
    ...options,
  })
}

export function createOpenCodeAdapter(options = {}) {
  return createAgentBackend({ brain: 'opencode', sessionId: 'opencode', ...options })
}

export function createGeminiAdapter(options = {}) {
  return createAgentBackend({ brain: 'gemini', sessionId: 'gemini', ...options })
}

export { spawn }
