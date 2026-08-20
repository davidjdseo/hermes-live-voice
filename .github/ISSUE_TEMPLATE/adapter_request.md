---
name: Harness adapter request
about: Propose an adapter for an agent harness with a public integration seam
title: "[Adapter] "
labels: adapter
assignees: ""
---

## Harness

Which harness and version are in scope? Link the public documentation or source
for the integration seam.

## Public APIs

List the public APIs/events for each required capability. Do not include
credentials or private endpoints.

- Session id:
- Mic toggle:
- Microphone record start/stop:
- TTS speak:
- Prompt submit:
- Event subscription/unsubscribe:

## Session, event, and audio mapping

How do harness sessions map to sessionId? Map the normalized events from
docs/ADAPTERS.md, including turn identity, transcript text, interruption text,
audio ownership, and stale-event handling.

## Security and privacy

Describe permission prompts, transcript/audio retention, credential handling,
remote data flow, redaction, and failure cleanup.

## Test strategy

Describe unit or contract tests for start/stop ordering, interruption, session
switching, missing permissions, stale events, cleanup, and a focused integration
smoke check.

## Support status

Until the public seam and acceptance checks are verified, this is a
planned/community adapter and must not receive an implemented support badge.
