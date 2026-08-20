# Security

- No secrets, `.env`, OAuth tokens, audio files, or transcripts are read or persisted by the installer/plugin.
- Prompt submission and voice actions always use Hermes public RPCs, preserving Hermes approval/policy handling.
- Spoken output is allowlisted by closed markers; unclosed or absent markers are silent.
- TTS echo suppression is heuristic, not acoustic isolation. Use headphones or physical mic/speaker separation for sensitive use.
- Remote Hermes OAuth transports remain remote; local-first describes plugin state and installer behavior, not transport providers.
