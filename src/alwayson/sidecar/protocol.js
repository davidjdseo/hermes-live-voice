export function encodeLine(obj) {
  return `${JSON.stringify(obj)}\n`;
}

export function createLineDecoder({ onMessage, onProtocolError, maxLineBytes = 1048576 }) {
  let line = [];
  let size = 0;
  let discarding = false;
  let consecutive = 0;

  const error = (code, details) => onProtocolError?.(code, details);

  const parse = () => {
    if (discarding) return;
    let value;
    try {
      value = JSON.parse(Buffer.from(line).toString('utf8'));
    } catch {
      consecutive++;
      if (consecutive > 10) error('TOO_MANY_BAD_LINES', { consecutive });
      return;
    }
    consecutive = 0;
    onMessage?.(value);
  };

  return {
    push(buffer) {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      for (const byte of bytes) {
        if (byte === 0x0a) {
          parse();
          line = [];
          size = 0;
          discarding = false;
          continue;
        }
        if (discarding) continue;
        size++;
        if (size > maxLineBytes) {
          line = [];
          discarding = true;
          error('LINE_TOO_LARGE');
          continue;
        }
        line.push(byte);
      }
    },
    end() {
      if (size || line.length) {
        line = [];
        size = 0;
        discarding = false;
      }
    },
  };
}
