import { createAlwaysOn } from 'hermes-live-voice/always-on'

const assistant = createAlwaysOn({
  engines: {
    source: myAudioSource,   // { start, stop, stream() }
    wakeword: myWakeEngine,  // { detect(audio, opts) }
    vad: myVadEngine,        // { detect(audio, opts) }
    stt: mySttEngine,        // { transcribe(audio, opts) }
    tts: myTtsEngine,        // { speak(text, opts), interrupt() }
  },
  backend: myHarness,        // existing 6-method adapter contract
  preRollMs: 1500,
  maxUtteranceMs: 30000,
})
assistant.on('interrupted', () => myHarness.cancelCurrent?.())
await assistant.start()
