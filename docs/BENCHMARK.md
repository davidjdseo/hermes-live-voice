# What we copied from popular voice-agent OSS

Evidence date: 2026-08-21. Stars from GitHub pages that day.

| Project | Stars | Why people use it | What we verified | What we took | What we did not copy |
| --- | --- | --- | --- | --- | --- |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | 14,325 | Python pipeline of swappable STT/LLM/TTS; `pipecat init` in under a minute | Daily-maintained, BSD-2, transport-agnostic | `doctor`, honest extras, pluggable engines | Media server / WebRTC runtime |
| [LiveKit Agents](https://github.com/livekit/agents) | 13,088 | One-file agent; `python myagent.py console` for local mic | Apache-2.0, WebRTC rooms, semantic turn detection | One-command local loop (`live`) | LiveKit server, telephony, room model |
| [openWakeWord](https://github.com/dscripka/openWakeWord) | 2,700 | `hey jarvis` pretrained; 80 ms frames; HA community | Apache-2.0, English-only pretrained | Default wake: 헤이 자비스 / hey jarvis | Bundled ONNX weights (optional later) |
| [wyoming-satellite](https://github.com/rhasspy/wyoming-satellite) | ~930 | Mic as a satellite; stream only after wake/VAD | JSONL + PCM, HA auto-discovery | JSONL sidecar already in this repo | Home Assistant protocol host |
| isair/jarvis | — | Echo rejection in the transcript loop | Existing VoiceCore echo gate | Keep echo gate | Full assistant app |

This package is the always-on loop you attach to an agent you already have.
It is not a LiveKit/Pipecat replacement.

## Measured on this Mac (2026-08-21)

- ffmpeg avfoundation audio: `[0] MacBook Pro 마이크`
- pipe capture: first PCM chunk in ~0.81s, live RMS ~0.012
- Voicebox `127.0.0.1:17493` healthy (MLX)
- `say -v Yuna` available (ko_KR)
- ffmpeg `-t` file capture truncates (buffering). Streaming `pipe:1` is the real path.
