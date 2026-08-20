/**
 * A2A Agent Card helper. This package is not an A2A runtime.
 * Spec: https://github.com/a2aproject/A2A
 */
export function createA2AAgentCard({
  name = 'live-voice-agent',
  description = 'Always-on spoken assistant. Wake with 헤이 자비스.',
  url = 'https://github.com/davidjdseo/live-voice-agent',
  version = '0.2.0',
} = {}) {
  return {
    name,
    description,
    url,
    version,
    protocolVersion: '0.2',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ['text', 'audio'],
    defaultOutputModes: ['text', 'audio'],
    skills: [
      {
        id: 'spoken-turn',
        name: 'Spoken turn',
        description: 'Accept a wake-gated spoken prompt and return a short spoken reply.',
        tags: ['voice', 'jarvis', 'always-on'],
      },
    ],
    authentication: { schemes: [] },
  }
}
