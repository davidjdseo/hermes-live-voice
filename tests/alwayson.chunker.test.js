import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkClauses } from '../src/alwayson/chunker.js';

async function collect(iterable) {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
}

test('chunkClauses splits string input at punctuation', async () => {
  assert.deepEqual(
    await collect(chunkClauses('Hello world. 다음 문장입니다! 잘 지내나요?')),
    ['Hello world.', '다음 문장입니다!', '잘 지내나요?'],
  );
});

test('chunkClauses accepts an async iterable', async () => {
  async function* tokens() {
    yield 'Hello ';
    yield 'world.';
    yield ' 다음';
    yield ' 문장입니다!';
  }

  assert.deepEqual(
    await collect(chunkClauses(tokens())),
    ['Hello world.', '다음 문장입니다!'],
  );
});

test('chunkClauses flushes on newline and ellipsis', async () => {
  async function* tokens() {
    yield '첫 문장…';
    yield '\n둘째 문장';
  }

  assert.deepEqual(
    await collect(chunkClauses(tokens())),
    ['첫 문장…', '둘째 문장'],
  );
});

test('chunkClauses forcibly splits clauses at maxLen', async () => {
  assert.deepEqual(
    await collect(chunkClauses('abcdefghij', { maxLen: 3 })),
    ['abc', 'def', 'ghi', 'j'],
  );
});

test('chunkClauses ignores empty input and whitespace-only clauses', async () => {
  assert.deepEqual(await collect(chunkClauses('')), []);
  assert.deepEqual(await collect(chunkClauses('   \n  ')), []);
});

test('chunkClauses handles mixed Korean and English text', async () => {
  assert.deepEqual(
    await collect(chunkClauses('안녕하세요. Hello! 오늘은 테스트입니다?')),
    ['안녕하세요.', 'Hello!', '오늘은 테스트입니다?'],
  );
});
