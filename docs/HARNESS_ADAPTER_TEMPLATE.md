# Harness adapter template

Copy this file into a harness-specific adapter module, replace the six
harness calls, and run node --check on the resulting plain JavaScript. The
returned object is ready for createExampleAdapter from
[src/adapters/example.js](../src/adapters/example.js).

This template is dependency-free. The harness method names below are
placeholders, not claimed APIs. Replace every one with a documented public API
from the target harness before using the adapter.

~~~js
import { createExampleAdapter } from '../src/adapters/example.js'

export function createHarnessTransport(harness) {
  return {
    getSessionId() {
      return harness.focusedSessionId()
    },

    toggle(action) {
      return harness.setMicEnabled(action === 'on')
    },

    record(action, sessionId) {
      return harness.record(action, sessionId)
    },

    speak(text) {
      return harness.tts(text)
    },

    submit({ session_id, text, interrupted }) {
      return harness.submitPrompt({
        session_id,
        text,
        ...(interrupted ? { interrupted: true } : {})
      })
    },

    subscribe(type, callback) {
      let disposed = false
      const unsubscribe = harness.on(type, event => {
        if (disposed) return
        callback({
          type,
          sessionId: event.session_id ?? event.sessionId ?? null,
          payload: event.payload ?? event
        })
      })

      return () => {
        if (disposed) return
        disposed = true
        unsubscribe?.()
      }
    }
  }
}

export function createHarnessAdapter(harness) {
  return createExampleAdapter(createHarnessTransport(harness))
}
~~~

The harness must provide equivalents for focusedSessionId, setMicEnabled,
record, tts, submitPrompt, and on; these names are illustrative and must be
replaced or mapped. Keep the normalized event names and payloads from
[ADAPTERS.md](ADAPTERS.md). In particular, preserve sessionId, map message
deltas and completion text without rewriting them, and make every disposer
safe to call during stop, reload, or failure cleanup.
