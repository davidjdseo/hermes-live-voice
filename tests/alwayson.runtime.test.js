import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlwaysOn } from '../src/alwayson/runtime.js';

class PushQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.ended = false;
  }

  push(value) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.items.push(value);
  }

  end() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  async next() {
    if (this.items.length) return { value: this.items.shift(), done: false };
    if (this.ended) return { value: undefined, done: true };
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async return() {
    this.end();
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

const audio = {
  pcm: new Int16Array([1, 2, 3]),
  sampleRate: 16000,
  ts: 0,
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await wait(2);
  }
  assert.fail('condition was not met before timeout');
}

function makeBackend() {
  return {
    handlers: new Map(),
    submits: [],
    calls: [],
    getSessionId() {
      return 'session-1';
    },
    toggle(value) {
      this.calls.push(['toggle', value]);
    },
    record(value) {
      this.calls.push(['record', value]);
    },
    speak(value) {
      this.calls.push(['speak', value]);
    },
    submit(payload) {
      this.submits.push(payload);
      this.calls.push(['submit', payload]);
    },
    subscribe(type, callback) {
      this.handlers.set(type, callback);
      return () => this.handlers.delete(type);
    },
    emit(type, payload) {
      const handler = this.handlers.get(type);
      if (!handler) throw new Error(`No handler registered for ${type}`);
      return handler({ sessionId: 'session-1', payload });
    },
  };
}

function makeEngines({ finals = [], candidateTexts = [], ttsEvents = [] } = {}) {
  const sourceQueue = new PushQueue();
  const wakeQueue = new PushQueue();
  const vadQueue = new PushQueue();
  const sttCalls = [];
  const tts = {
    interrupts: 0,
    async interrupt() {
      this.interrupts++;
    },
    async *speak() {
      for (const event of ttsEvents) yield event;
      if (!ttsEvents.length) yield { type: 'done' };
    },
  };

  const engines = {
    source: {
      starts: 0,
      stops: 0,
      async start() {
        this.starts++;
      },
      async stop() {
        this.stops++;
        sourceQueue.end();
      },
      stream() {
        return sourceQueue;
      },
    },
    wakeword: {
      detects: 0,
      detect() {
        this.detects++;
        return wakeQueue;
      },
    },
    vad: {
      detect() {
        return vadQueue;
      },
    },
    stt: {
      transcribe(audio, opts = {}) {
        sttCalls.push({ audio, opts });
        const values = sttCalls.length === 1 && finals.length
          ? finals
          : (candidateTexts.length ? candidateTexts : finals);
        return (async function* () {
          for (const value of values) {
            await wait(value.delay ?? 0);
            yield { type: 'final', text: value.text ?? value };
          }
          if (!values.length) await new Promise(() => {});
        })();
      },
    },
    tts,
  };

  return {
    engines,
    sourceQueue,
    wakeQueue,
    vadQueue,
    sttCalls,
    tts,
  };
}

async function makeRuntime(options = {}) {
  const backend = makeBackend();
  const fake = makeEngines(options);
  const runtime = createAlwaysOn({
    engines: fake.engines,
    backend,
    maxUtteranceMs: options.maxUtteranceMs ?? 1000,
    preRollMs: 10,
    sampleRate: 1000,
  });
  await runtime.start();
  return { runtime, backend, ...fake };
}

test('wake, listening, final STT, and backend submit form one turn', async () => {
  const { runtime, backend, sourceQueue, wakeQueue } = await makeRuntime({
    finals: [{ text: '오늘 날씨 알려줘' }],
  });
  const utterances = [];
  runtime.on('utterance', text => utterances.push(text));

  try {
    wakeQueue.push({ type: 'wake' });
    sourceQueue.push(audio);

    await waitFor(() => backend.submits.length === 1);
    assert.equal(runtime.core.phase, 'thinking');
    assert.deepEqual(backend.submits[0], {
      session_id: 'session-1',
      text: '오늘 날씨 알려줘',
    });
    assert.deepEqual(utterances, ['오늘 날씨 알려줘']);
  } finally {
    await runtime.stop();
  }
});

test('accepted final transcript emits utterance', async () => {
  const { runtime, backend, wakeQueue } = await makeRuntime({
    finals: [{ text: '실행해 줘' }],
  });
  const utterances = [];
  runtime.on('utterance', text => utterances.push(text));

  try {
    wakeQueue.push({ type: 'wake' });
    await waitFor(() => utterances.length === 1);
    assert.deepEqual(backend.submits[0].text, '실행해 줘');
    assert.deepEqual(utterances, ['실행해 줘']);
  } finally {
    await runtime.stop();
  }
});

test('barge-in submits an interruption and interrupts TTS', async () => {
  const { runtime, backend, wakeQueue, vadQueue, tts } = await makeRuntime({
    finals: [],
    candidateTexts: [{ text: '다른 명령 실행해' }],
  });
  const interrupted = [];
  runtime.on('interrupted', text => interrupted.push(text));

  try {
    backend.emit('message.complete', {
      turn_id: 'turn-1',
      text: '<<<VOICE 현재 작업을 진행합니다. VOICE>>>',
    });
    await waitFor(() => runtime.core.phase === 'speaking');

    vadQueue.push({ type: 'speech_start' });
    await waitFor(() => backend.submits.length === 1);

    assert.deepEqual(backend.submits[0], {
      session_id: 'session-1',
      text: '다른 명령 실행해',
      interrupted: true,
    });
    assert.equal(tts.interrupts, 1);
    assert.deepEqual(interrupted, ['다른 명령 실행해']);
  } finally {
    await runtime.stop();
  }
});

test('TTS echo is rejected and playback continues', async () => {
  const { runtime, backend, vadQueue, tts } = await makeRuntime({
    candidateTexts: [{ text: '현재 작업을 진행합니다' }],
    ttsEvents: [{ type: 'started' }],
  });

  const result = backend.emit('message.complete', {
    turn_id: 'turn-echo',
    text: '<<<VOICE 현재 작업을 진행합니다. VOICE>>>',
  });
  assert.equal(result.spoken, true);
  await waitFor(() => runtime.core.phase === 'speaking');

  vadQueue.push({ type: 'speech_start' });
  await waitFor(() => runtime.core.lastRejection === 'tts echo' || runtime.core.lastRejection === 'tts echo substring');

  assert.equal(backend.submits.length, 0);
  assert.equal(tts.interrupts, 0);
  await runtime.stop();
});

test('stop is idempotent and stops the source only once', async () => {
  const { runtime, engines } = await makeRuntime();

  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(engines.source.stops, 1);
  assert.equal(runtime.ioState, 'stopped');
});

test('message.complete with one terminal VOICE block enters SPEAKING', async () => {
  const { runtime, backend } = await makeRuntime();

  try {
    const result = backend.emit('message.complete', {
      session_id: 'session-1',
      turn_id: 'turn-voice',
      text: '설명입니다. <<<VOICE 안녕하세요. VOICE>>>',
    });
    assert.equal(result.spoken, true);
    await waitFor(() => runtime.core.phase === 'speaking');
  } finally {
    await runtime.stop();
  }
});

test('filler rejection aborts STT and wake detection is resumed', async () => {
  const { runtime, backend, wakeQueue, engines } = await makeRuntime({
    finals: [{ text: '음' }],
  });

  try {
    wakeQueue.push({ type: 'wake' });
    await waitFor(() => runtime.core.lastRejection === 'filler/noise');
    // Wake detection stays on the original live stream; resume does not open a
    // second detect(). The original detect() remains armed.
    assert.equal(engines.wakeword.detects, 1);
    assert.equal(backend.submits.length, 0);
  } finally {
    await runtime.stop();
  }
});

test('utterance timeout emits UTTERANCE_TIMEOUT', async () => {
  const { runtime, wakeQueue } = await makeRuntime({
    finals: [],
    maxUtteranceMs: 50,
  });
  const errors = [];
  runtime.on('error', error => errors.push(error));

  try {
    wakeQueue.push({ type: 'wake' });
    await waitFor(() => errors.some(error => error.code === 'UTTERANCE_TIMEOUT'), 300);
    assert.equal(errors.some(error => error.code === 'UTTERANCE_TIMEOUT'), true);
  } finally {
    await runtime.stop();
  }
});
