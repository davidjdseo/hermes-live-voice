import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrainAsk, createAgentBackend, BRAINS, orcaPromptArgs } from '../src/adapters/cli-agents.js'
import { chatCompletions } from '../src/protocols/openai.js'
import { createA2AAgentCard } from '../src/protocols/a2a.js'
import { spokenTurnToAgUiEvents } from '../src/protocols/agui.js'

test('echo brain repeats the spoken command', async () => {
  const ask = createBrainAsk('echo')
  assert.equal(await ask('창문 열어'), '들었어. 창문 열어')
})

test('unknown brain fails fast instead of pretending', () => {
  assert.throws(() => createBrainAsk('not-a-brain'), /Unknown brain/)
  assert.ok(BRAINS.includes('opencode'))
  assert.ok(BRAINS.includes('orca'))
})

test('agent backend is a six-method adapter', () => {
  const backend = createAgentBackend({ brain: 'echo' })
  assert.equal(backend.getSessionId(), 'live')
  assert.equal(typeof backend.submit, 'function')
  assert.equal(typeof backend.subscribe, 'function')
})

test('orca prompt uses public terminal send or worktree create', () => {
  assert.deepEqual(
    orcaPromptArgs({ text: 'hello', terminal: 'term-1' }),
    ['terminal', 'send', '--terminal', 'term-1', '--text', 'hello', '--enter'],
  )
  const created = orcaPromptArgs({ text: 'hello', agent: 'codex', name: 'live-voice' })
  assert.equal(created[0], 'worktree')
  assert.ok(created.includes('--prompt'))
})

test('openai compatible chat completions posts the official body', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }
  }
  const text = await chatCompletions({
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'test-key',
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl,
  })
  assert.equal(text, 'ok')
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(JSON.parse(calls[0].init.body).messages[0].content, 'hi')
})

test('A2A card and AG-UI events are protocol-shaped helpers', () => {
  const card = createA2AAgentCard()
  assert.equal(card.name, 'live-voice-agent')
  assert.ok(card.skills[0].id)
  const events = spokenTurnToAgUiEvents({ messageId: 'm1', text: '안녕' })
  assert.equal(events[0].type, 'TEXT_MESSAGE_START')
  assert.equal(events[1].delta, '안녕')
  assert.equal(events[2].type, 'TEXT_MESSAGE_END')
})
