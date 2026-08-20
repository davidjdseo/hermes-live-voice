import { spawn } from 'node:child_process'
import { ERROR_CODES } from './engines.js'
import { createSttEngine, createSilenceStt } from './stt.js'

function pendingQueue() {
  const items = []
  const waiters = []
  let ended = false
  const wake = result => {
    const waiter = waiters.shift()
    if (waiter) waiter(result)
  }
  return {
    push(value) {
      if (ended) return
      if (waiters.length) wake({ value, done: false })
      else items.push(value)
    },
    end() {
      if (ended) return
      ended = true
      while (waiters.length) wake({ value: undefined, done: true })
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (items.length) return Promise.resolve({ value: items.shift(), done: false })
            if (ended) return Promise.resolve({ value: undefined, done: true })
            return new Promise(resolve => waiters.push(resolve))
          },
          return: async () => {
            ended = true
            while (waiters.length) wake({ value: undefined, done: true })
            return { value: undefined, done: true }
          },
        }
      },
    },
  }
}

function rms(pcm) {
  if (!pcm?.length) return 0
  let sum = 0
  for (const sample of pcm) sum += sample * sample
  return Math.sqrt(sum / pcm.length) / 32768
}

function avfoundationInput(device) {
  if (/^\d+$/.test(String(device))) return `:${device}`
  return ':0'
}

export function createMicSource({
  sampleRate = 16000,
  frameMs = 20,
  device = process.env.LIVE_VOICE_MIC || '0',
} = {}) {
  const queue = pendingQueue()
  let child = null
  const samplesPerFrame = Math.max(1, Math.round(sampleRate * frameMs / 1000))
  const bytesPerFrame = samplesPerFrame * 2

  return {
    async start() {
      if (child) return
      child = spawn('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'avfoundation',
        '-i', avfoundationInput(device),
        '-ac', '1', '-ar', String(sampleRate),
        '-f', 's16le', '-acodec', 'pcm_s16le',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      let leftover = Buffer.alloc(0)
      child.stdout.on('data', chunk => {
        leftover = Buffer.concat([leftover, chunk])
        while (leftover.length >= bytesPerFrame) {
          const frame = leftover.subarray(0, bytesPerFrame)
          leftover = leftover.subarray(bytesPerFrame)
          const pcm = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2)
          queue.push({ pcm: new Int16Array(pcm), sampleRate, ts: Date.now() })
        }
      })
      child.stderr.on('data', () => {})
      child.once('exit', (code, signal) => {
        queue.end()
        child = null
        if (code && code !== 0 && signal !== 'SIGTERM') {
          const error = Object.assign(new Error('Microphone capture ended'), { code: ERROR_CODES.DEVICE_LOST, exitCode: code, signal })
          queue.error = error
        }
      })
    },
    async stop() {
      if (!child) {
        queue.end()
        return
      }
      const current = child
      child = null
      try { current.kill('SIGTERM') } catch {}
      queue.end()
    },
    stream() {
      return queue.iterable
    },
  }
}

export function createEnergyVad({
  speechRms = 0.018,
  silenceRms = 0.008,
  minSpeechMs = 180,
  minSilenceMs = 400,
} = {}) {
  return {
    detect(audio) {
      return (async function* () {
        let speaking = false
        let speechMs = 0
        let silenceMs = 0
        for await (const chunk of audio) {
          const duration = (chunk.pcm?.length ?? 0) * 1000 / (chunk.sampleRate || 16000)
          const level = rms(chunk.pcm)
          if (!speaking) {
            if (level >= speechRms) {
              speechMs += duration
              if (speechMs >= minSpeechMs) {
                speaking = true
                silenceMs = 0
                yield { type: 'speech_start', ts: chunk.ts, confidence: Math.min(1, level / 0.1) }
              }
            } else speechMs = 0
          } else if (level < silenceRms) {
            silenceMs += duration
            if (silenceMs >= minSilenceMs) {
              speaking = false
              speechMs = 0
              yield { type: 'speech_end', ts: chunk.ts }
            }
          } else silenceMs = 0
        }
      })()
    },
  }
}

export function createPushToTalkWake({ keyword = 'hey jarvis' } = {}) {
  const queue = pendingQueue()
  return {
    detect() {
      return queue.iterable
    },
    trigger(extra = {}) {
      queue.push({ keyword, score: 1, ts: Date.now(), ...extra })
    },
    close() {
      queue.end()
    },
  }
}

export function createAlwaysListenWake() {
  let started = false
  return {
    detect(audio) {
      return (async function* () {
        if (started) {
          for await (const _ of audio) { /* keep the tee consumer alive */ }
          return
        }
        started = true
        yield { keyword: 'hey jarvis', score: 1, ts: Date.now() }
        for await (const _ of audio) { /* keep consuming so the distributor does not stall */ }
      })()
    },
  }
}

export function createSayTts({ voice = process.env.LIVE_VOICE_VOICE || 'Yuna' } = {}) {
  let child = null
  return {
    async *speak(text) {
      const parts = []
      if (typeof text === 'string') parts.push(text)
      else for await (const part of text) parts.push(part)
      const spoken = parts.join(' ').trim()
      if (!spoken) {
        yield { type: 'done' }
        return
      }
      yield { type: 'started', text: spoken }
      await new Promise((resolve, reject) => {
        child = spawn('say', ['-v', voice, spoken], { stdio: 'ignore' })
        child.once('exit', code => {
          child = null
          code ? reject(Object.assign(new Error('say failed'), { code })) : resolve()
        })
        child.once('error', reject)
      })
      yield { type: 'done' }
    },
    async interrupt() {
      if (child) {
        try { child.kill('SIGTERM') } catch {}
        child = null
      }
    },
  }
}

export function createLocalEngines(options = {}) {
  const wake = options.pushToTalk === false
    ? createAlwaysListenWake()
    : createPushToTalkWake({ keyword: options.keyword })
  return {
    source: createMicSource(options),
    wakeword: wake,
    vad: createEnergyVad(options),
    stt: createSttEngine(options.stt || process.env.LIVE_VOICE_STT, options),
    tts: createSayTts(options),
    triggerWake: extra => wake.trigger?.(extra),
  }
}

export { createSilenceStt }
