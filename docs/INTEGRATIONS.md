# Live Voice Agent integrations

Live Voice Agent is the attachable, session-safe voice layer in this
repository. Connect a harness adapter to reuse VoiceCore's wake gating,
spoken-block parsing, TTS echo guard, interruption handling, and bounded
re-arm behavior. Wake is **헤이 자비스** / **hey jarvis**.

Hermes is one optional adapter. Codex CLI, Claude Code, and Paseo are
implemented as prompt brains (`--brain`), not as native microphone apps.
Orca is still planned.

## Why attach a voice bridge?

Common pain points are concrete rather than model-specific:

- A coding agent can produce streamed text, but it has no consistent spoken
  turn boundary or short TTS payload.
- A focused terminal, worktree, or chat tab can change while late events from
  the previous session are still in flight.
- Speech during generation or playback needs an explicit barge-in submission,
  not a second prompt accidentally routed to another session.
- Wake phrases, filler/noise, TTS echo, and post-reply continuation cues need
  one reusable policy instead of one copy per harness.
- Plugin reloads and session teardown must release timers, subscriptions, mic
  capture, and TTS handles without leaving a live listener behind.

Useful target workflows include hands-free coding-agent follow-ups, short spoken
status updates while watching a worktree, interruption of a long response, and
one voice control surface shared by desktop, terminal, or mobile harnesses.

## Truthful support matrix

| Harness | Status here | Public evidence and boundary |
| --- | --- | --- |
| Hermes | **Supported: real adapter** | `src/adapters/hermes.js` maps Hermes plugin RPCs and `RpcEvent`; this is the only production adapter in v0.1. |
| Paseo | **Planned: contract/template only** | [Paseo plugin reference](https://paseo.sh/docs/plugins/reference) documents `@paseo/plugin`, `PluginContext`, and `plugin.handle` RPC handlers. That plugin/RPC seam is not the six-capability native voice contract required here. |
| Codex CLI | **Planned: contract/template only** | [Codex plugins](https://help.openai.com/en/articles/20001256-plugins-in-codex) and [Codex MCP support](https://github.com/openai/codex/blob/main/codex-rs/README.md#model-context-protocol-support) provide extension/MCP surfaces. This project does not claim a public Codex CLI microphone or TTS seam. |
| Claude Code | **Planned: contract/template only** | [Claude Code plugins](https://code.claude.com/docs/en/plugins) support shareable skills, agents, hooks, and MCP; [hooks](https://code.claude.com/docs/en/hooks-guide) expose lifecycle events. Those public seams do not by themselves provide native mic capture/TTS for this bridge. |
| Orca | **Planned: contract/template only** | [Orca agent sessions](https://www.onorca.dev/docs/model/agents-sessions) document launch, work, idle, and exit lifecycle. Public docs expose agent session lifecycle, not a public voice/audio seam for capture, TTS, and per-session prompt submission. |

Paseo may have product-level voice control, but this matrix is about a public
plugin adapter seam that can safely supply per-session capture, TTS, events, and
prompt submission. Native voice capture/TTS is not available from the latter
public seams yet, so no future harness is labeled supported.

## Adapter requirements

`createVoiceBridge(adapter)` requires the dependency-free
`AgentHarnessAdapter` contract:

```js
{
  getSessionId() -> string | null,
  toggle(action: 'on' | 'off') -> Promise | void,
  record(action: 'start' | 'stop', sessionId) -> Promise | void,
  speak(text) -> Promise | void,
  submit({ session_id, text, interrupted? }) -> Promise | void,
  subscribe(type, callback) -> disposer
}
```

The adapter must normalize these events to
`{ type, sessionId, payload }` and preserve the session id:

`voice.transcript`, `voice.status`, `wake.detected`, `message.start`,
`message.delta`, `message.interim`, `message.complete`, and
`voice.interrupted`.

Lifecycle requirements are strict:

1. Resolve a focused session and reject start when there is none.
2. Await `toggle('on')`, then start recording for that same session.
3. Route no event whose `sessionId` differs from the active session.
4. Stop recording before submitting a prompt or ending a session.
5. Make every disposer idempotent and release streams, timers, TTS handles,
   and listeners on `dispose`.
6. Keep audio/transcript data out of logs and preserve `interrupted: true` for
   meaningful speech during generation or playback.

The normalized payload shapes and failure checklist are in
[ADAPTERS.md](ADAPTERS.md). The copy-paste transport skeleton is in
[HARNESS_ADAPTER_TEMPLATE.md](HARNESS_ADAPTER_TEMPLATE.md).

## Generic recipe

```js
import { createVoiceBridge } from 'hermes-live-voice'

const bridge = createVoiceBridge(adapter, {
  onStatus: state => renderVoiceState(state),
  onError: (error, operation) => reportVoiceFailure(operation, error)
})

await bridge.start(adapter.getSessionId())
// adapter emits normalized events; bridge owns dispatch and session checks.
await bridge.stop()
await bridge.dispose()
```

The adapter owns the harness transport. The bridge owns VoiceCore construction,
event subscriptions, session ownership, and async lifecycle; do not duplicate
event wiring in a desktop, CLI, or MCP wrapper.

## Hermes recipe

The implemented path is intentionally small:

```js
import { createHermesAdapter } from './src/adapters/hermes.js'
import { createVoiceBridge } from './src/bridge.js'

const adapter = createHermesAdapter(host)
const bridge = createVoiceBridge(adapter)
await bridge.start(adapter.getSessionId())
```

Hermes remains the only adapter whose public session, recording, TTS, submit,
and event RPC mapping is implemented and tested in this repository.

## Future harness recipes

### Paseo plugin/RPC candidate

Paseo's documented plugin shape can host a future adapter, but the following is
only a seam-mapping template. It does not claim that `voice.capture` or
`voice.tts` exist:

```ts
import type { PluginContext } from '@paseo/plugin'

// Define voiceEventContract with Paseo's documented defineRpc/Zod shape first.
export default function contribute(plugin: PluginContext) {
  plugin.handle(voiceEventContract, async () => {
    // Map only documented Paseo workspace/agent/session events here.
    // Add mic/TTS calls only after Paseo publishes those public methods.
  })
  return () => undefined
}
```

### Claude Code or Codex CLI sidecar

Plugins, hooks, and MCP can start or connect a sidecar, but the sidecar still
needs a documented native audio and session transport before it can construct
an adapter:

```js
const adapter = createExampleAdapter({
  getSessionId: () => sidecar.focusedSessionId(),
  toggle: action => sidecar.voiceToggle(action),
  record: (action, sessionId) => sidecar.voiceRecord(action, sessionId),
  speak: text => sidecar.voiceSpeak(text),
  submit: payload => sidecar.submitPrompt(payload),
  subscribe: (type, callback) => sidecar.onNormalized(type, callback)
})
```

Every placeholder must be replaced with a documented public API and an
integration test before the status can move from planned.

### Orca lifecycle bridge

Orca's launch/work/idle/exit lifecycle can provide session bookkeeping for a
future adapter. It is not a voice adapter: do not infer microphone, TTS, or
prompt-submit authority from terminal status or OSC titles. Add the six
capabilities only when Orca documents those public seams.

## What would make an adapter supported?

An adapter PR must include public API references, permission/privacy behavior,
session ownership mapping, start/stop/dispose cleanup, stale-event rejection,
interruption behavior, and a deterministic end-to-end check. Until then,
label it planned/community and keep the generic bridge usable without it.
