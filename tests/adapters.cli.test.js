import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrainAsk, createAgentBackend } from '../src/adapters/cli-agents.js'

test('echo brain repeats the spoken command', async () => {
  const ask = createBrainAsk('echo')
  assert.equal(await ask('창문 열어'), '들었어. 창문 열어')
})

test('unknown brain fails fast instead of pretending', () => {
  assert.throws(() => createBrainAsk('not-a-brain'), /Unknown brain/)
})

test('agent backend is a six-method adapter', () => {
  const backend = createAgentBackend({ brain: 'echo' })
  assert.equal(backend.getSessionId(), 'live')
  assert.equal(typeof backend.submit, 'function')
  assert.equal(typeof backend.subscribe, 'function')
})
