import { createSidecarClient } from './client.js';

function queueIterable(signal) {
  const values = [];
  const waiters = [];
  let ended = false;
  const wake = () => {
    while (waiters.length && (values.length || ended)) waiters.shift()();
  };
  const push = value => {
    if (!ended) {
      values.push(value);
      wake();
    }
  };
  const end = () => {
    ended = true;
    wake();
  };
  const onAbort = () => end();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    push,
    end,
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (values.length) return { value: values.shift(), done: false };
            if (ended || signal?.aborted) return { value: undefined, done: true };
            await new Promise(resolve => waiters.push(resolve));
            if (values.length) return { value: values.shift(), done: false };
            return { value: undefined, done: true };
          },
          return: async () => {
            end();
            return { value: undefined, done: true };
          },
        };
      },
    },
  };
}

function pcmBase64(pcm) {
  const view = pcm instanceof Int16Array
    ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    : new Uint8Array(pcm);
  return Buffer.from(view).toString('base64');
}

function chunkOf(audio, sampleRate, seq) {
  return {
    pcm_b64: pcmBase64(audio.pcm),
    sampleRate: audio.sampleRate || sampleRate,
    ts: audio.ts ?? Date.now(),
    seq: audio.seq ?? seq,
  };
}

function eventValue(message) {
  return message.params ?? message.data ?? message;
}

export function pythonEngine({
  command = ['python3', '-m', 'hermes_voice_engine'],
  sampleRate = 16000,
  frameMs = 20,
  ...rest
} = {}) {
  const client = createSidecarClient({
    command: command[0],
    args: command.slice(1),
    ...rest,
  });
  let sourceQueue = null;
  const eventSubscribers = new Set();

  client.on('event', message => {
    for (const subscriber of eventSubscribers) subscriber(message);
    if (message.event === 'audio.chunk' || message.method === 'audio.chunk') {
      sourceQueue?.push(eventValue(message));
    }
  });

  const subscribe = (name, signal) => {
    const q = queueIterable(signal);
    const handler = message => {
      const event = message.event || message.method;
      if (event === name) q.push(eventValue(message));
    };
    eventSubscribers.add(handler);
    const originalEnd = q.end;
    q.end = () => {
      eventSubscribers.delete(handler);
      originalEnd();
    };
    signal?.addEventListener('abort', q.end, { once: true });
    return q;
  };

  const feedAudio = async (audio, signal, session) => {
    let seq = 0;
    try {
      for await (const frame of audio) {
        if (signal?.aborted) break;
        await client.notify('audio.feed', { session, chunk: chunkOf(frame, sampleRate, seq++) });
      }
    } finally {
      return seq;
    }
  };

  const source = {
    async start() {
      await client.start();
    },
    async stop() {
      sourceQueue?.end();
      sourceQueue = null;
      await client.close();
    },
    stream() {
      sourceQueue = queueIterable();
      return sourceQueue.iterable;
    },
  };

  const wakeword = {
    detect(audio, opts = {}) {
      const q = subscribe('wake.detected', opts.signal);
      const session = `wake-${Date.now()}-${Math.random()}`;
      (async () => {
        try {
          await feedAudio(audio, opts.signal, session);
        } finally {
          if (!opts.signal?.aborted) await client.notify('stream.stop', { session }).catch(() => {});
          q.end();
        }
      })();
      return q.iterable;
    },
  };

  const vad = {
    detect(audio, opts = {}) {
      const q = subscribe('vad.event', opts.signal);
      const session = `vad-${Date.now()}-${Math.random()}`;
      (async () => {
        try {
          await feedAudio(audio, opts.signal, session);
        } finally {
          if (!opts.signal?.aborted) await client.notify('stream.stop', { session }).catch(() => {});
          q.end();
        }
      })();
      return q.iterable;
    },
  };

  const stt = {
    transcribe(audio, opts = {}) {
      const output = queueIterable(opts.signal);
      const session = `stt-${Date.now()}-${Math.random()}`;
      const handler = message => {
        const event = message.event || message.method;
        if (event === 'stt.partial') output.push({ type: 'partial', ...eventValue(message) });
        else if (event === 'stt.final') {
          output.push({ type: 'final', ...eventValue(message) });
          output.end();
        }
      };
      eventSubscribers.add(handler);
      const cleanup = () => eventSubscribers.delete(handler);
      opts.signal?.addEventListener('abort', () => { cleanup(); output.end(); }, { once: true });

      (async () => {
        try {
          await client.request('stt.begin', { session, language: opts.language });
          await feedAudio(audio, opts.signal, session);
          if (opts.signal?.aborted) {
            await client.notify('stt.abort', { session }).catch(() => {});
            return;
          }
          await client.notify('stt.end', { session });
        } catch (error) {
          output.push({ type: 'error', error });
          output.end();
        }
      })();
      return output.iterable;
    },
  };

  const tts = {
    speak(text, opts = {}) {
      const output = queueIterable(opts.signal);
      const session = `tts-${Date.now()}-${Math.random()}`;
      const wanted = new Set(['tts.started', 'tts.chunk', 'tts.done', 'tts.interrupted']);
      const handler = message => {
        const event = message.event || message.method;
        if (!wanted.has(event)) return;
        output.push(eventValue(message));
        if (event === 'tts.done' || event === 'tts.interrupted') output.end();
      };
      eventSubscribers.add(handler);
      const cleanup = () => eventSubscribers.delete(handler);
      opts.signal?.addEventListener('abort', () => { cleanup(); output.end(); }, { once: true });

      (async () => {
        try {
          if (typeof text === 'string') {
            await client.notify('tts.speak', { session, text, meter: opts.meter });
          } else {
            await client.notify('tts.speak', { session, meter: opts.meter });
            for await (const part of text) {
              if (opts.signal?.aborted) break;
              await client.notify('tts.text', { session, text: part });
            }
            if (!opts.signal?.aborted) await client.notify('tts.end', { session });
          }
        } catch (error) {
          output.push({ type: 'error', error });
          output.end();
        }
      })();
      return output.iterable;
    },
    async interrupt() {
      await client.notify('tts.interrupt');
    },
  };

  return { source, wakeword, vad, stt, tts, client, frameMs };
}
