# Roadmap

## v0.1

- Hermes Agent public RPC adapter
- portable marker protocol and harness-neutral core

## v0.2 — Always-on loop

- `createAlwaysOn()`, local mic/`say`, 헤이 자비스
- `npx live-voice-agent demo|live|doctor`

## v0.3 — Clients, STT, protocols

- Brains: echo, Codex, Claude Code, OpenCode, Gemini CLI, Paseo, OpenAI, OpenRouter, Orca CLI, ACP
- STT: silence, Voicebox, whisper-cli, OpenAI, Groq, ElevenLabs Scribe, Deepgram nova-3
- Protocol helpers: OpenAI chat/transcriptions, ACP JSON-RPC, A2A Agent Card, AG-UI events
- npm: `live-voice-agent@0.2.0` as `dvdv_k`

## v0.2.1

- doctor lists avfoundation mics and probes a live pipe capture
- ffmpeg mic start waits for first PCM or fails with MIC_DENIED
- live logs STT/brain and engine errors

## Later, only with a real public seam

- Full ACP editor host
- Bundled Moonshine / Parakeet / SenseVoice weights
- AEC and loudspeaker barge-in
- openWakeWord `hey_jarvis` ONNX sidecar
