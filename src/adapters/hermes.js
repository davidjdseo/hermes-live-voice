import { assertAgentHarnessAdapter } from './contract.js'

export function normalizeHermesEvent(event) {
  if (!event || typeof event !== 'object' || !event.type || !event.payload) return null
  return { type: event.type, sessionId: event.session_id, payload: event.payload }
}

export function createHermesAdapter(host) {
  return assertAgentHarnessAdapter({
    getSessionId: () => host.state.focusedSessionId.get(),
    toggle: action => host.request('voice.toggle', { action }),
    record: (action, sessionId) => host.request('voice.record', { action, session_id: sessionId }),
    speak: text => host.request('voice.tts', { text }),
    submit: ({ session_id, text, interrupted }) => host.request('prompt.submit', { session_id, text, ...(interrupted ? { interrupted: true } : {}) }),
    subscribe: (type, handler) => host.onEvent(type, event => { const normalized = normalizeHermesEvent(event); if (normalized?.type === type) handler(normalized) })
  })
}
