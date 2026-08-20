import { createAlwaysOn } from 'live-voice-agent/always-on'
import { pythonEngine } from 'live-voice-agent/always-on/sidecar'
import { createHermesAdapter } from 'live-voice-agent/adapters/hermes'

const assistant = createAlwaysOn({
  engines: pythonEngine({ wakeModel: 'hey_jarvis', sttModel: 'base', voice: 'af_heart' }),
  backend: createHermesAdapter(host),
})
assistant.on('wake', () => console.log('[wake]'))
assistant.on('utterance', t => console.log('you:', t))
assistant.on('interrupted', () => console.log('[interrupted]'))
assistant.on('error', e => console.error(e.code, e.message))
await assistant.start()
