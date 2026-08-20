# Roadmap

## v0.1

- Hermes Agent public RPC adapter
- portable marker protocol and harness-neutral core

## v0.2 — Always-on loop

- `createAlwaysOn()`, local mic/`say`, 헤이 자비스
- `npx live-voice-agent demo|live|doctor`

## v0.3 — Clients, STT, protocols (this tag)

- Brains: echo, Codex, Claude Code, OpenCode, Gemini CLI, Paseo, OpenAI, OpenRouter, Orca CLI, ACP
- STT: silence, Voicebox, whisper-cli, OpenAI, Groq, ElevenLabs Scribe, Deepgram nova-3
- Protocol helpers: OpenAI chat/transcriptions, ACP JSON-RPC, A2A Agent Card, AG-UI events
- MCP stays inside those CLIs. This package does not host MCP.

## Later, only with a real public seam

- Full ACP editor host
- Full A2A mesh runtime
- Full AG-UI frontend
- Bundled Moonshine / Parakeet / SenseVoice weights
- AEC and loudspeaker barge-in
- npm publish (blocked here by missing npm login)
