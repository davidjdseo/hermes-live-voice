import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSttEngine,
  STT_ENGINES,
  wavFromPcm,
  createVoiceboxStt,
  createElevenLabsStt,
  createGroqStt,
  createDeepgramStt,
} from '../src/alwayson/stt.js'

function tone(rms = 0.05, samples = 320, sampleRate = 16000) {
  const pcm = new Int16Array(samples)
  const amplitude = Math.round(rms * 32767)
  for (let i = 0; i < samples; i++) pcm[i] = amplitude
  return { pcm, sampleRate, ts: Date.now() }
}

async function* audio() {
  yield tone()
  yield tone()
}

async function collect(iterable) {
  const items = []
  for await (const item of iterable) items.push(item)
  return items
}

test('unknown STT engine fails fast', () => {
  assert.throws(() => createSttEngine('nope'), /Unknown STT/)
  assert.ok(STT_ENGINES.includes('voicebox'))
  assert.ok(STT_ENGINES.includes('elevenlabs'))
})

test('wav packaging is a valid RIFF header', () => {
  const wav = wavFromPcm([tone()], 16000)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
})

test('voicebox STT posts multipart model field to /transcribe', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ text: '안녕', duration: 0.4 }) }
  }
  const events = await collect(createVoiceboxStt({ fetchImpl }).transcribe(audio(), { language: 'ko' }))
  assert.equal(events[0].text, '안녕')
  assert.equal(calls[0].url, 'http://127.0.0.1:17493/transcribe')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body.get('model'), 'base')
  assert.equal(calls[0].init.body.get('language'), 'ko')
})

test('elevenlabs STT uses xi-api-key and scribe_v2', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ text: 'hello', language_code: 'en' }) }
  }
  const events = await collect(createElevenLabsStt({ apiKey: 'k', fetchImpl }).transcribe(audio()))
  assert.equal(events[0].text, 'hello')
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/speech-to-text')
  assert.equal(calls[0].init.headers['xi-api-key'], 'k')
})

test('groq STT uses openai compatible transcriptions', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ text: 'fast' }) }
  }
  const events = await collect(createGroqStt({ apiKey: 'g', fetchImpl }).transcribe(audio()))
  assert.equal(events[0].text, 'fast')
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions')
})

test('deepgram STT uses nova-3 listen', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      json: async () => ({ results: { channels: [{ alternatives: [{ transcript: 'nova' }] }] } }),
    }
  }
  const events = await collect(createDeepgramStt({ apiKey: 'd', fetchImpl }).transcribe(audio(), { language: 'ko' }))
  assert.equal(events[0].text, 'nova')
  assert.match(String(calls[0].url), /api\.deepgram\.com\/v1\/listen/)
  assert.match(String(calls[0].url), /model=nova-3/)
})
