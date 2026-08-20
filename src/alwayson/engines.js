/**
 * @typedef {object} AudioChunk
 * @property {Int16Array} pcm
 * @property {number} sampleRate
 * @property {number} ts
 * @property {number} [seq]
 * @property {boolean} [preroll]
 */

/**
 * @typedef {object} AudioSource
 * @property {(opts?: {signal?: AbortSignal}) => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {() => AsyncIterable<AudioChunk>} stream
 */

/**
 * @typedef {object} WakewordEngine
 * @property {(audio: AsyncIterable<AudioChunk>, opts?: {signal?: AbortSignal}) => AsyncIterable<object>} detect
 */

/**
 * @typedef {object} VadEngine
 * @property {(audio: AsyncIterable<AudioChunk>, opts?: {signal?: AbortSignal, minSpeechMs?: number}) => AsyncIterable<object>} detect
 */

/**
 * @typedef {object} STTEngine
 * @property {(audio: AsyncIterable<AudioChunk>, opts?: {signal?: AbortSignal, language?: string}) => AsyncIterable<object>} transcribe
 */

/**
 * @typedef {object} TTSEngine
 * @property {(text: string | AsyncIterable<string>, opts?: {signal?: AbortSignal, meter?: boolean}) => AsyncIterable<object>} speak
 * @property {() => Promise<void>} interrupt
 */

export const ERROR_CODES = Object.freeze({
  MIC_DENIED: 'MIC_DENIED',
  DEVICE_LOST: 'DEVICE_LOST',
  DEVICE_BUSY: 'DEVICE_BUSY',
  ENGINE_CRASH: 'ENGINE_CRASH',
  ENGINE_DEAD: 'ENGINE_DEAD',
  PROTOCOL: 'PROTOCOL',
  UTTERANCE_TIMEOUT: 'UTTERANCE_TIMEOUT',
  AUDIO_OVERFLOW: 'AUDIO_OVERFLOW',
});

export function assertEngines(engines) {
  const required = {
    source: ['start', 'stop', 'stream'],
    wakeword: ['detect'],
    vad: ['detect'],
    stt: ['transcribe'],
    tts: ['speak', 'interrupt'],
  };

  for (const [role, methods] of Object.entries(required)) {
    if (!engines?.[role]) throw new TypeError(`engines.${role} is required`);
    for (const method of methods) {
      if (typeof engines[role][method] !== 'function') {
        throw new TypeError(`engines.${role}.${method} is required`);
      }
    }
  }
  return engines;
}
