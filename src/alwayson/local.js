import { spawn, spawnSync } from 'node:child_process'
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
  readyMs = 2500,
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
        '-thread_queue_size', '512',
        '-i', avfoundationInput(device),
        '-ac', '1', '-ar', String(sampleRate),
        '-f', 's16le', '-acodec', 'pcm_s16le',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      let leftover = Buffer.alloc(0)
      let firstChunk
      const ready = new Promise((resolve, reject) => {
        firstChunk = resolve
        child.once('error', reject)
      })
      child.stdout.on('data', chunk => {
        leftover = Buffer.concat([leftover, chunk])
        while (leftover.length >= bytesPerFrame) {
          const frame = leftover.subarray(0, bytesPerFrame)
          leftover = leftover.subarray(bytesPerFrame)
          const pcm = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2)
          queue.push({ pcm: new Int16Array(pcm), sampleRate, ts: Date.now() })
        }
        firstChunk?.()
        firstChunk = null
      })
      const errChunks = []
      child.stderr.on('data', data => errChunks.push(data))
      child.once('exit', (code, signal) => {
        queue.end()
        child = null
        if (code && code !== 0 && signal !== 'SIGTERM') {
          const detail = Buffer.concat(errChunks).toString('utf8').trim()
          const error = Object.assign(new Error(detail || 'Microphone capture ended'), { code: ERROR_CODES.DEVICE_LOST, exitCode: code, signal })
          queue.error = error
        }
      })
      let timer
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error('Microphone did not produce audio. Grant ffmpeg/Terminal microphone permission, then retry.'), { code: ERROR_CODES.MIC_DENIED }))
        }, readyMs)
      })
      try {
        await Promise.race([ready, timeout])
      } finally {
        clearTimeout(timer)
      }
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
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 400)
        current.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      try { current.kill('SIGKILL') } catch {}
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

export function createAlwaysListenWake({
  keyword = 'hey jarvis',
  speechRms = 0.02,
  minSpeechMs = 220,
} = {}) {
  return {
    detect(audio) {
      return (async function* () {
        let speechMs = 0
        let last = 0
        for await (const chunk of audio) {
          const duration = (chunk.pcm?.length ?? 0) * 1000 / (chunk.sampleRate || 16000)
          const level = rms(chunk.pcm)
          if (level >= speechRms) speechMs += duration
          else speechMs = 0
          if (speechMs >= minSpeechMs && Date.now() - last > 1500) {
            last = Date.now()
            speechMs = 0
            yield { keyword, score: Math.min(1, level / 0.1), ts: chunk.ts }
          }
        }
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

export function listAvfoundationAudioDevices() {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' })
  const text = `${result.stdout || ''}\n${result.stderr || ''}`
  const audio = []
  let inAudio = false
  for (const line of text.split(/\r?\n/)) {
    if (/AVFoundation audio devices/i.test(line)) {
      inAudio = true
      continue
    }
    if (/AVFoundation video devices/i.test(line)) {
      inAudio = false
      continue
    }
    const match = inAudio && line.match(/\[(\d+)\]\s+(.+)$/)
    if (match) audio.push({ index: match[1], name: match[2].trim() })
  }
  return audio
}

export async function probeMicrophone({ device = process.env.LIVE_VOICE_MIC || '0', frames = 8 } = {}) {
  const source = createMicSource({ device, readyMs: 2500 })
  const started = Date.now()
  await source.start()
  let count = 0
  let peak = 0
  for await (const chunk of source.stream()) {
    count++
    const level = rms(chunk.pcm)
    if (level > peak) peak = level
    if (count >= frames) break
  }
  await source.stop()
  return { ok: count > 0, frames: count, peak, ms: Date.now() - started, device }
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
