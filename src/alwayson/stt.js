import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const STT_ENGINES = Object.freeze([
  'silence',
  'whisper-cli',
  'openai',
  'groq',
  'voicebox',
  'elevenlabs',
  'deepgram',
])

function rms(pcm) {
  if (!pcm?.length) return 0
  let sum = 0
  for (const sample of pcm) sum += sample * sample
  return Math.sqrt(sum / pcm.length) / 32768
}

export function createSilenceStt({
  minSpeechMs = 250,
  endSilenceMs = 700,
  speechRms = 0.018,
} = {}) {
  return {
    transcribe(audio) {
      return (async function* () {
        let started = false
        let speechMs = 0
        let silenceMs = 0
        let frames = 0
        for await (const chunk of audio) {
          frames++
          const duration = (chunk.pcm?.length ?? 0) * 1000 / (chunk.sampleRate || 16000)
          const level = rms(chunk.pcm)
          if (level >= speechRms) {
            started = true
            speechMs += duration
            silenceMs = 0
          } else if (started) {
            silenceMs += duration
            if (silenceMs >= endSilenceMs && speechMs >= minSpeechMs) {
              yield { type: 'final', text: '말했어', confidence: 0.4, frames }
              return
            }
          }
        }
        if (started && speechMs >= minSpeechMs) yield { type: 'final', text: '말했어', confidence: 0.3, frames }
      })()
    },
  }
}

export function wavFromPcm(chunks, sampleRate = 16000) {
  const pcm = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.pcm.buffer, chunk.pcm.byteOffset, chunk.pcm.byteLength)))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function collectPcm(audio) {
  const chunks = []
  let sampleRate = 16000
  for await (const chunk of audio) {
    if (chunk?.pcm) chunks.push(chunk)
    if (chunk?.sampleRate) sampleRate = chunk.sampleRate
  }
  return { chunks, sampleRate }
}

export function parseWhisperOutput(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .at(-1) || ''
}

function languageOf(opts, fallback = process.env.LIVE_VOICE_LANGUAGE || 'ko') {
  return opts.language || fallback
}

export function createWhisperCliStt({
  command = process.env.LIVE_VOICE_WHISPER || 'whisper-cli',
  model = process.env.LIVE_VOICE_WHISPER_MODEL,
  spawnImpl = spawn,
} = {}) {
  return {
    transcribe(audio, opts = {}) {
      return (async function* () {
        const { chunks, sampleRate } = await collectPcm(audio)
        if (!chunks.length) return
        const dir = await mkdtemp(join(tmpdir(), 'live-voice-stt-'))
        const wav = join(dir, 'utterance.wav')
        try {
          await writeFile(wav, wavFromPcm(chunks, sampleRate))
          const args = ['-f', wav, '-nt']
          if (model) args.push('-m', model)
          if (opts.language) args.push('-l', opts.language)
          const text = await new Promise((resolve, reject) => {
            const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
            const out = []
            const err = []
            child.stdout.on('data', data => out.push(data))
            child.stderr.on('data', data => err.push(data))
            child.once('error', reject)
            child.once('exit', code => {
              const stdout = Buffer.concat(out).toString('utf8')
              const stderr = Buffer.concat(err).toString('utf8')
              if (code) reject(Object.assign(new Error(stderr || `${command} exited ${code}`), { code }))
              else resolve(parseWhisperOutput(stdout))
            })
          })
          if (text) yield { type: 'final', text }
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      })()
    },
  }
}

export function createOpenAICompatibleStt({
  baseUrl,
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  missing = 'OpenAI-compatible STT needs an API key',
} = {}) {
  return {
    transcribe(audio, opts = {}) {
      return (async function* () {
        if (!apiKey) throw new Error(missing)
        const { chunks, sampleRate } = await collectPcm(audio)
        if (!chunks.length) return
        const wav = wavFromPcm(chunks, sampleRate)
        const body = new FormData()
        body.append('model', model)
        body.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav')
        if (opts.language) body.append('language', opts.language)
        const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error?.message || `transcription failed: ${response.status}`)
        const text = String(payload.text ?? '').trim()
        if (text) yield { type: 'final', text }
      })()
    },
  }
}

