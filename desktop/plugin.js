/* hermes-live-voice generated desktop plugin; do not edit desktop/plugin.js directly. */
import { atom, Button, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
export const PHASES = Object.freeze({ OFF: 'off', IDLE: 'idle', LISTENING: 'listening', THINKING: 'thinking', SPEAKING: 'speaking' });
const VOICE_RE = /<<<VOICE\s*([\s\S]*?)\s*VOICE>>>/g;
const CONTINUE = new Set(['진행해', '진행해 헤르메스', 'proceed', 'continue', 'go on', 'go']);
const FILLERS = new Set(['음', '어', '아', '흠', 'um', 'uh', 'erm', 'hmm', 'okay', 'ok', '네', '응']);

export function normalizeTranscript(value) { return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[“”"'`.,!?;:()[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim(); }
export function parseVoiceBlocks(text) { const source = String(text ?? ''), blocks = []; let match; VOICE_RE.lastIndex = 0; while ((match = VOICE_RE.exec(source))) blocks.push(match[1].trim()); const open = source.lastIndexOf('<<<VOICE'), close = source.lastIndexOf('VOICE>>>'); return { blocks, complete: open < 0 || close > open, endsAtEnd: close < 0 || !source.slice(close + 'VOICE>>>'.length).trim(), text: blocks.join('\n').trim() }; }
export function aggregateMessage(parts) { return [...parts].join(''); }
export function clampVoiceSentences(text, max = 5) { const sentences = String(text ?? '').match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)?.map(sentence => sentence.trim()).filter(Boolean) ?? []; return sentences.slice(0, max).join(' '); }
export function estimateSpeechRearmMs(text, { charsPerSecond = 7, drainMs = 800, minMs = 500, maxMs = 30000 } = {}) { const estimate = Math.ceil([...String(text ?? '')].length * 1000 / charsPerSecond + drainMs); return Math.max(minMs, Math.min(maxMs, estimate)); }
function meaningful(text) { const n = normalizeTranscript(text); return n.length >= 2 && !FILLERS.has(n) && /[\p{L}\p{N}]/u.test(n) && !/^(.)\1+$/.test(n); }
function editSimilarity(a, b) { const aa = [...a], bb = [...b]; if (!aa.length || !bb.length) return 0; const row = Array.from({ length: bb.length + 1 }, (_, i) => i); for (let i = 1; i <= aa.length; i++) { let diagonal = row[0]; row[0] = i; for (let j = 1; j <= bb.length; j++) { const old = row[j]; row[j] = aa[i - 1] === bb[j - 1] ? diagonal : 1 + Math.min(diagonal, row[j], row[j - 1]); diagonal = old; } } return 1 - row[bb.length] / Math.max(aa.length, bb.length); }
function ngramSimilarity(a, b) { const grams = value => new Set([...value].map((_, i) => [...value].slice(i, i + 2).join('')).filter(x => x.length === 2)); const aa = grams(a), bb = grams(b); if (!aa.size || !bb.size) return 0; return [...aa].filter(x => bb.has(x)).length / new Set([...aa, ...bb]).size; }
export function ttsEchoSimilarity(a, b) { const aa = normalizeTranscript(a).replaceAll(' ', ''), bb = normalizeTranscript(b).replaceAll(' ', ''); if (!aa || !bb || Math.max(aa.length, bb.length) < 6) return 0; return Math.max(editSimilarity(aa, bb), ngramSimilarity(aa, bb)); }
function choiceOf(text) { const n = normalizeTranscript(text), m = n.match(/^(?:choice\s*)?([abc])$/); return m?.[1] ?? ({ 에이: 'a', 비: 'b', 씨: 'c' }[n] ?? null); }
function questionChoices(text) { const found = new Set(); for (const m of String(text).matchAll(/(?:^|\s)([ABC])(?=\s*(?:[).:-]|[가-힣]))/g)) { found.add(m[1].toLowerCase()); if (found.size === 3) break; } return found; }

export class VoiceCore {
  constructor({ onSubmit = () => {}, onRecord = () => {}, onSpeak = () => {}, onVoice = () => {}, onStatus = () => {}, scheduler = globalThis, rearm = {}, wakeAcknowledgement = '네, 말씀하세요.' } = {}) {
    this.hooks = { onSubmit, onRecord, onSpeak, onVoice, onStatus }; this.scheduler = scheduler; this.minRearmMs = rearm.min ?? 500; this.maxRearmMs = rearm.max ?? 30000; this.noBlockRearmMs = rearm.noBlock ?? 700; this.wakeAcknowledgement = String(wakeAcknowledgement ?? '').trim();
    this.phase = PHASES.OFF; this.sessionId = null; this.armed = false; this.afterReply = false; this.lastSpoken = ''; this.lastQuestionChoices = new Set(); this.parts = []; this.turnId = null; this.completedTurns = new Set(); this.lastAccepted = ''; this.lastRejection = ''; this.rearmTimer = null; this.wakeAcknowledgementPending = false;
  }
  status(phase, reason = '') { this.phase = phase; this.lastRejection = reason; this.hooks.onStatus({ phase, accepted: this.lastAccepted, rejection: reason }); }
  cancelRearm() { if (this.rearmTimer !== null) { this.scheduler.clearTimeout(this.rearmTimer); this.rearmTimer = null; } this.wakeAcknowledgementPending = false; }
  scheduleRearm(ms) { if (this.rearmTimer !== null) return; const delay = Math.max(this.minRearmMs, Math.min(this.maxRearmMs, ms)); this.rearmTimer = this.scheduler.setTimeout(() => { this.rearmTimer = null; this.wakeAcknowledgementPending = false; if (this.sessionId && [PHASES.IDLE, PHASES.LISTENING, PHASES.SPEAKING].includes(this.phase)) { this.status(PHASES.IDLE); this.hooks.onRecord('start', this.sessionId); } }, delay); }
  ensureIdleRearm() { if ([PHASES.IDLE, PHASES.LISTENING].includes(this.phase) && this.rearmTimer === null) this.scheduleRearm(this.noBlockRearmMs); }
  resetTurnState() { this.parts = []; this.turnId = null; this.completedTurns.clear(); this.lastSpoken = ''; this.lastQuestionChoices = new Set(); this.afterReply = false; this.wakeAcknowledgementPending = false; }
  setSession(sessionId) { if (sessionId !== this.sessionId) { this.cancelRearm(); this.resetTurnState(); this.sessionId = sessionId; } return this.sessionId === sessionId; }
  belongs(sessionId) { return Boolean(this.sessionId) && sessionId === this.sessionId; }
  start(sessionId) { if (!sessionId) return false; if (this.sessionId && this.sessionId !== sessionId) this.hooks.onRecord('stop', this.sessionId); this.setSession(sessionId); this.cancelRearm(); this.resetTurnState(); this.armed = true; this.hooks.onVoice('on'); this.status(PHASES.LISTENING); this.hooks.onRecord('start', sessionId); return true; }
  stop() { this.cancelRearm(); if (this.phase !== PHASES.OFF && this.sessionId) this.hooks.onRecord('stop', this.sessionId); this.hooks.onVoice('off'); this.status(PHASES.OFF); this.sessionId = null; this.armed = false; this.resetTurnState(); }
  wake(sessionId = this.sessionId) { if (!this.belongs(sessionId)) return { ignored: true }; if (this.wakeAcknowledgementPending) return { accepted: false, armed: true, reason: 'wake' }; const hasPendingRearm = this.rearmTimer !== null; if (!this.wakeAcknowledgement && hasPendingRearm) { this.armed = true; this.afterReply = false; this.status(PHASES.LISTENING); return { accepted: false, armed: true, reason: 'wake' }; } this.cancelRearm(); this.armed = true; this.afterReply = false; if (!this.wakeAcknowledgement) { this.status(PHASES.LISTENING); this.ensureIdleRearm(); return { accepted: false, armed: true, reason: 'wake' }; } this.hooks.onRecord('stop', this.sessionId); this.wakeAcknowledgementPending = true; this.lastSpoken = this.wakeAcknowledgement; this.status(PHASES.SPEAKING); this.scheduleRearm(estimateSpeechRearmMs(this.wakeAcknowledgement, { minMs: this.minRearmMs, maxMs: this.maxRearmMs })); this.hooks.onSpeak(this.wakeAcknowledgement); return { accepted: false, armed: true, reason: 'wake' }; }
  voiceStatus(sessionId, state) { if (!this.belongs(sessionId)) return { ignored: true }; if (this.wakeAcknowledgementPending && this.rearmTimer !== null) return { ignored: false }; if (['idle', 'ready', 'stopped', 'complete', 'done'].includes(String(state).toLowerCase())) { this.status(PHASES.IDLE); this.ensureIdleRearm(); } return { ignored: false }; }
  acceptTranscript(sessionId, raw) {
    if (!this.belongs(sessionId)) return { accepted: false, ignored: true, reason: 'session mismatch' }; const text = String(raw ?? '').trim(), n = normalizeTranscript(text), choice = choiceOf(text);
    if (!meaningful(text) && !(this.afterReply && choice)) return this.reject('filler/noise');
    // TTS echo: reject if transcript is similar to last spoken text (fuzzy, Korean-aware)
    if (this.lastSpoken && ttsEchoSimilarity(text, this.lastSpoken) >= 0.72) return this.reject('tts echo');
    // TTS echo: reject if transcript contains a significant substring of last spoken text (handles Whisper misrecognition)
    if (this.lastSpoken) { const spoken = normalizeTranscript(this.lastSpoken).replaceAll(' ', ''), heard = n.replaceAll(' ', ''); if (spoken.length >= 4 && heard.length >= 4 && (spoken.includes(heard) || heard.includes(spoken))) return this.reject('tts echo substring'); }
    const wake = /^(?:헤이\s*헤르메스(?=\s|$)|hey\s+hermes\b)\s*/i, hadWake = wake.test(text), command = text.replace(wake, '').trim(); if (hadWake && !command) return this.wake(sessionId);
    if (this.phase === PHASES.THINKING || this.phase === PHASES.SPEAKING) return meaningful(text) ? this.submit(text, true) : this.reject('filler/noise');
    if (this.afterReply && !hadWake) { if (CONTINUE.has(n) || (choice && this.lastQuestionChoices.has(choice))) return this.submit(text, false); return this.reject('not armed: continue cue or matching choice required'); }
    if (!this.armed && !hadWake) return this.reject('not armed'); return command ? this.submit(command, false) : this.reject('empty command');
  }
  submit(text, interrupted) { this.cancelRearm(); this.lastAccepted = text; this.armed = false; this.afterReply = false; this.hooks.onRecord('stop', this.sessionId); this.status(PHASES.THINKING); this.hooks.onSubmit({ session_id: this.sessionId, text, ...(interrupted ? { interrupted: true } : {}) }); return { accepted: true, text, interrupted: Boolean(interrupted) }; }
  reject(reason) { this.lastRejection = reason; this.hooks.onStatus({ phase: this.phase, accepted: this.lastAccepted, rejection: reason }); this.ensureIdleRearm(); return { accepted: false, reason }; }
  messageStart(sessionId, payload = {}) { if (!this.belongs(sessionId)) return { ignored: true }; this.cancelRearm(); this.turnId = payload.turn_id ?? payload.id ?? null; this.parts = []; this.status(PHASES.THINKING); return { ignored: false }; }
  messageDelta(sessionId, text) { if (this.belongs(sessionId)) this.parts.push(String(text ?? '')); }
  messageInterim(sessionId, text) { if (this.belongs(sessionId) && text) this.parts.push(String(text)); }
  messageComplete(sessionId, payload = {}) { if (!this.belongs(sessionId)) return { spoken: false, ignored: true, reason: 'session mismatch' }; const id = payload.turn_id ?? payload.id ?? this.turnId ?? Symbol('turn'); if (this.completedTurns.has(id)) return { spoken: false, reason: 'duplicate complete' }; this.completedTurns.add(id); const parsed = parseVoiceBlocks(payload.text ?? aggregateMessage(this.parts)); this.afterReply = true; this.armed = false; if (!parsed.complete || !parsed.text || parsed.blocks.length !== 1 || !parsed.endsAtEnd) { this.status(PHASES.IDLE); this.scheduleRearm(this.noBlockRearmMs); return { spoken: false, reason: !parsed.complete ? 'unclosed voice block' : parsed.blocks.length !== 1 ? 'expected exactly one voice block' : parsed.text ? 'voice block must end response' : 'no voice block' }; } const spoken = clampVoiceSentences(parsed.text); this.lastSpoken = spoken; this.lastQuestionChoices = questionChoices(spoken); this.status(PHASES.SPEAKING); this.hooks.onSpeak(spoken); this.scheduleRearm(estimateSpeechRearmMs(spoken)); return { spoken: true, text: spoken }; }
  dispose() { this.cancelRearm(); this.stop(); }
}

/**
 * Small harness boundary. VoiceCore only consumes callbacks; an adapter owns
 * transport, session lookup, request verbs, and event normalization.
 */
export function assertAgentHarnessAdapter(adapter) {
  const required = ['getSessionId', 'toggle', 'record', 'speak', 'submit', 'subscribe'];
  for (const name of required) if (typeof adapter?.[name] !== 'function') throw new TypeError(`AgentHarnessAdapter.${name} is required`);
  return adapter;
}
export function ownsSession(event, sessionId) { return Boolean(sessionId) && event?.sessionId === sessionId; }



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

export async function startVoiceSession(adapter, controller, sessionId) {
  await adapter.toggle('on');
  controller.start(sessionId);
}

export async function stopVoiceSession(adapter, controller) {
  controller.stop();
  await adapter.toggle('off');
}


const ID = 'hermes-live-voice'
const RUNTIME_KEY = '__hermes_live_voice_runtime__'
function Pane({ state, toggle }) { const value = useValue(state); return jsxs('div', { className: 'flex h-full flex-col gap-2 p-3 text-sm', children: [jsx('div', { className: 'font-medium', children: 'Hermes Live Voice' }), jsx('div', { className: 'text-(--ui-text-tertiary)', children: `phase: ${value.phase}` }), jsx('div', { className: 'text-(--ui-text-tertiary)', children: value.accepted ? `accepted: ${value.accepted}` : 'accepted: —' }), jsx('div', { className: 'text-(--ui-text-tertiary)', children: value.rejection ? `rejected: ${value.rejection}` : 'rejection: —' }), jsxs('div', { className: 'flex gap-2', children: [jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => toggle('on'), children: 'Start' }), jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => toggle('off'), children: 'Stop' })] })] }) }
function Chip({ state, toggle }) { const value = useValue(state); return jsx('button', { type: 'button', className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)', onClick: () => toggle(value.phase === 'off' ? 'on' : 'off'), children: `voice:${value.phase}` }) }

export default { id: ID, name: 'Hermes Live Voice', defaultEnabled: true, register(ctx) {
  globalThis[RUNTIME_KEY]?.dispose?.()
  const state = atom({ phase: 'off', accepted: '', rejection: '' }), adapter = createHermesAdapter(host)
  const update = next => state.set({ phase: next.phase, accepted: next.accepted ?? '', rejection: next.rejection ?? '' })
  let controller
  const bridge = createVoiceBridge(adapter, { onStatus: update, onError: (error, label) => { const message = `${label} failed: ${error?.message ?? error}`; update({ phase: controller?.phase ?? 'off', rejection: message }); host.notify({ kind: 'warning', message }) } })
  controller = bridge.controller
  const toggle = action => { const sid = adapter.getSessionId(); if (action === 'on' && !sid) return host.notify({ kind: 'warning', message: 'Select a Hermes session first.' }); const operation = action === 'on' ? bridge.start(sid) : bridge.stop(); return operation.catch(error => { const message = `voice.toggle ${action} failed: ${error?.message ?? error}`; update({ phase: controller.phase, rejection: message }); host.notify({ kind: 'warning', message }) }) }
  const runtime = { dispose: () => { void bridge.dispose().catch(error => host.notify({ kind: 'warning', message: `voice.toggle off failed: ${error?.message ?? error}` })); if (globalThis[RUNTIME_KEY] === runtime) delete globalThis[RUNTIME_KEY] } }
  globalThis[RUNTIME_KEY] = runtime
  ctx.register({ id: 'pane', area: 'panes', title: 'live voice', data: { placement: 'right', width: '260px' }, render: () => jsx(Pane, { state, toggle }) })
  ctx.register({ id: 'status', area: 'statusBar.right', order: 120, render: () => jsx(Chip, { state, toggle }) })
} }
