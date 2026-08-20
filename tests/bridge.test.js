import test from 'node:test'
import assert from 'node:assert/strict'
import { BRIDGE_EVENTS, createVoiceBridge } from '../src/bridge.js'

class FakeScheduler {
  constructor() { this.jobs = new Map(); this.next = 1 }
  setTimeout(fn, ms) { const id = this.next++; this.jobs.set(id, { fn, ms }); return id }
  clearTimeout(id) { this.jobs.delete(id) }
}

class FakeAdapter {
  constructor() { this.calls = []; this.handlers = new Map(); this.disposed = 0 }
  getSessionId() { return 's1' }
  async toggle(action) { this.calls.push(`toggle:${action}`); if (action === 'on') { await Promise.resolve(); this.calls.push('toggle:ready') } }
  record(action, sessionId) { this.calls.push(`record:${action}:${sessionId}`) }
  speak(text) { this.calls.push(`speak:${text}`) }
  submit(payload) { this.calls.push(['submit', payload]) }
  subscribe(type, handler) { this.handlers.set(type, handler); return () => { this.disposed++; this.handlers.delete(type) } }
  emit(type, sessionId, payload = {}) { return this.handlers.get(type)?.({ type, sessionId, payload }) }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('bridge owns lifecycle, dispatches normalized events, and rejects cross-session work', async () => {
  const adapter = new FakeAdapter()
  const bridge = createVoiceBridge(adapter, { scheduler: new FakeScheduler() })
  assert.deepEqual([...adapter.handlers.keys()], BRIDGE_EVENTS)

  await bridge.start('s1')
  await settle()
  assert.deepEqual(adapter.calls.slice(0, 3), ['toggle:on', 'toggle:ready', 'record:start:s1'])

  adapter.emit('voice.status', 's2', { state: 'idle' })
  adapter.emit('message.start', 's2', { id: 'wrong' })
  adapter.emit('message.complete', 's2', { id: 'wrong', text: '<<<VOICE 잘못된 세션 VOICE>>>' })
  adapter.emit('message.start', 's1', { id: 'turn-1' })
  adapter.emit('message.delta', 's1', { delta: '<<<VOICE ' })
  adapter.emit('message.interim', 's1', { interim: '정상 응답' })
  adapter.emit('message.delta', 's1', { delta: ' VOICE>>>' })
  adapter.emit('message.complete', 's1', { id: 'turn-1' })
  await settle()
  assert.ok(adapter.calls.includes('speak:정상 응답'))
  assert.equal(adapter.calls.some(call => String(call).includes('잘못된 세션')), false)

  adapter.emit('voice.interrupted', 's2', { transcript: '다른 세션 명령' })
  adapter.emit('voice.interrupted', 's1', { transcript: '중단하고 저장해' })
  await settle()
  assert.deepEqual(adapter.calls.filter(call => Array.isArray(call) && call[0] === 'submit'), [['submit', { session_id: 's1', text: '중단하고 저장해', interrupted: true }]])

  await bridge.stop()
  const recordStop = adapter.calls.indexOf('record:stop:s1')
  const toggleOff = adapter.calls.indexOf('toggle:off')
  assert.ok(recordStop >= 0)
  assert.ok(toggleOff >= 0)
  assert.ok(recordStop < toggleOff)
  await bridge.start('s2')
  await settle()
  await bridge.dispose()
  assert.equal(adapter.disposed, BRIDGE_EVENTS.length)
  const submits = adapter.calls.filter(call => Array.isArray(call) && call[0] === 'submit')
  adapter.emit('voice.transcript', 's1', { text: '늦은 세션 명령' })
  adapter.emit('voice.transcript', 's2', { text: '현재 세션 명령' })
  await settle()
  assert.deepEqual(adapter.calls.filter(call => Array.isArray(call) && call[0] === 'submit'), submits)
  assert.equal(adapter.calls.filter(call => call === 'toggle:off').length, 2)
})
