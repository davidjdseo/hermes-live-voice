/* hermes-live-voice generated desktop plugin; do not edit desktop/plugin.js directly. */
import { atom, Button, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
/* CORE_START */
/* CORE_END */
/* ADAPTER_START */
/* ADAPTER_END */
/* RUNTIME_START */
/* RUNTIME_END */

const ID = 'hermes-live-voice'
const RUNTIME_KEY = '__hermes_live_voice_runtime__'
function Pane({ state, toggle }) { const value = useValue(state); return jsxs('div', { className: 'flex h-full flex-col gap-2 p-3 text-sm', children: [jsx('div', { className: 'font-medium', children: 'Hermes Live Voice' }), jsx('div', { className: 'text-(--ui-text-tertiary)', children: `phase: ${value.phase}` }), jsx('div', { className: 'text-(--ui-text-tertiary)', children: value.accepted ? `accepted: ${value.accepted}` : 'accepted: —' }), jsx('div', { className: 'text-(--ui-text-tertiary)', children: value.rejection ? `rejected: ${value.rejection}` : 'rejection: —' }), jsxs('div', { className: 'flex gap-2', children: [jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => toggle('on'), children: 'Start' }), jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => toggle('off'), children: 'Stop' })] })] }) }
function Chip({ state, toggle }) { const value = useValue(state); return jsx('button', { type: 'button', className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)', onClick: () => toggle(value.phase === 'off' ? 'on' : 'off'), children: `voice:${value.phase}` }) }

export default { id: ID, name: 'Hermes Live Voice', defaultEnabled: true, register(ctx) {
  globalThis[RUNTIME_KEY]?.dispose?.()
  const state = atom({ phase: 'off', accepted: '', rejection: '' }), listeners = [], adapter = createHermesAdapter(host)
  const update = next => state.set({ phase: next.phase, accepted: next.accepted ?? '', rejection: next.rejection ?? '' })
  const safe = (operation, label) => Promise.resolve().then(operation).catch(error => { const message = `${label} failed: ${error?.message ?? error}`; update({ phase: controller?.phase ?? 'off', rejection: message }); host.notify({ kind: 'warning', message }); })
  const controller = new VoiceCore({ onRecord: (action, sid) => void safe(() => adapter.record(action, sid), `voice.record ${action}`), onSpeak: text => void safe(() => adapter.speak(text), 'voice.tts'), onSubmit: payload => void safe(() => adapter.submit(payload), 'prompt.submit'), onStatus: update })
  const bind = (name, handler) => listeners.push(adapter.subscribe(name, item => { if (ownsSession(item, controller.sessionId)) handler(item) }))
  bind('voice.transcript', ({ sessionId, payload }) => controller.acceptTranscript(sessionId, payload.text ?? ''))
  bind('voice.status', ({ sessionId, payload }) => controller.voiceStatus(sessionId, payload.state))
  bind('wake.detected', ({ sessionId }) => controller.wake(sessionId))
  bind('message.start', ({ sessionId, payload }) => controller.messageStart(sessionId, payload))
  bind('message.delta', ({ sessionId, payload }) => controller.messageDelta(sessionId, payload.delta ?? payload.text ?? ''))
  bind('message.interim', ({ sessionId, payload }) => controller.messageInterim(sessionId, payload.text ?? payload.interim ?? ''))
  bind('message.complete', ({ sessionId, payload }) => controller.messageComplete(sessionId, payload))
  bind('voice.interrupted', ({ sessionId, payload }) => { const text = payload.text ?? payload.transcript ?? ''; if (text) controller.acceptTranscript(sessionId, text) })
  const toggle = action => { const sid = adapter.getSessionId(); if (action === 'on' && !sid) return host.notify({ kind: 'warning', message: 'Select a Hermes session first.' }); if (action === 'on') return startVoiceSession(adapter, controller, sid).catch(error => { update({ phase: controller.phase, rejection: `voice.toggle on failed: ${error?.message ?? error}` }); host.notify({ kind: 'warning', message: `voice.toggle on failed: ${error?.message ?? error}` }) }); return stopVoiceSession(adapter, controller).catch(error => { update({ phase: controller.phase, rejection: `voice.toggle off failed: ${error?.message ?? error}` }); host.notify({ kind: 'warning', message: `voice.toggle off failed: ${error?.message ?? error}` }) }) }
  const runtime = { dispose: () => { listeners.splice(0).forEach(dispose => dispose?.()); controller.dispose(); void Promise.resolve().then(() => adapter.toggle('off')).catch(error => host.notify({ kind: 'warning', message: `voice.toggle off failed: ${error?.message ?? error}` })); if (globalThis[RUNTIME_KEY] === runtime) delete globalThis[RUNTIME_KEY] } }
  globalThis[RUNTIME_KEY] = runtime
  ctx.register({ id: 'pane', area: 'panes', title: 'live voice', data: { placement: 'right', width: '260px' }, render: () => jsx(Pane, { state, toggle }) })
  ctx.register({ id: 'status', area: 'statusBar.right', order: 120, render: () => jsx(Chip, { state, toggle }) })
} }
