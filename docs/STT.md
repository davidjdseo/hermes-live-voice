# STT engines

Live Voice Agent does not ship model weights. It talks to engines you already run.

| Kind | How | Best for | Key |
| --- | --- | --- | --- |
| `silence` | Energy VAD placeholder | Tests / no ASR yet | none |
| `voicebox` | Local Voicebox `POST /transcribe` at `127.0.0.1:17493` | Mac MLX Whisper already installed | Voicebox app running; field is `model` |
| `whisper-cli` | `whisper-cli -f utterance.wav` | whisper.cpp on disk | binary + model |
| `openai` | `POST /v1/audio/transcriptions` | Cloud Whisper | `OPENAI_API_KEY` |
| `groq` | Groq OpenAI-compatible Whisper Large v3 Turbo | Fast multilingual cloud | `GROQ_API_KEY` |
| `elevenlabs` | `POST /v1/speech-to-text` Scribe v2 | 90+ languages, Korean included | `ELEVENLABS_API_KEY` |
| `deepgram` | `POST /v1/listen?model=nova-3` | Streaming-grade cloud ASR | `DEEPGRAM_API_KEY` |

```bash
npx live-voice-agent live --stt voicebox
npx live-voice-agent live --stt groq
LIVE_VOICE_LANGUAGE=ko npx live-voice-agent live --stt elevenlabs
```

Korean: Voicebox MLX Whisper, Groq Whisper, ElevenLabs Scribe, or Deepgram nova-3 with `language=ko`.
Moonshine / Parakeet / SenseVoice are not bundled. Plug them as `whisper-cli` or a custom `STTEngine`.
