import test from 'node:test';
import assert from 'node:assert/strict';
import { createRingBuffer, teeStream } from '../src/alwayson/audio.js';

class PushQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.ended = false;
    this.failure = null;
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

  fail(error) {
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  async next() {
    if (this.items.length) return { value: this.items.shift(), done: false };
    if (this.failure) throw this.failure;
    if (this.ended) return { value: undefined, done: true };
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  async return() {
    this.end();
    return { value: undefined, done: true };
  }
}

const chunk = (seq, length = 1) => ({
  seq,
  pcm: new Int16Array(length).fill(seq),
  sampleRate: 16000,
  ts: seq,
});

test('ring buffer removes oldest samples when capacity is exceeded', () => {
  const ring = createRingBuffer({ capacityMs: 1, sampleRate: 1000 });

  ring.push(chunk(1, 2));
  ring.push(chunk(2, 2));

  const snapshot = ring.snapshot();
  assert.equal(snapshot.reduce((sum, item) => sum + item.pcm.length, 0), 1);
  assert.equal(snapshot[0].seq, 2);
  assert.deepEqual([...snapshot[0].pcm], [2]);
});

test('ring buffer truncates a single chunk larger than capacity', () => {
  const ring = createRingBuffer({ capacityMs: 2, sampleRate: 1000 });

  ring.push(chunk(7, 5));

  const snapshot = ring.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].pcm.length, 2);
  assert.deepEqual([...snapshot[0].pcm], [7, 7]);
});

test('ring buffer snapshot marks every item as preroll', () => {
  const ring = createRingBuffer({ capacityMs: 10, sampleRate: 1000 });
  ring.push(chunk(1, 2));
  ring.push(chunk(2, 2));

  assert.deepEqual(ring.snapshot().map(item => item.preroll), [true, true]);
});

test('teeStream delivers the same source independently to multiple consumers', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, {
    left: { maxChunks: 8 },
    right: { maxChunks: 8 },
  });

  source.push(chunk(1));
  source.push(chunk(2));

  assert.equal((await tee.streams.left.next()).value.seq, 1);
  assert.equal((await tee.streams.left.next()).value.seq, 2);
  assert.equal((await tee.streams.right.next()).value.seq, 1);
  assert.equal((await tee.streams.right.next()).value.seq, 2);

  source.end();
  assert.equal((await tee.streams.left.next()).done, true);
  assert.equal((await tee.streams.right.next()).done, true);
  await tee.closed;
});

test('teeStream drop-oldest keeps the newest queued chunks', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, {
    consumer: { overflow: 'drop-oldest', maxChunks: 2 },
  });

  source.push(chunk(1));
  source.push(chunk(2));
  source.push(chunk(3));
  // The producer is async; give it a turn to drain the source into queues.
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal((await tee.streams.consumer.next()).value.seq, 2);
  assert.equal((await tee.streams.consumer.next()).value.seq, 3);

  source.end();
  await tee.closed;
});

test('teeStream drop-newest discards incoming chunks when full', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, {
    consumer: { overflow: 'drop-newest', maxChunks: 2 },
  });

  source.push(chunk(1));
  source.push(chunk(2));
  source.push(chunk(3));

  assert.equal((await tee.streams.consumer.next()).value.seq, 1);
  assert.equal((await tee.streams.consumer.next()).value.seq, 2);

  source.end();
  await tee.closed;
});

test('teeStream abort-stream fails only the overflowing consumer', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, {
    consumer: { overflow: 'abort-stream', maxChunks: 1 },
  });

  source.push(chunk(1));
  source.push(chunk(2));
  await new Promise(resolve => setTimeout(resolve, 20));

  await assert.rejects(
    tee.streams.consumer.next(),
    error => error.code === 'AUDIO_OVERFLOW',
  );

  source.end();
  await tee.closed;
});

test('teeStream removes a consumer after return and does not push to its queue', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, {
    consumer: { maxChunks: 1 },
  });
  const consumer = tee.streams.consumer;

  await consumer.return();
  source.push(chunk(1));
  source.end();

  assert.deepEqual(await consumer.next(), { value: undefined, done: true });
  await tee.closed;
});

test('subscribeAfterSeq delivers only chunks after the boundary', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, { base: { maxChunks: 8 } });

  source.push(chunk(1));
  source.push(chunk(2));

  const later = tee.subscribeAfterSeq('base', 2);
  source.push(chunk(3));

  assert.equal((await later.next()).value.seq, 3);
  await later.return();

  source.end();
  await tee.closed;
});

test('teeStream finishes every consumer when source ends', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, {
    a: { maxChunks: 4 },
    b: { maxChunks: 4 },
  });

  source.end();
  await tee.closed;

  assert.equal((await tee.streams.a.next()).done, true);
  assert.equal((await tee.streams.b.next()).done, true);
});

test('teeStream propagates source errors', async () => {
  const source = new PushQueue();
  const tee = teeStream(source, { consumer: { maxChunks: 4 } });
  const error = new Error('source failed');

  source.fail(error);

  await assert.rejects(tee.closed, /source failed/);
  await assert.rejects(tee.streams.consumer.next(), /source failed/);
});
