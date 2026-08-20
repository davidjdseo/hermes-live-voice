# Hermes Live Voice — Portable Voice Orchestration for Agent Harnesses

[![CI](https://github.com/davidjdseo/hermes-live-voice/actions/workflows/ci.yml/badge.svg)](https://github.com/davidjdseo/hermes-live-voice/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/davidjdseo/hermes-live-voice/blob/main/LICENSE)

Hermes Live Voice is a harness-neutral, portable voice orchestration layer for
full-duplex-style spoken turns, barge-in semantics, and conversational flow in
agent products. The generic core is designed to travel through adapters;
Hermes Agent v0.20.4 is the only production adapter in v0.1.

Here, “full-duplex” describes orchestration of overlapping turn states and
barge-in behavior. This project does not provide true acoustic AEC or native
simultaneous model audio. It is useful as a building block for a full-duplex
voice agent or barge-in voice assistant, not as an always-listening AI
assistant by itself.

It is not a new STT/TTS model, an always-listening service, or an IDE plugin
collection. Unsupported harnesses are clearly marked as planned or community
targets below.

## Inspired by GPT Live-style interaction

This project is inspired by the interaction pattern popularized by ChatGPT
Advanced Voice Mode and the
[OpenAI Realtime API announcement](https://openai.com/index/introducing-the-realtime-api),
as well as the broader “GPT Live” idea: natural low-latency spoken turns,
interruptions, and conversational flow.

That is inspiration, not affiliation or endorsement. Hermes Live Voice does
not claim OpenAI protocol or API compatibility and does not use an OpenAI
realtime model.

## Works anywhere via adapters

An agent harness only needs six capabilities for an adapter:

1. Return the focused session id.
2. Toggle voice input on or off.
3. Start or stop microphone recording for a session.
4. Speak text through the harness TTS path.
5. Submit a prompt to a session, including an interruption marker when needed.
6. Subscribe to and unsubscribe from normalized session events.

| Target | Status | Boundary |
| --- | --- | --- |
| Generic `VoiceCore` | Implemented | Harness-neutral session and barge-in logic. |
| Hermes Agent | Implemented | v0.1 production adapter using public RPCs and `RpcEvent`. |
| Orca | Planned / community adapter | Needs a public voice and event/audio seam. |
| Paseo | Planned / community adapter | Needs a public voice/event lifecycle surface. |
| Pi Coding Agent | Planned / community adapter | Best path is an extension or RPC bridge. |
| Claude Code | Planned / community adapter | No adapter is included. |
| Codex CLI | Planned / community adapter | No adapter is included. |
| Cursor | Planned / community adapter | No adapter is included. |
| VS Code | Planned / community adapter | No adapter is included. |
| JetBrains | Planned / community adapter | No adapter is included. |

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

`VoiceCore` has no Hermes imports. A small `AgentHarnessAdapter` contract
defines session lookup, voice/request verbs, submission, and normalized event
subscription. Hermes is implemented in `src/adapters/hermes.js`; the
dependency-free example shape is in `src/adapters/example.js`.

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
