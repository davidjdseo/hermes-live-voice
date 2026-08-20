# Agent harness adapters

VoiceCore is transport-independent. `createVoiceBridge` is the reusable
boundary that constructs VoiceCore, owns normalized event dispatch and session
ownership, and exposes async start/stop/dispose. An AgentHarnessAdapter is the
small transport boundary between this project and a voice-capable agent
harness. Hermes is the only production adapter in v0.1; every other target is
planned or community work.

## Contract

An adapter must provide exactly these six capabilities:

~~~js
{
  getSessionId() -> string | null,
  toggle(action: 'on' | 'off') -> Promise | void,
  record(action: 'start' | 'stop', sessionId) -> Promise | void,
  speak(text) -> Promise | void,
  submit({ session_id, text, interrupted? }) -> Promise | void,
  subscribe(type, callback) -> disposer
}
~~~

src/adapters/contract.js checks the six function names. It deliberately does
not pretend that all harnesses have the same transport, permissions, or audio
format. The adapter owns those details and returns normalized events to
VoiceCore.

### Semantics

- getSessionId() returns the currently focused, prompt-addressable session.
  Return null when no session is selected; never invent a session id.
- toggle('on' | 'off') enables or disables the harness voice path. It is not
  a substitute for recording a particular session.
- record('start' | 'stop', sessionId) controls microphone capture for that
  session. Stop the old session before switching ownership.
- speak(text) sends only the already-approved spoken text to the harness TTS
  path. It must not persist or rewrite the text.
- submit({ session_id, text, interrupted }) submits text to the same session.
  Preserve interrupted: true when speech arrives during generation or
  playback; omit it otherwise.
- subscribe(type, callback) maps a harness event into
  { type, sessionId, payload }. The returned disposer must be safe to call
  more than once.

The six capabilities are the minimum seam, not a promise that a harness can
provide native duplex audio or an always-open microphone. An adapter must
respect the harness's permission, privacy, and user-activation rules.

## Normalized events

Subscribe using these names and preserve the session id on every event.

| Event | Required payload | Meaning |
| --- | --- | --- |
| voice.transcript | { text } | Recognized microphone text. |
| voice.status | { state } | Voice/recording state such as idle, ready, or done. |
| wake.detected | {} or harness wake payload | Wake phrase or equivalent activation. |
| message.start | { id? , turn_id? } | A new assistant turn began. |
| message.delta | { delta? , text? } | Incremental assistant text. |
| message.interim | { text? , interim? } | Non-final assistant text update. |
| message.complete | { id? , turn_id? , text } | Final assistant text for a turn. |
| voice.interrupted | { text? , transcript? } | Speech captured during generation or playback. |

A normalized event is:

~~~js
{
  type: 'message.complete',
  sessionId: 'session-123',
  payload: { id: 'turn-7', text: '...' }
}
~~~

The core accepts id or turn_id for turn identity. message.delta may use delta
or text; message.interim may use text or interim; voice.interrupted may use
text or transcript. Keep payloads JSON-like and do not leak provider
credentials, raw microphone buffers, or unbounded private metadata into the
normalized event.

## Lifecycle and ownership

The host should register the adapter and event subscriptions before a user can
start a voice session.

Start ordering:

1. Resolve getSessionId().
2. Reject start when it returns null.
3. Call toggle('on') and await it when it is asynchronous.
4. Call record('start', sessionId).
5. Deliver only events whose sessionId equals the active session id.

During a turn, stop recording before submit. On interruption, submit the
recognized text with interrupted: true; do not submit empty or echo-like
transcripts.

Stop ordering:

1. Cancel pending adapter-owned timers and stop record('stop', sessionId).
2. Call toggle('off').
3. Dispose every event subscription.
4. Release harness listeners, streams, and handles owned by the adapter.

Switching sessions is a stop/start boundary: stop recording and discard late
events from the old session, then reset turn identity before accepting events
from the new session. The adapter must not route a response from one session
into another.

### Errors and cleanup

- Reject or surface failed transport calls; do not report success on a timeout
  or rejected promise.
- Keep cleanup idempotent. A failed toggle('off') must not prevent listener
  disposal.
- Do not leave microphone streams, TTS handles, timers, or event listeners
  alive after stop, reload, or adapter failure.
- Avoid logging transcript/audio content by default. Redact session metadata
  that could identify a user when diagnostics are enabled.
- Treat permission denial, unavailable audio, missing focused session, and
  stale session events as normal failure states with actionable status.
- Do not add a harness-specific fallback command unless its public API and
  test are documented.

## Author checklist

- [ ] Map all six functions to documented public harness APIs.
- [ ] Normalize the event names and payloads above.
- [ ] Preserve session ownership and reject stale events.
- [ ] Await start/stop operations in the lifecycle order.
- [ ] Make unsubscribe and failure cleanup idempotent.
- [ ] Add tests for interruption, session switching, missing session, and cleanup.
- [ ] Document permissions, privacy, audio ownership, and unsupported seams.
- [ ] Mark the adapter planned/community until it is merged and verified.

## Target-specific guidance

### Orca

Orca's CLI manages worktrees, terminals, and agents, and can launch known agent
ids including pi. A voice adapter should not infer a voice contract from
those management features. It still needs a public event/audio seam for
session events, microphone control, TTS, and prompt submission. Do not publish
command examples or a support claim until that seam exists and is tested.

Acceptance checklist:

- [ ] Identify a public focused-session id and lifecycle event source.
- [ ] Identify public microphone toggle/record, TTS, and prompt-submit surfaces.
- [ ] Map worktree/terminal/agent lifecycle without routing across sessions.
- [ ] Verify late-event rejection, interruption, permission errors, and cleanup.
- [ ] Keep the status planned/community until the adapter works against a
      documented public seam.

### Paseo

Paseo manages workspaces, agents, and terminals. A voice adapter should bridge
its agent/session lifecycle only when public voice and event surfaces exist.
Workspace or terminal management alone is not a voice integration, so no
speculative command examples belong here.

Acceptance checklist:

- [ ] Identify the public workspace-to-agent/session ownership mapping.
- [ ] Identify public voice input, TTS, prompt-submit, and event subscription
      surfaces.
- [ ] Map workspace/agent/terminal teardown to idempotent adapter cleanup.
- [ ] Verify session switching, stale events, interruption, and privacy
      boundaries.
- [ ] Keep the status planned/community until public voice/event surfaces and
      tests are available.

### Pi Coding Agent

Pi is a minimal extensible agent harness with extensions and RPC/SDK modes. The
best adapter path is an extension or RPC bridge that exposes the six contract
capabilities and normalizes Pi session events. Do not assume an extension or
RPC surface is already a voice API.

Acceptance checklist:

- [ ] Choose an extension or RPC/SDK bridge and document its public lifecycle.
- [ ] Map Pi session identity, turn events, microphone control, TTS, and
      prompt submission.
- [ ] Define ownership and cleanup for extension/RPC handles.
- [ ] Test interruption, session switching, permission failures, and no
      transcript/audio leakage.
- [ ] Keep the status planned/community until a tested bridge is published.

See the dependency-free [example adapter](../src/adapters/example.js) and the
[copy-paste template](HARNESS_ADAPTER_TEMPLATE.md).
