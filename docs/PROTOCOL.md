# Voice protocol

Every assistant response has a complete written body and ends with exactly one
closed marker block:

```text
<<<VOICE 지호, 확인했습니다. 다음 단계로 진행할까요? VOICE>>>
```

Only the contents of that final block are sent to TTS. The written body is
never shortened or replaced. A missing close marker, an absent block, or more
than one final block is silent rather than guessed.

The spoken block is Korean, conversational, addressed as 지호 only when it is
natural, and normally uses fewer than five short sentences. It states what
happened, the current result, and one meaningful next action. If a decision is
needed it asks one short question and may offer at most A/B/C choices. It does
not contain lists, code, logs, file paths, or reflection sections.

As a runtime safety clamp, Hermes sends at most the first five non-empty
sentences of the closed block to TTS. The written response is never trimmed.

Commands are accepted only after manual Start, a wake phrase, or the exact
`헤이 헤르메스` prefix. After a reply, only `진행해 헤르메스`, `진행해`, or a
choice matching the last spoken question is accepted. Filler, room noise, and
likely TTS echo are ignored. Meaningful speech during thinking or playback is
submitted as an interruption.
