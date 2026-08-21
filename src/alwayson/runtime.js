import { PHASES, ttsEchoSimilarity, normalizeTranscript } from '../core.js';
import { createVoiceBridge } from '../bridge.js';
import { chunkClauses } from './chunker.js';
import { createRingBuffer, teeStream } from './audio.js';
import { assertEngines, ERROR_CODES } from './engines.js';

export const IO_STATES = Object.freeze({
  STOPPED: 'stopped',
  IDLE_CAPTURE: 'idle_capture',
  TRANSCRIBING: 'transcribing',
  TTS_PLAYING: 'tts_playing',
  TTS_INTERRUPTING: 'tts_interrupting',
  RECOVERING: 'recovering',
});

export function createAlwaysOn({
  engines,
  backend,
  preRollMs = 1500,
  maxUtteranceMs = 30000,
  sampleRate = 16000,
} = {}) {
  assertEngines(engines);
  if (!backend) throw new TypeError('backend is required');

  const listeners = new Map();
  const ring = createRingBuffer({ capacityMs: preRollMs, sampleRate });
  let distributor = null;
  let sourceController = null;
  let sessionController = null;
  let sessionId = null;
  let sequence = 0;
  let generation = 0;
  let phase = PHASES.OFF;
  let ioState = IO_STATES.STOPPED;
  let lifecycle = 'new';
  let stopPromise = null;
  let closedResolve;
  let closedReject;
  let wakeTask;
  let vadTask;
  let sourceTask;
  let sttTask;
  let ttsBarrier = Promise.resolve();
  const timers = new Set();

  const closed = new Promise((resolve, reject) => {
    closedResolve = resolve;
    closedReject = reject;
  });

  const emit = (name, value) => {
    for (const callback of listeners.get(name) ?? []) {
      try {
        callback(value);
      } catch (error) {
        if (name !== 'error') emitError(error);
      }
    }
  };

  const emitError = error => {
    if (isAbortError(error)) return;
    const code = error?.code ?? ERROR_CODES.ENGINE_CRASH;
    emit('error', {
      code,
      message: error?.message ?? String(error),
      error,
    });
  };

  const bridge = createVoiceBridge(backend, {
    onSpeak: () => {},
    onRecord: () => {},
    onStatus: status => handleStatus(status),
    onError: error => emitError(error),
  });

  // bridge.js wires adapter.record/speak by default. Always-on owns capture and
  // playback itself, so replace the hooks with runtime-owned paths.
  bridge.core.hooks.onSpeak = text => {
    void enqueueTts(text);
  };
  bridge.core.hooks.onRecord = () => {};

  // The core wake acknowledgement adds a second TTS turn inside wake(); the
  // always-on loop owns its own greeting path, so disable it here.
  bridge.core.wakeAcknowledgement = '';

  function on(name, callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return () => off(name, callback);
  }

  function off(name, callback) {
    listeners.get(name)?.delete(callback);
  }

  function isAbortError(error) {
    return error?.name === 'AbortError' ||
      error?.code === 'ABORT_ERR' ||
      sessionController?.signal?.aborted && error?.message === 'runtime stopped';
  }

  // Iterate an engine stream without trusting the engine to honor the abort
  // signal: each next() is raced against the signal so stop() can always
  // reclaim the task.
  async function* iterateWithAbort(iterable, signal) {
    const iterator = iterable[Symbol.asyncIterator]();
    // The pending-next race resolves with done when the signal fires, but the
    // underlying next() promise still exists; keep it so a late resolution
    // does not surface as an unhandled rejection after cleanup.
    let orphaned = null;
    try {
      while (true) {
        if (signal?.aborted) return;
        const result = await new Promise((resolve, reject) => {
          let settled = false;
          const onAbort = () => {
            if (settled) return;
            settled = true;
            orphaned = pending;
            orphaned.catch(() => {});
            resolve({ value: undefined, done: true });
          };
          const pending = iterator.next();
          signal?.addEventListener('abort', onAbort, { once: true });
          pending.then(
            value => {
              if (settled) return;
              settled = true;
              signal?.removeEventListener('abort', onAbort);
              resolve(value);
            },
            error => {
              if (settled) return;
              settled = true;
              signal?.removeEventListener('abort', onAbort);
              reject(error);
            },
          );
        });
        if (result.done) return;
        yield result.value;
      }
    } finally {
      try { await iterator.return?.(); } catch { /* engine cleanup is best-effort */ }
      if (orphaned) orphaned.catch(() => {});
    }
  }

  function linkAbort(parent, child) {
    if (!parent) return () => {};
    const parentSignal = parent instanceof AbortController ? parent.signal : parent;
    const childController = child instanceof AbortController ? child : null;
    const childSignal = childController ? childController.signal : child;
    if (!parentSignal || !childController) return () => {};
    if (parentSignal.aborted) {
      childController.abort(parentSignal.reason);
      return () => {};
    }
    const handler = () => childController.abort(parentSignal.reason);
    parentSignal.addEventListener('abort', handler, { once: true });
    return () => parentSignal.removeEventListener('abort', handler);
  }

  function makeTask(kind, parentSignal) {
    const taskGeneration = generation;
    const controller = new AbortController();
    // Link the parent once, at task creation. The unlinker is only used by the
    // task's own finish path; closing the parent later must not leak handlers.
    const unlink = linkAbort(parentSignal, controller);
    const task = {
      kind,
      generation: taskGeneration,
      controller,
      signal: controller.signal,
      isCurrent: () => lifecycle === 'running' && generation === taskGeneration && !controller.signal.aborted,
      finish: () => unlink(),
    };
    return task;
  }

  function schedule(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function handleStatus(status = {}) {
    if (status.phase) {
      const next = status.phase;
      phase = next;
      emit('phase', next);
      if (next === PHASES.LISTENING) {
        ioState = IO_STATES.TRANSCRIBING;
        // Start STT whenever we are LISTENING and no utterance is in flight.
        // Do not require a phase change: start() already enters LISTENING, and
        // wake() with acknowledgement disabled stays in LISTENING.
        void beginUtterance(generation).catch(emitError);
      } else if (next === PHASES.SPEAKING) {
        ioState = IO_STATES.TTS_PLAYING;
        if (sttTask) {
          sttTask.controller.abort(new Error('speaking'));
          sttTask = null;
        }
      } else if (next === PHASES.IDLE) {
        ioState = IO_STATES.IDLE_CAPTURE;
      } else if (next === PHASES.OFF) {
        ioState = IO_STATES.STOPPED;
      }
      emit('status', { ...status, phase: next, ioState });
    }

    if (status.rejection) {
      // Filler and echo rejections are session-level gates, not stream errors.
      // Keep the current STT stream open so a later meaningful final can land.
    }
  }

  function numberedSource() {
    const source = engines.source.stream({ signal: sourceController.signal });
    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of source) {
          const item = { ...chunk, seq: ++sequence, sampleRate: chunk.sampleRate ?? sampleRate };
          ring.push(item);
          yield item;
        }
      },
    };
  }

  function openPrerollStream(name) {
    // Deduplication is handled by the distributor's seq cursors; preroll chunks
    // share the same seq space, so only seq > boundary reaches the live half.
    const snapshot = ring.snapshot();
    const boundary = snapshot.at(-1)?.seq ?? sequence;
    const live = distributor.subscribeAfterSeq(name, boundary);

    return {
      async *[Symbol.asyncIterator]() {
        for (const item of snapshot) yield item;
        for await (const item of live) yield item;
      },
    };
  }

  async function consumeWake(task) {
    try {
      const iterable = engines.wakeword.detect(distributor.streams.wakeword, { signal: task.signal });
      for await (const event of iterateWithAbort(iterable, task.signal)) {
        if (!task.isCurrent()) break;
        emit('wake', event);
        // core.wake() arms the gate. start() already entered LISTENING, so
        // wake() with acknowledgement disabled stays in LISTENING — kick STT
        // explicitly after arming.
        bridge.core.wake(sessionId);
        void beginUtterance(generation).catch(emitError);
      }
    } catch (error) {
      if (!isAbortError(error)) emitError(error);
    } finally {
      task.finish();
      wakeTask = null;
    }
  }

  async function consumeVad(task) {
    try {
      const iterable = engines.vad.detect(distributor.streams.vad, { signal: task.signal });
      for await (const event of iterateWithAbort(iterable, task.signal)) {
        if (!task.isCurrent() || event?.type !== 'speech_start') continue;
        if (phase !== PHASES.SPEAKING) continue;
        void beginCandidate().catch(emitError);
      }
    } catch (error) {
      if (!isAbortError(error)) emitError(error);
    } finally {
      task.finish();
    }
  }

  async function beginUtterance(expectedGeneration) {
    if (sttTask || phase !== PHASES.LISTENING || lifecycle !== 'running') return;
    if (!distributor) return;
    if (!bridge.core.armed) return;
    // Open the preroll/live boundary synchronously: no await between snapshot
    // and subscribeAfterSeq, so no chunk can be lost or duplicated.
    const audio = openPrerollStream('stt');
    const task = makeTask('stt', sessionController.signal);
    sttTask = task;
    const timeout = schedule(() => {
      if (!task.isCurrent()) return;
      task.controller.abort(Object.assign(new Error('Utterance timeout'), { code: ERROR_CODES.UTTERANCE_TIMEOUT }));
      emit('error', { code: ERROR_CODES.UTTERANCE_TIMEOUT, message: 'Utterance transcription timed out' });
    }, maxUtteranceMs);

    try {
      const iterable = engines.stt.transcribe(audio, { signal: task.signal });
      for await (const event of iterateWithAbort(iterable, task.signal)) {
        if (!task.isCurrent() || expectedGeneration !== generation) break;
        if (event?.type === 'final') {
          const text = String(event.text ?? '').trim();
          const result = bridge.core.acceptTranscript(sessionId, text);
          if (result.accepted) emit('utterance', text);
          if (result.accepted || !task.isCurrent()) break;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) emitError(error);
    } finally {
      clearTimeout(timeout);
      timers.delete(timeout);
      if (sttTask === task) sttTask = null;
      task.finish();
    }
  }

  async function beginCandidate() {
    if (sttTask || lifecycle !== 'running') return;
    if (!distributor) return;
    const audio = openPrerollStream('stt');
    const task = makeTask('candidate-stt', sessionController.signal);
    sttTask = task;
    try {
      const iterable = engines.stt.transcribe(audio, { signal: task.signal });
      let candidate = '';
      for await (const event of iterateWithAbort(iterable, task.signal)) {
        if (!task.isCurrent()) break;
        if (event?.text) candidate = String(event.text);
        if (event?.type !== 'final' && event?.type !== 'partial') continue;

        const normalized = normalizeTranscript(candidate);
        const spoken = normalizeTranscript(bridge.core.lastSpoken);
        const meaningful = normalized.length >= 2;
        const substring = spoken.length >= 4 && normalized.length >= 4 &&
          (spoken.replaceAll(' ', '').includes(normalized.replaceAll(' ', '')) ||
           normalized.replaceAll(' ', '').includes(spoken.replaceAll(' ', '')));
        const echo = ttsEchoSimilarity(candidate, bridge.core.lastSpoken) >= 0.72 || substring;

        if (!meaningful) continue;
        if (echo) {
          // Let VoiceCore record the echo rejection so callers can observe it.
          bridge.core.acceptTranscript(sessionId, candidate);
          if (event.type === 'final') break;
          continue;
        }

        // acceptTranscript submits first; interrupt follows synchronously. This
        // preserves the existing core contract, allowing backend submit to win
        // the race before the fire-and-forget playback interruption.
        const result = bridge.core.acceptTranscript(sessionId, candidate);
        if (result.accepted && result.interrupted) {
          ioState = IO_STATES.TTS_INTERRUPTING;
          ttsBarrier = Promise.resolve()
            .then(() => engines.tts.interrupt())
            .catch(error => {
              emitError(error);
            });
          void ttsBarrier;
          emit('interrupted', candidate);
        }
        if (result.accepted) break;
        if (event.type === 'final') break;
      }
    } catch (error) {
      if (!isAbortError(error)) emitError(error);
    } finally {
      if (sttTask === task) sttTask = null;
      task.finish();
    }
  }

  async function enqueueTts(text) {
    const task = makeTask('tts', sessionController?.signal);
    try {
      await ttsBarrier;
      if (!task.isCurrent()) return;
      const clauses = chunkClauses(String(text ?? ''));
      const iterable = engines.tts.speak(clauses, { signal: task.signal });
      for await (const event of iterateWithAbort(iterable, task.signal)) {
        if (!task.isCurrent()) break;
        if (event?.type === 'chunk' && event.audio) emit('response_chunk', event.audio);
        else if (event?.type === 'done') ioState = IO_STATES.IDLE_CAPTURE;
      }
    } catch (error) {
      if (!isAbortError(error)) emitError(error);
    } finally {
      task.finish();
    }
  }

  async function runSource() {
    try {
      const source = numberedSource();
      distributor = teeStream(source, {
        wakeword: { overflow: 'drop-oldest', maxChunks: 32 },
        vad: { overflow: 'drop-oldest', maxChunks: 32 },
        stt: { overflow: 'abort-stream', maxChunks: 128 },
        meter: { overflow: 'drop-newest', maxChunks: 16 },
      });
      const wakeWorker = makeTask('wake', sourceController.signal);
      const vadWorker = makeTask('vad', sourceController.signal);
      wakeTask = consumeWake(wakeWorker);
      vadTask = consumeVad(vadWorker);
      // distributor.closed resolves only when the source ends or fails.
      await distributor.closed;
    } catch (error) {
      if (!isAbortError(error)) emitError(error);
    } finally {
      // Signal source closure to consumers that joined through the distributor.
      distributor = null;
    }
  }

  async function start() {
    if (lifecycle === 'running') return;
    if (lifecycle === 'stopping') await stopPromise;
    const id = backend.getSessionId?.();
    if (!id) throw new Error('A focused session is required to start voice');

    lifecycle = 'running';
    generation++;
    sessionId = id;
    sourceController = new AbortController();
    sessionController = new AbortController();

    try {
      await engines.source.start({ signal: sourceController.signal });
      await bridge.start(sessionId);
      ioState = IO_STATES.IDLE_CAPTURE;
      sourceTask = runSource();
    } catch (error) {
      emitError(error);
      await stop().catch(() => {});
      throw error;
    }
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    if (lifecycle === 'stopped' || lifecycle === 'new') {
      lifecycle = 'stopped';
      closedResolve();
      return;
    }

    stopPromise = (async () => {
      lifecycle = 'stopping';
      generation++;
      const errors = [];
      try { sessionController?.abort(new Error('runtime stopped')); } catch (error) { errors.push(error); }
      try { sourceController?.abort(new Error('runtime stopped')); } catch (error) { errors.push(error); }
      // Stop the capture device first: ending the source stream unblocks the
      // distributor producer, which is awaiting generator.next() — calling
      // generator.return() would wait on that pending next() forever.
      try { await engines.source.stop(); } catch (error) { errors.push(error); }
      // Let aborts propagate through engine iterables before closing sinks.
      await new Promise(resolve => setTimeout(resolve, 0));
      // Background loops can lag one microtask behind their abort signal;
      // wait for their terminal cleanup so a restarted runtime never meets
      // stale iterators.
      try { await wakeTask; } catch { /* errors already surfaced via emitError */ }
      try { await vadTask; } catch { /* errors already surfaced via emitError */ }
      try { await distributor?.close?.(); } catch (error) { errors.push(error); }
      try { await sourceTask; } catch { /* errors already surfaced via emitError */ }
      try { await engines.tts.interrupt(); } catch (error) { errors.push(error); }
      try { await bridge.stop(); } catch (error) { errors.push(error); }
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      ring.clear();
      wakeTask = null;
      vadTask = null;
      sourceTask = null;
      sttTask = null;
      distributor = null;
      ioState = IO_STATES.STOPPED;
      phase = PHASES.OFF;
      lifecycle = 'stopped';
      closedResolve();
      if (errors.length) throw new AggregateError(errors, 'Always-on stop failed');
    })();

    return stopPromise;
  }

  async function dispose() {
    return stop();
  }

  return Object.freeze({
    on,
    off,
    start,
    stop,
    dispose,
    closed,
    get phase() { return phase; },
    get ioState() { return ioState; },
    get core() { return bridge.core; },
    get bridge() { return bridge; },
  });
}
