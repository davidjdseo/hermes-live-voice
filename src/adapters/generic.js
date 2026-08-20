import { createPromptAdapter } from './prompt.js'
import { createBrainAsk } from './cli-agents.js'

/**
 * Harness adapters for always-on. Capture and TTS stay in the local engines.
 * These adapters only need a public prompt/session seam.
 */
export function createPaseoAdapter({ agentId, ask } = {}) {
  const id = agentId || process.env.LIVE_VOICE_PASEO_AGENT
  return createPromptAdapter({
    sessionId: id || 'paseo',
    ask: ask || createBrainAsk('paseo', { agentId: id }),
  })
}

export function createCodexAdapter({ ask, model } = {}) {
  return createPromptAdapter({
    sessionId: 'codex',
    ask: ask || createBrainAsk('codex', { model }),
  })
}

export function createClaudeCodeAdapter({ ask } = {}) {
  return createPromptAdapter({
    sessionId: 'claude',
    ask: ask || createBrainAsk('claude'),
  })
}

export function createOrcaAdapter() {
  throw new Error(
    'Orca has session lifecycle commands, but no public per-session prompt+event voice seam yet. Use createPromptAdapter({ ask }) or createCodexAdapter / createClaudeCodeAdapter.',
  )
}
