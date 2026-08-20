export async function* chunkClauses(tokenStream, { maxLen = 120 } = {}) {
  const limit = Math.max(1, Number(maxLen) || 120);
  if (typeof tokenStream === 'string') {
    yield* flushText(tokenStream, limit);
    return;
  }

  if (!tokenStream || typeof tokenStream[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('tokenStream must be a string or AsyncIterable<string>');
  }

  let buffer = '';
  for await (const token of tokenStream) {
    const text = String(token ?? '');
    for (const character of text) {
      buffer += character;
      if (/[.!?…\n\r]/u.test(character) || buffer.length >= limit) {
        const clause = buffer.trim();
        if (clause) yield clause;
        buffer = '';
      }
    }
  }

  const clause = buffer.trim();
  if (clause) yield clause;
}

function* flushText(text, maxLen) {
  let buffer = '';
  for (const character of String(text)) {
    buffer += character;
    if (/[.!?…\n\r]/u.test(character) || buffer.length >= maxLen) {
      const clause = buffer.trim();
      if (clause) yield clause;
      buffer = '';
    }
  }
  const clause = buffer.trim();
  if (clause) yield clause;
}
