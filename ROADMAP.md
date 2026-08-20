# Roadmap

## v0.1

- Hermes Agent v0.20.4 public RPC adapter
- portable marker protocol and harness-neutral core
- Agent Voice Bridge package entrypoint with reusable lifecycle/event dispatch
- deterministic session, echo, interruption, and re-arm tests

## v0.2 — Always-on layer

- `createAlwaysOn()` supervisor over `VoiceCore`
- five engine contracts plus local mic/`say` engines
- JSONL sidecar protocol + JS client
- `createPromptAdapter({ ask })` and CLI brains (echo, Codex, Claude, Paseo)
- `npx live-voice-agent demo|live|doctor`
- wake phrase: 헤이 자비스 / hey jarvis
- Orca remains planned: no public prompt+event voice seam yet

Not in this tag: a shipped Python ONNX engine, AEC, speech-to-speech
passthrough, or barge-in on loudspeakers.

## Later, only with a real public seam

- Orca adapter if a public session prompt+event API lands
- measured speech-duration calibration
- accessibility review of the native pane
- optional openWakeWord `hey_jarvis` sidecar

No IDE integration, remote audio service, new model, or framework is planned
without a concrete supported API and a testable user need.
