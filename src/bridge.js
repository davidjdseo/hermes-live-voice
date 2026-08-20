import { VoiceCore } from './core.js'
import { assertAgentHarnessAdapter, ownsSession } from './adapters/contract.js'

export const BRIDGE_EVENTS = Object.freeze([
  'voice.transcript',
  'voice.status',
  'wake.detected',
  'message.start',
  'message.delta',
  'message.interim',
  'message.complete',
  'voice.interrupted'
])

export function createVoiceBridge(adapter, { onStatus = () => {}, onError = () => {}, ...coreOptions } = {}) {
  assertAgentHarnessAdapter(adapter)
  let disposed = false
  let voiceEnabled = false
  const listeners = []
  const invoke = (method, label, ...args) => {
    try {
      return Promise.resolve(adapter[method](...args)).catch(error => { onError(error, label); return undefined })
    } catch (error) {
      onError(error, label)
      return Promise.resolve(undefined)
    }
  }
  const core = new VoiceCore({
    ...coreOptions,
    onRecord: (action, sessionId) => void invoke('record', `voice.record ${action}`, action, sessionId),
    onSpeak: text => void invoke('speak', 'voice.tts', text),
    onSubmit: payload => void invoke('submit', 'prompt.submit', payload),
    onStatus
  })
  const dispatch = (type, item) => {
    if (disposed || !ownsSession(item, core.sessionId)) return { ignored: true }
    const payload = item.payload ?? {}
    switch (type) {
      case 'voice.transcript': return core.acceptTranscript(item.sessionId, payload.text ?? '')
      case 'voice.status': return core.voiceStatus(item.sessionId, payload.state)
      case 'wake.detected': return core.wake(item.sessionId)
      case 'message.start': return core.messageStart(item.sessionId, payload)
      case 'message.delta': return core.messageDelta(item.sessionId, payload.delta ?? payload.text ?? '')
      case 'message.interim': return core.messageInterim(item.sessionId, payload.text ?? payload.interim ?? '')
      case 'message.complete': return core.messageComplete(item.sessionId, payload)
      case 'voice.interrupted': {
        const text = payload.text ?? payload.transcript ?? ''
        return text ? core.acceptTranscript(item.sessionId, text) : { accepted: false, ignored: true, reason: 'empty interruption' }
      }
      default: return { ignored: true }
    }
  }
  for (const type of BRIDGE_EVENTS) {
    const dispose = adapter.subscribe(type, item => dispatch(type, item))
    if (typeof dispose === 'function') listeners.push(dispose)
  }
  const start = async (sessionId = adapter.getSessionId()) => {
    if (disposed) throw new Error('Voice bridge is disposed')
    if (!sessionId) throw new Error('A focused session is required to start voice')
    await adapter.toggle('on')
    voiceEnabled = true
    core.start(sessionId)
    return true
  }
  const stop = async () => {
    if (disposed) return false
    core.stop()
    if (!voiceEnabled) return true
    try {
      await adapter.toggle('off')
    } finally {
      voiceEnabled = false
    }
    return true
  }
  const dispose = async () => {
    if (disposed) return false
    disposed = true
    listeners.splice(0).forEach(disposeListener => disposeListener?.())
    core.dispose()
    if (!voiceEnabled) return true
    try {
      await adapter.toggle('off')
    } finally {
      voiceEnabled = false
    }
    return true
  }
  return { core, controller: core, get phase() { return core.phase }, start, stop, dispose, dispatch }
}
