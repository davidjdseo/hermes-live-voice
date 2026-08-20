# Voice protocol

Every assistant response has a complete written body and ends with exactly one
closed marker block:

```text
<<<VOICE 확인했습니다. 다음 단계로 진행할까요? VOICE>>>
```

Only the contents of that final block are sent to TTS. The written body is
never shortened or replaced. A missing close marker, an absent block, or more
than one final block is silent rather than guessed.

The spoken block is Korean, conversational, and normally uses fewer than five
short sentences. Do not address the user by a personal name unless they asked
for that. Wake is `헤이 자비스` / `hey jarvis` (`헤이 자스비` is accepted).

As a runtime safety clamp, Hermes sends at most the first five non-empty
sentences of the closed block to TTS. The written response is never trimmed.

Commands are accepted only after manual Start, a wake phrase, or the exact
`헤이 자비스` / `hey jarvis` prefix. After a reply, only `진행해 자비스`,
`진행해`, or a choice matching the last spoken question is accepted.
