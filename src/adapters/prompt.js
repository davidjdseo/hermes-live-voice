import { assertAgentHarnessAdapter } from './contract.js'

const EVENTS = Object.freeze([
  'voice.transcript',
  'voice.status',
  'wake.detected',
  'message.start',
  'message.delta',
  'message.interim',
  'message.complete',
  'voice.interrupted',
])

function wrapVoice(text) {
  const spoken = String(text ?? '').trim()
  if (!spoken) return '<<<VOICE 네. VOICE>>>'
  if (/<<<VOICE[\s\S]*VOICE>>>/.test(spoken)) return spoken
  return `<<<VOICE ${spoken} VOICE>>>`
}

/**
 * Smallest backend that just talks. The library still does not own API keys:
 * `ask(text, { interrupted })` is supplied by the caller.
 */
export function createPromptAdapter({
  sessionId = 'live',
  ask,
  speak,
  wrap = true,
} = {}) {
  if (typeof ask !== 'function') throw new TypeError('createPromptAdapter requires ask(text, meta)')
  const handlers = new Map()
  const emit = (type, payload = {}) => handlers.get(type)?.({ type, sessionId, payload })
  let turn = 0

  return assertAgentHarnessAdapter({
    getSessionId: () => sessionId,
    toggle() {},
    record() {},
    speak(text) { return speak?.(text) },
    async submit({ text, interrupted }) {
      const id = `turn-${++turn}`
      emit('message.start', { id, turn_id: id })
      const answer = await ask(String(text ?? ''), { interrupted: Boolean(interrupted), sessionId })
      const payload = wrapVoice(wrap ? answer : answer)
      emit('message.complete', { id, turn_id: id, text: payload })
    },
    subscribe(type, callback) {
      if (!EVENTS.includes(type)) return () => {}
      handlers.set(type, callback)
      return () => { if (handlers.get(type) === callback) handlers.delete(type) }
    },
  })
}
