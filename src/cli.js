#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { spawnSync } from 'node:child_process'
import { createAlwaysOn } from './alwayson/runtime.js'
import { createLocalEngines, listAvfoundationAudioDevices, probeMicrophone } from './alwayson/local.js'
import { createAgentBackend } from './adapters/cli-agents.js'
import { ERROR_CODES } from './alwayson/engines.js'

function usage() {
  console.log(`live-voice-agent — always-on spoken assistant. Wake: 헤이 자비스

Usage:
  npx live-voice-agent demo
  npx live-voice-agent live [--brain echo|codex|claude|opencode|gemini|paseo|openai|openrouter|orca]
  npx live-voice-agent live --stt voicebox|whisper-cli|openai|groq|elevenlabs|deepgram
  npx live-voice-agent live --daemon
  npx live-voice-agent doctor

demo   typed loop, no microphone
live   microphone + macOS say. Enter also triggers a turn.
doctor checks ffmpeg, say, node, Voicebox, and optional agent CLIs

Wake phrases: 헤이 자비스, 헤이 자스비, hey jarvis
Hermes is one optional adapter, not the product.`)
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
      wake.push({ keyword: 'hey jarvis', score: 1, ts: Date.now() })
    },
  }
}

function parseFlag(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index >= 0) return argv[index + 1] ?? fallback
  return fallback
}

function which(bin) {
  const result = spawnSync('which', [bin], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

async function attachAssistant(assistant, log) {
  assistant.on('wake', event => log(`[wake] ${event?.keyword ?? 'hey jarvis'}`))
  assistant.on('utterance', text => log(`you: ${text}`))
  assistant.on('interrupted', () => log('[interrupted]'))
  assistant.on('error', error => {
    if (error.code === ERROR_CODES.UTTERANCE_TIMEOUT) return
    log(`[error] ${error.code} ${error.message}`)
  })
}

async function demo(argv) {
  const log = message => console.log(message)
  const brain = parseFlag(argv, '--brain', 'echo')
  const engines = createDemoEngines({ log })
  const backend = createAgentBackend({ brain, agentId: parseFlag(argv, '--agent') })
  const assistant = createAlwaysOn({ engines, backend, maxUtteranceMs: 8000, preRollMs: 10, sampleRate: 16000 })
  await attachAssistant(assistant, log)
  await assistant.start()
  log('Live Voice Agent demo. Type a line, Enter. Wake is 헤이 자비스. /quit to exit.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', line => {
    const text = String(line ?? '').trim()
    if (!text) return
    if (text === '/quit' || text === '/exit') {
      rl.close()
      return
    }
    engines.say(text.startsWith('헤이') || /^hey /i.test(text) ? text : `헤이 자비스 ${text}`)
  })
  rl.on('close', async () => {
    await assistant.stop()
    process.exit(0)
  })
}

async function live(argv) {
  const log = message => console.log(message)
  const brain = parseFlag(argv, '--brain', 'echo')
  const stt = parseFlag(argv, '--stt', process.env.LIVE_VOICE_STT || 'voicebox')
  const daemon = argv.includes('--daemon') || process.env.LIVE_VOICE_DAEMON === '1'
  const alwaysListen = daemon || argv.includes('--always-listen')
  const engines = createLocalEngines({
    keyword: 'hey jarvis',
    stt,
    pushToTalk: alwaysListen ? false : true,
  })
  const backend = createAgentBackend({ brain, agentId: parseFlag(argv, '--agent') })
  const assistant = createAlwaysOn({ engines, backend, maxUtteranceMs: 12000, preRollMs: 1500, sampleRate: 16000 })
  assistant.on('error', error => log(`[error] ${error.code || ''} ${error.message}`))
  assistant.on('phase', phase => log(`[phase] ${phase}`))
  await attachAssistant(assistant, log)
  log('Starting microphone capture. If this hangs, grant Terminal/ffmpeg microphone permission, then retry.')
  await assistant.start()
  log(`Jarvis is listening. STT=${stt} brain=${brain}${daemon ? ' daemon' : ''}. Say 헤이 자비스${alwaysListen ? '.' : ', or press Enter to push-to-talk. /quit to exit.'}`)
  if (daemon) {
    const shutdown = async () => {
      await assistant.stop().catch(() => {})
      process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', line => {
    const text = String(line ?? '').trim()
    if (text === '/quit' || text === '/exit') {
      rl.close()
      return
    }
    engines.triggerWake?.({ keyword: 'hey jarvis' })
    log('[ptt] listening')
  })
  rl.on('close', async () => {
    await assistant.stop()
    process.exit(0)
  })
}

async function doctor() {
  const rows = [
    ['node', process.version],
    ['ffmpeg', which('ffmpeg') || 'MISSING — needed for live mic'],
    ['say', which('say') || 'MISSING — macOS TTS'],
    ['codex', which('codex') || 'optional'],
    ['claude', which('claude') || 'optional'],
    ['opencode', which('opencode') || 'optional'],
    ['gemini', which('gemini') || 'optional'],
    ['paseo', which('paseo') || 'optional'],
    ['orca', which('orca') || 'optional'],
    ['whisper', which('whisper-cli') || which('whisper') || 'optional local STT'],
  ]
  for (const [name, value] of rows) console.log(`${name.padEnd(8)} ${value}`)
  const voiceboxUrl = process.env.LIVE_VOICE_VOICEBOX_URL || 'http://127.0.0.1:17493'
  let voicebox = 'down'
  try {
    const result = spawnSync('curl', ['-sS', '-m', '2', `${voiceboxUrl}/health`], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.includes('"healthy"')) voicebox = `up ${voiceboxUrl}`
    else voicebox = `not healthy ${voiceboxUrl}`
  } catch {
    voicebox = `unreachable ${voiceboxUrl}`
  }
  console.log(`${'voicebox'.padEnd(8)} ${voicebox}`)
  const devices = listAvfoundationAudioDevices()
  if (devices.length) {
    console.log('mics')
    for (const device of devices) console.log(`  [${device.index}] ${device.name}`)
  } else console.log(`${'mics'.padEnd(8)} none listed`)
  if (!which('ffmpeg')) {
    process.exitCode = 1
    return
  }
  try {
    const probe = await probeMicrophone({ frames: 8 })
    console.log(`${'mic'.padEnd(8)} ${probe.ok ? 'ok' : 'silent'} frames=${probe.frames} peak=${probe.peak.toFixed(3)} ${probe.ms}ms`)
    if (!probe.ok) process.exitCode = 1
  } catch (error) {
    console.log(`${'mic'.padEnd(8)} FAIL ${error.message}`)
    process.exitCode = 1
  }
}

const command = process.argv[2]
const argv = process.argv.slice(2)
if (!command || command === '-h' || command === '--help') usage()
else if (command === 'demo') await demo(argv)
else if (command === 'live') await live(argv)
else if (command === 'doctor') await doctor()
else {
  usage()
  process.exit(1)
}