export function createOpenAIStt(options = {}) {
  return createOpenAICompatibleStt({
    baseUrl: options.baseUrl || process.env.LIVE_VOICE_OPENAI_BASE || 'https://api.openai.com/v1',
    apiKey: options.apiKey || process.env.LIVE_VOICE_OPENAI_KEY || process.env.OPENAI_API_KEY,
    model: options.model || process.env.LIVE_VOICE_STT_MODEL || 'whisper-1',
    fetchImpl: options.fetchImpl,
    missing: 'OpenAI STT needs OPENAI_API_KEY',
  })
}

export function createGroqStt(options = {}) {
  return createOpenAICompatibleStt({
    baseUrl: options.baseUrl || 'https://api.groq.com/openai/v1',
    apiKey: options.apiKey || process.env.GROQ_API_KEY,
    model: options.model || process.env.LIVE_VOICE_GROQ_STT || 'whisper-large-v3-turbo',
    fetchImpl: options.fetchImpl,
    missing: 'Groq STT needs GROQ_API_KEY',
  })
}

export function createVoiceboxStt({
  baseUrl = process.env.LIVE_VOICE_VOICEBOX_URL || 'http://127.0.0.1:17493',
  modelSize = process.env.LIVE_VOICE_VOICEBOX_MODEL || 'turbo',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    transcribe(audio, opts = {}) {
      return (async function* () {
        const { chunks, sampleRate } = await collectPcm(audio)
        if (!chunks.length) return
        const wav = wavFromPcm(chunks, sampleRate)
        const body = new FormData()
        body.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav')
        body.append('language', languageOf(opts))
        body.append('model_size', modelSize)
        const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/transcribe`, {
          method: 'POST',
          body,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.detail || payload.error || `voicebox failed: ${response.status}`)
        const text = String(payload.text ?? '').trim()
        if (text) yield { type: 'final', text, duration: payload.duration }
      })()
    },
  }
}

export function createElevenLabsStt({
  apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY,
  model = process.env.LIVE_VOICE_ELEVEN_STT || 'scribe_v2',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    transcribe(audio, opts = {}) {
      return (async function* () {
        if (!apiKey) throw new Error('ElevenLabs STT needs ELEVENLABS_API_KEY')
        const { chunks, sampleRate } = await collectPcm(audio)
        if (!chunks.length) return
        const wav = wavFromPcm(chunks, sampleRate)
        const body = new FormData()
        body.append('model_id', model)
        body.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav')
        if (opts.language) body.append('language_code', opts.language)
        const response = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.detail?.message || payload.error || `elevenlabs failed: ${response.status}`)
        const text = String(payload.text ?? '').trim()
        if (text) yield { type: 'final', text, language: payload.language_code }
      })()
    },
  }
}

export function createDeepgramStt({
  apiKey = process.env.DEEPGRAM_API_KEY,
  model = process.env.LIVE_VOICE_DEEPGRAM_STT || 'nova-3',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    transcribe(audio, opts = {}) {
      return (async function* () {
        if (!apiKey) throw new Error('Deepgram STT needs DEEPGRAM_API_KEY')
        const { chunks, sampleRate } = await collectPcm(audio)
        if (!chunks.length) return
        const wav = wavFromPcm(chunks, sampleRate)
        const language = languageOf(opts)
        const url = new URL('https://api.deepgram.com/v1/listen')
        url.searchParams.set('model', model)
        url.searchParams.set('smart_format', 'true')
        url.searchParams.set('language', language)
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'audio/wav',
          },
          body: wav,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.err_msg || payload.error || `deepgram failed: ${response.status}`)
        const text = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || ''
        if (text) yield { type: 'final', text }
      })()
    },
  }
}

export function createSttEngine(kind = process.env.LIVE_VOICE_STT || 'silence', options = {}) {
  const name = String(kind || 'silence').toLowerCase()
  if (name === 'silence') return createSilenceStt(options)
  if (name === 'whisper' || name === 'whisper-cli') return createWhisperCliStt(options)
  if (name === 'openai' || name === 'whisper-api') return createOpenAIStt(options)
  if (name === 'groq') return createGroqStt(options)
  if (name === 'voicebox') return createVoiceboxStt(options)
  if (name === 'elevenlabs' || name === 'scribe') return createElevenLabsStt(options)
  if (name === 'deepgram' || name === 'nova') return createDeepgramStt(options)
  throw new Error(`Unknown STT engine: ${kind}. Use ${STT_ENGINES.join(', ')}.`)
}
