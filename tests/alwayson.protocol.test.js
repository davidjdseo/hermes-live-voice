import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineDecoder, encodeLine } from '../src/alwayson/sidecar/protocol.js';

test('createLineDecoder parses normal JSONL lines', () => {
  const messages = [];
  const decoder = createLineDecoder({
    onMessage: message => messages.push(message),
  });

  decoder.push(Buffer.from('{"type":"one"}\n{"value":2}\n'));

  assert.deepEqual(messages, [{ type: 'one' }, { value: 2 }]);
});

test('createLineDecoder skips invalid JSON lines', () => {
  const messages = [];
  const errors = [];
  const decoder = createLineDecoder({
    onMessage: message => messages.push(message),
    onProtocolError: code => errors.push(code),
  });

  decoder.push(Buffer.from('not json\n{"valid":true}\n'));

  assert.deepEqual(messages, [{ valid: true }]);
  assert.deepEqual(errors, []);
});

test('createLineDecoder reports TOO_MANY_BAD_LINES after eleven invalid lines', () => {
  const errors = [];
  const decoder = createLineDecoder({
    onProtocolError: code => errors.push(code),
  });

  decoder.push(Buffer.from(`${'bad\n'.repeat(11)}`));

  assert.equal(errors.filter(code => code === 'TOO_MANY_BAD_LINES').length, 1);
});

test('createLineDecoder reports an oversized one megabyte line and parses the next line', () => {
  const messages = [];
  const errors = [];
  const decoder = createLineDecoder({
    onMessage: message => messages.push(message),
    onProtocolError: code => errors.push(code),
  });

  decoder.push(Buffer.alloc(1048577, 0x61));
  decoder.push(Buffer.from('\n{"after":"large-line"}\n'));

  assert.equal(errors.includes('LINE_TOO_LARGE'), true);
  assert.deepEqual(messages, [{ after: 'large-line' }]);
});

test('createLineDecoder assembles lines split across chunk boundaries', () => {
  const messages = [];
  const decoder = createLineDecoder({
    onMessage: message => messages.push(message),
  });

  decoder.push(Buffer.from('{"hello":"한'));
  decoder.push(Buffer.from('글","n":1}\n'));

  assert.deepEqual(messages, [{ hello: '한글', n: 1 }]);
});

test('encodeLine round-trips through createLineDecoder', () => {
  const value = {
    type: 'event',
    text: '안녕하세요',
    nested: { ok: true },
  };
  const messages = [];
  const decoder = createLineDecoder({
    onMessage: message => messages.push(message),
  });

  decoder.push(Buffer.from(encodeLine(value)));

  assert.deepEqual(messages, [value]);
  assert.equal(encodeLine(value).endsWith('\n'), true);
});
