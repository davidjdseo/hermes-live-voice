import { assertAgentHarnessAdapter } from './contract.js'

/**
 * Planned harness adapters. Each factory documents the public seam it needs.
 * None of these claim a native microphone or TTS API exists today.
 */
function planned(name, notes) {
  const error = () => {
    throw new Error(`${name} adapter is planned. ${notes}`)
  }
  return assertAgentHarnessAdapter({
    getSessionId: () => null,
    toggle: error,
    record: error,
    speak: error,
    submit: error,
    subscribe: () => () => {},
  })
}

export function createPaseoAdapter() {
  return planned(
    'Paseo',
    'Needs a public plugin RPC that can start/stop capture, speak text, and submit to one session. See docs/INTEGRATIONS.md.',
  )
}

export function createCodexAdapter() {
  return planned(
    'Codex CLI',
    'Needs a public session/event/audio seam. Codex plugins and MCP are not that seam yet.',
  )
}

export function createClaudeCodeAdapter() {
  return planned(
    'Claude Code',
    'Needs native mic/TTS plus a focused session id. Skills/hooks/MCP are not enough.',
  )
}

export function createOrcaAdapter() {
  return planned(
    'Orca',
    'Needs a public voice/audio seam on top of agent session lifecycle.',
  )
}
