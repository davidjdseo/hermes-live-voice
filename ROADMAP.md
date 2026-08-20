# Roadmap

## v0.1

- Hermes Agent v0.20.4 public RPC adapter
- portable marker protocol and harness-neutral core
- Agent Voice Bridge package entrypoint with reusable lifecycle/event dispatch
- deterministic session, echo, interruption, and re-arm tests

## v0.2 — Always-on layer (in tree)

- `createAlwaysOn()` supervisor over `VoiceCore` (`live-voice-agent/always-on`)
- five engine contracts: AudioSource, WakewordEngine, VadEngine, STTEngine, TTSEngine
- JSONL sidecar protocol + JS client (`live-voice-agent/always-on/sidecar`)
- `createPromptAdapter({ ask })` so any agent can speak without a harness SDK
- `npx live-voice-agent demo` typed always-on loop
- planned Paseo / Codex CLI / Claude Code / Orca adapters that refuse fake seams
- fake-engine state-machine tests and protocol conformance tests
- examples under `examples/`

Not in this tag: a shipped Python reference engine, AEC, speech-to-speech
passthrough, or any claim that barge-in works on loudspeakers.

## Later, only with a real public seam

- additional harness adapters with explicit approval/session contracts;
- measured speech-duration calibration;
- accessibility review of the native pane.

## Community adapter milestones

These are targets, not support claims. Each adapter remains planned/community
until its public seam and acceptance checks are verified.

- Paseo, Codex CLI, Claude Code, and Orca adapters: document the public
  session/event/audio seam; map each harness lifecycle without cross-session
  routing; verify start/stop, interruption, stale-event rejection,
  permissions, cleanup, and a focused integration check. Their current public
  extension/session seams do not yet establish the required native microphone
  and TTS contract.

No IDE integration, remote audio service, new model, or framework is planned
without a concrete supported API and a testable user need.
