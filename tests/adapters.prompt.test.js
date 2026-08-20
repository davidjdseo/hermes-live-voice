import test from 'node:test'
import assert from 'node:assert/strict'
import { createPromptAdapter } from '../src/adapters/prompt.js'
import { createVoiceBridge } from '../src/bridge.js'
import {
  createPaseoAdapter,
  createCodexAdapter,
  createClaudeCodeAdapter,
  createOrcaAdapter,
  createOpenCodeAdapter,
  createGeminiAdapter,
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
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(spoken, ['ok 날씨 어때'])
  await bridge.stop()
})

test('coding CLI adapters are prompt backends', () => {
  const ask = async text => text
  assert.equal(createCodexAdapter({ ask }).getSessionId(), 'codex')
  assert.equal(createClaudeCodeAdapter({ ask }).getSessionId(), 'claude')
  assert.equal(createOpenCodeAdapter({ ask }).getSessionId(), 'opencode')
  assert.equal(createGeminiAdapter({ ask }).getSessionId(), 'gemini')
  assert.equal(createPaseoAdapter({ ask, agentId: 'abc' }).getSessionId(), 'abc')
  assert.equal(createOrcaAdapter({ ask }).getSessionId(), 'orca')
})
