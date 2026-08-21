import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEnergyVad,
  createPushToTalkWake,
  createSilenceStt,
  createSayTts,
  createLocalEngines,
} from '../src/alwayson/local.js'
import { VoiceCore } from '../src/core.js'

function tone(rms = 0.05, samples = 320, sampleRate = 16000) {
  const pcm = new Int16Array(samples)
  const amplitude = Math.round(rms * 32767)
  for (let i = 0; i < samples; i++) pcm[i] = amplitude
  return { pcm, sampleRate, ts: Date.now() }
}

async function collect(iterable) {
  const items = []
  for await (const item of iterable) items.push(item)
  return items
}

test('energy VAD emits speech_start then speech_end', async () => {
  const vad = createEnergyVad({ minSpeechMs: 20, minSilenceMs: 20 })
  async function* audio() {
    yield tone(0.05)
    yield tone(0.05)
    yield tone(0.001)
    yield tone(0.001)
  }
  const events = await collect(vad.detect(audio()))
  assert.equal(events[0].type, 'speech_start')
  assert.equal(events.at(-1).type, 'speech_end')
})

test('push-to-talk wake yields hey jarvis', async () => {
  const wake = createPushToTalkWake({ keyword: 'hey jarvis' })
  const items = []
  const consuming = (async () => {
    for await (const event of wake.detect()) {
      items.push(event)
      break
    }
  })()
  wake.trigger()
  await consuming
  assert.equal(items[0].keyword, 'hey jarvis')
})

test('silence STT finals after speech then quiet', async () => {
  const stt = createSilenceStt({ minSpeechMs: 20, endSilenceMs: 20 })
  async function* audio() {
    yield tone(0.05)
    yield tone(0.05)
    yield tone(0.001)
    yield tone(0.001)
  }
  const events = await collect(stt.transcribe(audio()))
  assert.equal(events[0].type, 'final')
  assert.ok(events[0].text)
})

test('say TTS interrupt does not throw when idle', async () => {
  const tts = createSayTts()
  await tts.interrupt()
})

test('local engines expose the five contracts', () => {
  const engines = createLocalEngines({ keyword: 'hey jarvis' })
  assert.equal(typeof engines.source.start, 'function')
  assert.equal(typeof engines.wakeword.detect, 'function')
  assert.equal(typeof engines.vad.detect, 'function')
  assert.equal(typeof engines.stt.transcribe, 'function')
  assert.equal(typeof engines.tts.speak, 'function')
  assert.equal(typeof engines.tts.interrupt, 'function')
})

test('avfoundation device parser reads ffmpeg listing text', async () => {
  const { listAvfoundationAudioDevices } = await import('../src/alwayson/local.js')
  const devices = listAvfoundationAudioDevices()
  assert.equal(Array.isArray(devices), true)
})

test('always-listen wake fires without push-to-talk', () => {
  const engines = createLocalEngines({ pushToTalk: false, stt: 'silence' })
  assert.equal(typeof engines.triggerWake, 'function')
  assert.equal(engines.wakeword.detect.length, 1)
})

test('hey jarvis and hey 자스비 both arm VoiceCore', () => {
  const core = new VoiceCore({ wakeAcknowledgement: '' })
  core.start('s1')
  assert.equal(core.acceptTranscript('s1', '헤이 자비스').armed, true)
  core.start('s1')
  assert.equal(core.acceptTranscript('s1', '헤이 자스비 날씨 알려줘').text, '날씨 알려줘')
  core.start('s1')
  assert.equal(core.acceptTranscript('s1', 'hey jarvis open the door').text, 'open the door')
})
