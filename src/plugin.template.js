/* hermes-live-voice generated desktop plugin; do not edit desktop/plugin.js directly. */
import { atom, Button, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
/* CORE_START */
/* CORE_END */
/* ADAPTER_START */
/* ADAPTER_END */
/* BRIDGE_START */
/* BRIDGE_END */
/* RUNTIME_START */
/* RUNTIME_END */

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
