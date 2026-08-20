# hermes-live-voice

[![CI](https://github.com/davidjdseo/hermes-live-voice/actions/workflows/ci.yml/badge.svg)](https://github.com/davidjdseo/hermes-live-voice/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/davidjdseo/hermes-live-voice/blob/main/LICENSE)

Portable voice protocol + harness-neutral core for agent products. Hermes Agent
v0.20.4 is the only implemented adapter in v0.1; no new STT/TTS model or
unsupported IDE integration is included.

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
Hermes adapter ── RpcEvent unwrap + session ownership ──┐
                                                         ▼
                                                   VoiceCore
                                         parse · gate · echo · timer
                                                         │
                  ┌──────────────────────────────────────┼──────────────┐
                  ▼                                      ▼              ▼
             voice.record                           voice.tts     prompt.submit
```

`VoiceCore` has no Hermes imports. A small `AgentHarnessAdapter` contract
defines session lookup, voice/request verbs, submission, and normalized event
subscription. Hermes is implemented in `src/adapters/hermes.js`; the
dependency-free example shape is in `src/adapters/example.js`. See
[docs/ADAPTERS.md](docs/ADAPTERS.md).

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
but it is optional and not a project dependency.
After changing the CoreAudio default input, restart Hermes Desktop because an already-running voice process may retain the previously opened device.

```sh
git clone https://github.com/davidjdseo/hermes-live-voice.git
cd hermes-live-voice
python3 scripts/install.py
```

For development or an already-configured SOUL, use
`python3 scripts/install.py --link --skip-soul`; it still timestamps backups and
performs config, doctor, and enable steps. The default copy install is safer for
normal use.

The installer backs up existing config/SOUL files, sets
`voice.auto_tts=false`, `voice.barge_in=true`, and `stt.enabled=true`, runs
`hermes plugins doctor --ci`, then enables the plugin. It never reads or prints
`.env` or secrets. Copy mode is `python3 scripts/install.py`; inspect all
commands first with `python3 scripts/install.py --dry-run`.

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

Written body: “오늘 일정에서 오전 회의는 10시로 확인했습니다. 캘린더를 더 확인할까요?”

Spoken block: `<<<VOICE 지호, 오전 회의는 10시로 확인했습니다. 더 확인할까요? VOICE>>>`

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
