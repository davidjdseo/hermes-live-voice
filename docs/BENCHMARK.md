# What we copied from popular voice-agent OSS

This project stays small. We borrowed product moves, not their stacks.

| Project | Why people star it | What we took |
| --- | --- | --- |
| LiveKit Agents | One-file agent, pluggable STT/LLM/TTS | Engine contracts + `npx live-voice-agent live` |
| Pipecat | `init` / doctor / honest extras | `doctor` command, optional brains |
| openWakeWord Jarvis clones | Wake is `hey jarvis` | Default wake: 헤이 자비스 / hey jarvis |
| isair/jarvis | Echo rejection in the transcript loop | Existing TTS echo gate in VoiceCore |
| Project JARVIS / prompt adapters | Library does not own API keys | `ask()` brains; Codex/Claude/Paseo stay outside |

We did not copy LiveKit/Pipecat runtimes. Those are full media servers.
This package is the always-on loop you attach to an agent you already have.
