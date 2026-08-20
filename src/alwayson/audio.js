const OVERFLOW_CODE = 'AUDIO_OVERFLOW';

export function createRingBuffer({ capacityMs = 1500, sampleRate = 16000 } = {}) {
  const capacity = Math.max(1, Math.floor(Number(capacityMs) * Number(sampleRate) / 1000));
  const chunks = [];
  let samples = 0;

  const push = chunk => {
    if (!chunk || !(chunk.pcm instanceof Int16Array)) {
      throw new TypeError('Audio chunk pcm must be an Int16Array');
    }

    const item = { ...chunk };
    const length = item.pcm.length;

    if (length >= capacity) {
      chunks.length = 0;
      item.pcm = item.pcm.slice(item.pcm.length - capacity);
      chunks.push(item);
      samples = item.pcm.length;
      return;
    }

    chunks.push(item);
    samples += length;
    while (samples > capacity && chunks.length) {
      const first = chunks[0];
      const excess = samples - capacity;
      if (first.pcm.length <= excess) {
        chunks.shift();
        samples -= first.pcm.length;
      } else {
        first.pcm = first.pcm.slice(excess);
        samples -= excess;
      }
    }
  };

  const snapshot = () => chunks.map(chunk => ({ ...chunk, preroll: true }));

  const clear = () => {
    chunks.length = 0;
    samples = 0;
  };

  return Object.freeze({ push, snapshot, clear });
}

export function teeStream(source, policies = {}) {
  if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('source must be an AsyncIterable');
  }

  const consumers = new Map();
  let producerPromise;
  let closedResolve;
  let closedReject;
  let ended = false;

  const closed = new Promise((resolve, reject) => {
    closedResolve = resolve;
    closedReject = reject;
  });

  class Queue {
    constructor(policy) {
      this.policy = policy;
      this.items = [];
      this.waiters = [];
      this.done = false;
      this.error = null;
      this.cleaned = false;
    }

    push(item) {
      if (this.done || this.cleaned) return;
      const max = Math.max(1, Number(this.policy.maxChunks) || 2);

      if (this.items.length >= max) {
        if (this.policy.overflow === 'drop-newest') return;
        if (this.policy.overflow === 'abort-stream') {
          const error = new Error('Audio consumer overflow');
          error.code = OVERFLOW_CODE;
          this.fail(error);
          return;
        }
        this.items.shift();
      }

      if (this.waiters.length) {
        const waiter = this.waiters.shift();
        waiter.resolve({ value: item, done: false });
      } else {
        this.items.push(item);
      }
    }

    next() {
      if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
      if (this.error) return Promise.reject(this.error);
      if (this.done || this.cleaned) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }

    finish() {
      if (this.done || this.cleaned) return;
      this.done = true;
      for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
      this.items.length = 0;
    }

    fail(error) {
      if (this.done || this.cleaned) return;
      this.error = error;
      this.done = true;
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
      this.items.length = 0;
    }

    clear() {
      this.cleaned = true;
      this.items.length = 0;
      for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
    }
  }

  const remove = (id, queue) => {
    if (!consumers.has(id)) return;
    consumers.delete(id);
    queue.clear();
  };

  const subscribe = (name, afterSeq = -Infinity) => {
    const policy = policies[name] ?? {};
    const queue = new Queue(policy);
    const id = Symbol(name);
    consumers.set(id, queue);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      remove(id, queue);
    };

    const iterator = {
      async next() {
        try {
          const result = await queue.next();
          if (!result.done && Number.isFinite(afterSeq) && result.value?.seq <= afterSeq) {
            return this.next();
          }
          return result;
        } catch (error) {
          cleanup();
          throw error;
        }
      },
      async return() {
        cleanup();
        return { value: undefined, done: true };
      },
      async throw(error) {
        cleanup();
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
  };

  const streams = {};
  for (const name of Object.keys(policies)) streams[name] = subscribe(name);

  const producerIterator = source[Symbol.asyncIterator]();

  const run = async () => {
    try {
      while (true) {
        const { value: item, done } = await producerIterator.next();
        if (done) break;
        for (const [id, queue] of consumers) {
          if (!consumers.has(id) || queue.cleaned || queue.done) continue;
          queue.push(item);
        }
      }
      ended = true;
      for (const queue of consumers.values()) queue.finish();
      closedResolve();
    } catch (error) {
      ended = true;
      for (const queue of consumers.values()) queue.fail(error);
      closedReject(error);
    }
  };

  producerPromise = run();

  const api = {
    streams,
    closed,
    subscribe: name => subscribe(name),
    subscribeAfterSeq: (name, seq) => subscribe(name, seq),
    async close() {
      if (ended) return;
      try {
        await producerIterator.return?.();
      } catch {
        // The producer's terminal error is reported through closed.
      }
      await producerPromise.catch(() => {});
    },
  };

  return api;
}
