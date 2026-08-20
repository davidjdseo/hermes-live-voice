# Live Voice Agent

[![CI](https://github.com/davidjdseo/hermes-live-voice/actions/workflows/ci.yml/badge.svg)](https://github.com/davidjdseo/hermes-live-voice/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/davidjdseo/hermes-live-voice/blob/main/LICENSE)

A live spoken assistant loop you can attach to any agent harness.
Hermes is one adapter. Paseo, Codex CLI, Claude Code, and Orca plug in
through the same six-method contract when they expose a public voice seam.

```bash
npx live-voice-agent demo
```

Type a line. Hear a spoken-style reply. No API key, no microphone required
for the demo. Swap `ask()` for your agent when you want the real brain.

The GitHub slug is still `hermes-live-voice` until the repository is
renamed. The npm package name is `live-voice-agent`.

This is not a new STT/TTS model and not a claim that every listed harness
already has a native microphone. Planned adapters refuse to pretend.

## Inspired by GPT Live-style interaction

This project is inspired by the interaction pattern popularized by ChatGPT
Advanced Voice Mode and the
[OpenAI Realtime API announcement](https://openai.com/index/introducing-the-realtime-api),
as well as the broader “GPT Live” idea: natural low-latency spoken turns,
interruptions, and conversational flow.

That is inspiration, not affiliation or endorsement. This project does
not claim OpenAI protocol or API compatibility and does not use an OpenAI
realtime model.

## Attachable via adapters

An agent harness only needs six capabilities for an adapter:

1. Return the focused session id.
2. Toggle voice input on or off.
3. Start or stop microphone recording for a session.
4. Speak text through the harness TTS path.
5. Submit a prompt to a session, including an interruption marker when needed.
6. Subscribe to and unsubscribe from normalized session events.

| Target | Status | Boundary |
| --- | --- | --- |
| Generic `createVoiceBridge` | Implemented | Reusable VoiceCore construction, event dispatch, session ownership, and lifecycle. |
| `createPromptAdapter` | Implemented | Drop in `ask(text)` and the loop speaks. No keys in this library. |
| Hermes Agent | Implemented | Production adapter using public RPCs and `RpcEvent`. Optional. |
| Paseo, Codex CLI, Claude Code, Orca | Planned | Factories exist and throw until a public mic/TTS/session seam is verified. |

The adapter contract and authoring rules are in
[docs/ADAPTERS.md](docs/ADAPTERS.md). A copy-paste starting point is
[docs/HARNESS_ADAPTER_TEMPLATE.md](docs/HARNESS_ADAPTER_TEMPLATE.md), and the
small executable example is [`src/adapters/example.js`](src/adapters/example.js).

```js
import { createExampleAdapter } from './src/adapters/example.js'

const adapter = createExampleAdapter({
  getSessionId: () => harness.focusedSessionId(),
  toggle: action => harness.setMicEnabled(action === 'on'),
  record: (action, sessionId) => harness.record(action, sessionId),
  speak: text => harness.tts(text),
  submit: payload => harness.submitPrompt(payload),
  subscribe: (type, callback) => harness.on(type, event => callback({
    type,
    sessionId: event.session_id,
    payload: event.payload ?? event
  }))
})
```

The snippet is a contract-shaped pseudo-integration: it does not claim that
any listed future harness currently exposes those public methods.

The package entry point is the always-on loop:

```js
import { createAlwaysOn } from 'live-voice-agent/always-on'
import { createPromptAdapter } from 'live-voice-agent/adapters/prompt'

const assistant = createAlwaysOn({
  engines,
  backend: createPromptAdapter({
    ask: async (text) => yourAgent(text),
  }),
})
await assistant.start()
```

The older bridge entry still works:

```js
import { createVoiceBridge } from 'live-voice-agent'

const bridge = createVoiceBridge(adapter)
await bridge.start(sessionId)
await bridge.stop()
await bridge.dispose()
```

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for pain points, exact
requirements, official seam evidence, and future-harness recipes.

## Always-on layer (optional)

`createAlwaysOn()` is an optional supervisor that owns capture, wake word,
VAD, STT, and TTS engines while reusing `VoiceCore` for session gates
(wake, echo, continue, barge-in). The JS core stays dependency-free. Heavy
engines (openWakeWord, faster-whisper, kokoro-onnx) live in a Python sidecar
that you opt into.

```js
import { createAlwaysOn } from 'live-voice-agent/always-on'

const assistant = createAlwaysOn({ engines, backend })
assistant.on('wake', () => {})
assistant.on('utterance', text => {})
assistant.on('interrupted', () => {})
await assistant.start()
```

Custom engines are the supported path today. A sidecar client
(`live-voice-agent/always-on/sidecar`) speaks JSONL over stdio; the
reference Python engine is not shipped in this tag. Design notes:
[docs/ALWAYS_ON_DESIGN.md](docs/ALWAYS_ON_DESIGN.md). Copy-paste examples:
[`examples/always-on-custom.js`](examples/always-on-custom.js),
[`examples/always-on-python.js`](examples/always-on-python.js).

## Protocol

Every written assistant response remains complete and ends with exactly one
closed Korean block:

```text
<<<VOICE 지호, 확인했습니다. 다음으로 진행할까요? VOICE>>>
```

Only that block reaches TTS. It is conversational, normally under five short
sentences, states the result and one next action, and asks at most one short
question with no more than A/B/C choices. It contains no lists, code, logs,
paths, or reflection. Runtime clamps spoken output to the first five
non-empty sentences; the written body remains untouched. See
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Architecture

```text
written model response
          │ message.delta/interim/complete
          ▼
adapter ── event normalization + session ownership ──┐
                                                       ▼
                                                 VoiceCore
                                        parse · gate · echo · timer
                                                       │
                  ┌────────────────────────────────────┼──────────────┐
                  ▼                                    ▼              ▼
             voice.record                         voice.tts     prompt.submit
```

`VoiceCore` has no Hermes imports. `createVoiceBridge` owns its construction,
normalized event dispatch, session ownership, and async lifecycle. A small
`AgentHarnessAdapter` contract defines session lookup, voice/request verbs,
submission, and normalized event subscription. Hermes is implemented in
`src/adapters/hermes.js`; the dependency-free example shape is in
`src/adapters/example.js`.

## Quickstart

Requires a local Hermes backend with microphone access. OAuth remote sessions
do not provide that local microphone path.

### macOS microphone troubleshooting

Hermes `voice.record` currently uses the CoreAudio process default input.
`wake_word.input_device` can explicitly select the MacBook Pro microphone, but
there is no `voice.input_device` setting in this plugin contract. If a virtual
device is the default input, voice recording can report RMS 0 even while wake
word detection works. In macOS System Settings → Sound → Input, select a real
microphone as the default input. `SwitchAudioSource` can automate that switch,
but it is optional and is not a project dependency.
After changing the CoreAudio default input, restart Hermes Desktop because an
already-running voice process may retain the previously opened device.

```sh
git clone https://github.com/davidjdseo/hermes-live-voice.git
cd hermes-live-voice
python3 scripts/install.py
```

For development or an already-configured SOUL, use
`python3 scripts/install.py --link --skip-soul`; it still timestamps backups and
performs config, doctor, and enable steps. The default copy install is safer
for normal use.

The installer backs up existing config/SOUL files, requests
`voice.auto_tts=false`, sets `voice.barge_in=true` and `stt.enabled=true`, runs
`hermes plugins doctor --ci`, then enables the plugin. Native read-aloud can
still make the live Hermes config report `voice.auto_tts=true`; this README
does not change installer behavior. The installer never reads or prints `.env`
or secrets. Copy mode is `python3 scripts/install.py`; inspect all commands
first with `python3 scripts/install.py --dry-run`.

On macOS, Hermes Desktop scans only real directories. Link mode therefore keeps
the agent symlink and also creates a managed real
`~/.hermes/desktop-plugins/hermes-live-voice/` directory whose `plugin.js`
symlinks to this checkout. Copy mode does not create that duplicate shim.

In Hermes Desktop, select a fresh chat session, open the Live Voice pane, press
Start, then use Command Palette → **Reload desktop plugins** after rebuilding:

```sh
npm run build
```

The plugin uses a global runtime disposer, so reload removes old event listeners
and timers. Stop with `python3 scripts/uninstall.py`; it disables the plugin,
backs up SOUL, and removes only its managed block and install target.

## Demo conversation

Written body: “오늘 일정에서 오전 회의는 10시로 확인했습니다.
캘린더를 더 확인할까요?”

Spoken block: `<<<VOICE 지호, 오전 회의는 10시로 확인했습니다.
더 확인할까요? VOICE>>>`

User: “헤이 헤르메스 오후 일정도 봐줘.”

The wake prefix is stripped, the command is submitted to the selected session,
and meaningful speech during generation/playback is submitted with
`interrupted: true`.

While Live Voice is on, saying the wake phrase and command in one utterance is
the fastest and recommended path, such as `헤이 헤르메스, 날씨 알려줘`.

A bare `헤이 헤르메스` wake answers `네, 말씀하세요.` and then listens. It
clears the after-reply gate and re-arms the recorder through the same single
bounded pending timer used by idle status. It does not submit an empty prompt;
filler/noise and unapproved post-reply speech remain ignored.

## Privacy and limitations

Audio/transcripts use Hermes’ existing local voice engine and public RPCs; this
plugin does not persist audio, secrets, or remote account data. There is no
true acoustic AEC. Bounded playback timing and Korean character/edit
similarity only reduce likely TTS echo and room noise; headphones or physical
mic/speaker separation may still be needed. Playback speed is not assumed
because no public Hermes speed API is used; the duration is a bounded heuristic.
The re-arm estimate is an empirical conservative heuristic of about seven
Korean characters per second plus an 800 ms drain buffer, clamped to 30 seconds;
it is not a playback-completion signal.

## Development and contribution

```sh
npm test
npm run build
node --check desktop/plugin.js
python3 -m py_compile scripts/install.py scripts/uninstall.py __init__.py
python3 -m unittest discover -s tests -p 'test_*.py'
hermes plugins doctor --ci .
git diff --check
```

Contribution areas are new public-seam adapters, deterministic core tests,
Korean/English speech edge cases, accessibility, and documentation. Read
[CONTRIBUTING.md](CONTRIBUTING.md), [ROADMAP.md](ROADMAP.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). No popularity or user-count claims
are made.
