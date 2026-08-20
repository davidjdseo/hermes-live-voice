import test from 'node:test'
import assert from 'node:assert/strict'
import { createPromptAdapter } from '../src/adapters/prompt.js'
import { createVoiceBridge } from '../src/bridge.js'
import {
  createPaseoAdapter,
  createCodexAdapter,
  createClaudeCodeAdapter,
  createOrcaAdapter,
} from '../src/adapters/generic.js'

const settle = () => new Promise(resolve => setImmediate(resolve))

test('prompt adapter turns ask() into a spoken VoiceCore turn', async () => {
  const spoken = []
  const adapter = createPromptAdapter({
    sessionId: 'live',
    ask: async text => `ok ${text}`,
    speak: text => spoken.push(text),
  })
  const bridge = createVoiceBridge(adapter)
  await bridge.start('live')
  adapter.submit({ session_id: 'live', text: '날씨 어때' })
  await settle()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(spoken, ['ok 날씨 어때'])
  await bridge.stop()
})

test('planned adapters refuse to pretend they have a voice seam', () => {
  for (const factory of [createPaseoAdapter, createCodexAdapter, createClaudeCodeAdapter, createOrcaAdapter]) {
    const adapter = factory()
    assert.equal(adapter.getSessionId(), null)
    assert.throws(() => adapter.toggle('on'), /planned/)
  }
})
