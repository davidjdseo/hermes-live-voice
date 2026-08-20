#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createAlwaysOn } from './alwayson/runtime.js'
import { createPromptAdapter } from './adapters/prompt.js'
import { ERROR_CODES } from './alwayson/engines.js'

function usage() {
  console.log(`live-voice-agent — spoken loop for any agent backend

Usage:
  npx live-voice-agent demo

Type a line, get a spoken-style reply. No microphone, no API keys.
Swap createPromptAdapter({ ask }) for Hermes, Paseo, Codex, Claude Code,
or Orca when that harness exposes the six adapter methods.`)
}

function pending() {
  const bag = []
  let waiter = null
  return {
    push(value) {
      if (waiter) {
        const resolve = waiter
        waiter = null
        resolve({ value, done: false })
      } else bag.push(value)
    },
    end() {
      waiter?.({ value: undefined, done: true })
      waiter = null
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (bag.length) return Promise.resolve({ value: bag.shift(), done: false })
            return new Promise(resolve => { waiter = resolve })
          },
          return: async () => {
            waiter?.({ value: undefined, done: true })
            waiter = null
            return { value: undefined, done: true }
          },
        }
      },
    },
  }
}

function createDemoEngines({ log }) {
  const source = pending()
  const wake = pending()
  const vad = pending()
  let nextUtterance = 'hello'

  return {
    source: {
      async start() { log('ready (typed input)') },
      async stop() { source.end(); wake.end(); vad.end() },
      stream() { return source.iterable },
    },
    wakeword: { detect() { return wake.iterable } },
    vad: { detect() { return vad.iterable } },
    stt: {
      transcribe() {
        const text = nextUtterance
        return (async function* () { yield { type: 'final', text } })()
      },
    },
    tts: {
      async *speak(text) {
        const parts = []
        if (typeof text === 'string') parts.push(text)
        else for await (const part of text) parts.push(part)
        const spoken = parts.join(' ').trim()
        if (spoken) log(`TTS: ${spoken}`)
        yield { type: 'done' }
      },
      async interrupt() { log('TTS interrupted') },
    },
    say(text) {
      nextUtterance = text
      wake.push({ keyword: 'hey', score: 1, ts: Date.now() })
    },
  }
}

async function demo() {
  const log = message => console.log(message)
  const engines = createDemoEngines({ log })
  const backend = createPromptAdapter({
    sessionId: 'demo',
    ask: async text => `들었어. ${text}`,
  })
  const assistant = createAlwaysOn({
    engines,
    backend,
    maxUtteranceMs: 8000,
    preRollMs: 10,
    sampleRate: 16000,
  })
  assistant.on('wake', () => log('[wake]'))
  assistant.on('utterance', text => log(`you: ${text}`))
  assistant.on('interrupted', () => log('[interrupted]'))
  assistant.on('error', error => {
    if (error.code === ERROR_CODES.UTTERANCE_TIMEOUT) return
    log(`[error] ${error.code} ${error.message}`)
  })

  await assistant.start()
  log('Live Voice Agent demo. Type a line, Enter. /quit to exit.')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', line => {
    const text = String(line ?? '').trim()
    if (!text) return
    if (text === '/quit' || text === '/exit') {
      rl.close()
      return
    }
    engines.say(text)
  })
  rl.on('close', async () => {
    await assistant.stop()
    process.exit(0)
  })
}

const command = process.argv[2]
if (!command || command === '-h' || command === '--help') usage()
else if (command === 'demo') await demo()
else {
  usage()
  process.exit(1)
}
