# Agent harness adapters

`VoiceCore` is transport-independent. An `AgentHarnessAdapter` is the small
boundary that supplies:

```js
{
  getSessionId() -> string | null,
  toggle(action: 'on' | 'off') -> Promise | void,
  record(action: 'start' | 'stop', sessionId) -> Promise | void,
  speak(text) -> Promise | void,
  submit({ session_id, text, interrupted? }) -> Promise | void,
  subscribe(type, callback: ({ type, sessionId, payload }) => void) -> disposer
}
```

`src/adapters/contract.js` validates the shape. `src/adapters/hermes.js` is the
only production adapter in v0.1; it maps Hermes `RpcEvent` envelopes and public
RPCs. `src/adapters/example.js` is a dependency-free executable shape for
future harness work.

VS Code, JetBrains, Cursor, Claude Code, Codex, and Paseo are not implemented
adapters. They could implement the same contract if they expose an approved
voice/session/event surface; this repository does not claim those integrations.
