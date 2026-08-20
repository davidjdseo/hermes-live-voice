import { spawn } from 'node:child_process';
import { encodeLine, createLineDecoder } from './protocol.js';

const STATES = Object.freeze({
  SPAWNED: 'SPAWNED',
  WAIT_HELLO: 'WAIT_HELLO',
  LOADING: 'LOADING',
  READY: 'READY',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
});

export function createSidecarClient({
  command,
  args = [],
  env,
  restart = { maxAttempts: 3, backoffMs: [1000, 2000, 4000] },
  loadTimeoutMs = 120000,
} = {}) {
  if (!command) throw new TypeError('command is required');

  let child = null;
  let state = STATES.CLOSED;
  let nextId = 1;
  let pending = new Map();
  let listeners = new Map();
  let writeChain = Promise.resolve();
  let started = false;
  let closing = false;
  let restartAttempts = 0;
  let helloTimer = null;
  let loadTimer = null;
  let eofTimer = null;
  let killTimer = null;
  let stderrBytes = 0;
  let stderrPart = '';
  let stderrLines = [];
  let startPromise = null;
  let closePromise = null;

  const emit = (name, value) => {
    for (const cb of listeners.get(name) || []) {
      try {
        cb(value);
      } catch {}
    }
  };

  const clearTimers = () => {
    for (const timer of [helloTimer, loadTimer, eofTimer, killTimer]) {
      if (timer) clearTimeout(timer);
    }
    helloTimer = loadTimer = eofTimer = killTimer = null;
  };

  const stderrText = () => stderrLines.join('\n');

  const collectStderr = data => {
    const text = Buffer.from(data).toString('utf8');
    const pieces = `${stderrPart}${text}`.split('\n');
    stderrPart = pieces.pop() || '';
    for (const piece of pieces) {
      const line = piece.slice(0, 4096);
      const bytes = Buffer.byteLength(line);
      if (stderrBytes + bytes > 65536) {
        const room = Math.max(0, 65536 - stderrBytes);
        stderrLines.push(line.slice(0, room));
        stderrBytes = 65536;
      } else {
        stderrLines.push(line);
        stderrBytes += bytes;
      }
      while (stderrLines.length > 20 || stderrBytes > 65536) {
        stderrBytes -= Buffer.byteLength(stderrLines.shift() || '');
      }
    }
  };

  const rejectPending = error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const makeError = (code, message = code, extra = {}) =>
    Object.assign(new Error(message), { code, ...extra });

  const protocolFailure = (code, details) => {
    const error = makeError('PROTOCOL', code, { protocolCode: code, details });
    emit('crash', error);
    if (child && !closing) child.kill('SIGTERM');
  };

  const sendNow = (message, urgent = false) => {
    if (!child?.stdin || child.stdin.destroyed || state === STATES.CLOSING || state === STATES.CLOSED) {
      return Promise.reject(makeError('ENGINE_CRASH'));
    }
    const data = encodeLine(message);
    const write = () => new Promise((resolve, reject) => {
      let timer;
      const done = (error) => {
        if (timer) clearTimeout(timer);
        child?.stdin?.off('drain', drained);
        error ? reject(error) : resolve();
      };
      const drained = () => done();
      try {
        if (child.stdin.write(data)) return done();
        child.stdin.once('drain', drained);
        timer = setTimeout(() => {
          done(makeError('AUDIO_OVERFLOW'));
          protocolFailure('AUDIO_OVERFLOW');
        }, 250);
      } catch (error) {
        done(error);
      }
    });
    if (urgent) return write();
    const result = writeChain.then(write);
    writeChain = result.catch(() => {});
    return result;
  };

  const validateMessage = message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      protocolFailure('INVALID_MESSAGE');
      return false;
    }
    const type = message.type;
    if (state === STATES.WAIT_HELLO) {
      if (type !== 'hello') {
        protocolFailure('MESSAGE_BEFORE_HELLO', { type });
        return false;
      }
      return true;
    }
    if (state === STATES.LOADING) {
      if (!['ready', 'event', 'notification', 'response'].includes(type)) {
        protocolFailure('INVALID_MESSAGE_TYPE', { type });
        return false;
      }
      return true;
    }
    if (state === STATES.READY) {
      if (!['event', 'notification', 'response'].includes(type)) {
        protocolFailure('INVALID_MESSAGE_TYPE', { type });
        return false;
      }
      return true;
    }
    return false;
  };

  const handleMessage = message => {
    if (!validateMessage(message)) return;
    if (state === STATES.WAIT_HELLO) {
      if (Buffer.byteLength(JSON.stringify(message)) > 65536) {
        protocolFailure('HELLO_TOO_LARGE');
        return;
      }
      if (message.state === 'loading') {
        state = STATES.LOADING;
        clearTimeout(helloTimer);
        loadTimer = setTimeout(() => protocolFailure('LOAD_TIMEOUT'), loadTimeoutMs);
      } else {
        state = STATES.READY;
        clearTimeout(helloTimer);
        emit('ready', message);
        startPromise?.resolve?.(message);
        startPromise = null;
      }
      return;
    }
    if (state === STATES.LOADING && message.type === 'ready') {
      state = STATES.READY;
      clearTimeout(loadTimer);
      emit('ready', message);
      startPromise?.resolve?.(message);
      startPromise = null;
      return;
    }
    if (message.type === 'response') {
      const entry = pending.get(message.id);
      if (!entry) {
        protocolFailure('UNKNOWN_ID', { id: message.id });
        return;
      }
      pending.delete(message.id);
      if (message.error) entry.reject(Object.assign(makeError(message.error.code || 'ENGINE_ERROR', message.error.message), message.error));
      else entry.resolve(message.result ?? message);
      return;
    }
    emit('event', message);
  };

  const spawnChild = () => {
    if (closing) return;
    stderrBytes = 0;
    stderrPart = '';
    stderrLines = [];
    state = STATES.SPAWNED;
    child = spawn(command, args, {
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    state = STATES.WAIT_HELLO;
    const decoder = createLineDecoder({
      onMessage: handleMessage,
      onProtocolError: protocolFailure,
    });
    child.stdout.on('data', data => decoder.push(data));
    child.stdout.on('end', () => decoder.end());
    child.stderr.on('data', collectStderr);
    child.stdin.on('finish', () => {
      if (!closing) return;
      eofTimer = setTimeout(() => forceKill(), 2000);
    });
    child.once('error', error => {
      if (!closing) protocolFailure('SPAWN_ERROR', { message: error.message });
    });
    child.once('exit', (code, signal) => {
      clearTimers();
      const old = child;
      child = null;
      const crashed = !closing;
      if (crashed) {
        const error = makeError('ENGINE_CRASH', 'Sidecar exited', {
          exitCode: code,
          signal,
          stderr: stderrText(),
        });
        rejectPending(error);
        emit('crash', error);
        if (restartAttempts < restart.maxAttempts) {
          const delay = restart.backoffMs?.[restartAttempts] ?? restart.backoffMs?.at(-1) ?? 0;
          restartAttempts++;
          setTimeout(spawnChild, delay);
        } else {
          state = STATES.CLOSED;
          emit('dead', makeError('ENGINE_DEAD', 'Sidecar restart limit exceeded', { stderr: stderrText() }));
          startPromise?.reject?.(error);
          startPromise = null;
        }
      } else {
        state = STATES.CLOSED;
        startPromise?.reject?.(makeError('ENGINE_CRASH'));
        startPromise = null;
        closePromise?.resolve?.();
      }
      if (old?.stdin && !old.stdin.destroyed) old.stdin.destroy();
    });
    helloTimer = setTimeout(() => protocolFailure('HELLO_TIMEOUT'), 5000);
  };

  const forceKill = () => {
    if (!child) return;
    try { child.kill('SIGTERM'); } catch {}
    killTimer = setTimeout(() => {
      if (child) try { child.kill('SIGKILL'); } catch {}
    }, 1000);
  };

  const start = () => {
    if (state === STATES.READY) return Promise.resolve();
    if (state === STATES.WAIT_HELLO || state === STATES.LOADING) {
      return new Promise((resolve, reject) => {
        const previous = startPromise;
        startPromise = {
          resolve: value => { previous?.resolve?.(value); resolve(value); },
          reject: error => { previous?.reject?.(error); reject(error); },
        };
      });
    }
    if (closing) return Promise.reject(makeError('ENGINE_CLOSED'));
    started = true;
    startPromise = {};
    const promise = new Promise((resolve, reject) => {
      startPromise.resolve = resolve;
      startPromise.reject = reject;
    });
    spawnChild();
    return promise;
  };

  const request = (method, params, { timeoutMs = 30000 } = {}) => {
    if (state !== STATES.READY && state !== STATES.LOADING) return Promise.reject(makeError('ENGINE_NOT_READY'));
    if (pending.size >= 64) return Promise.reject(makeError('SIDECAR_PENDING_LIMIT'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(makeError('REQUEST_TIMEOUT'));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      sendNow({ type: 'request', id, method, params }).catch(error => {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  };

  const notify = (method, params) => sendNow({ type: 'notification', method, params }, method === 'tts.interrupt' || method === 'stream.stop');

  const close = () => {
    if (state === STATES.CLOSED) return Promise.resolve();
    if (closePromise) return closePromise.promise;
    closing = true;
    state = STATES.CLOSING;
    clearTimers();
    rejectPending(makeError('ENGINE_CLOSED'));
    closePromise = {};
    closePromise.promise = new Promise(resolve => { closePromise.resolve = resolve; });
    try { child?.stdin?.end(); } catch {}
    eofTimer = setTimeout(forceKill, 2000);
    return closePromise.promise;
  };

  return {
    start,
    request,
    notify,
    close,
    get state() { return state; },
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      return () => listeners.get(name)?.delete(callback);
    },
  };
}
