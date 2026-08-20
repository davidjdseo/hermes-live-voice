# Plan: protocol and client integrations

> Prepared OMH plan. This is planning evidence, not execution proof.

**Goal:** Attach Live Voice Agent to the public prompt seams that actually exist: coding CLIs, OpenAI-compatible HTTP, Orca CLI, and pluggable local STT. Keep the product a voice loop, not a new agent runtime.

**Non-goals:** Native microphone APIs inside Codex/Claude/OpenCode/Orca. Full ACP editor host. Full A2A mesh. Full AG-UI frontend. Shipping Whisper/ONNX weights. Owning API keys.

## Known facts

- Codex: `codex exec [PROMPT]`
- Claude Code: `claude -p --output-format text`
- OpenCode: `opencode run [message..]` and `opencode acp`
- Gemini CLI: `gemini -p`
- Paseo: `paseo send <id> [prompt]`
- Orca: `orca worktree create --agent --prompt` and `orca terminal send --text --enter`
- OpenRouter / OpenAI: `POST /v1/chat/completions` and `POST /v1/audio/transcriptions`
- ACP: JSON-RPC over stdio between editor and agent
- A2A: Agent Card discovery + tasks between agents
- AG-UI: event stream from agent to UI
- MCP: agent-to-tools. Already used inside those CLIs; this package does not host MCP.

## Acceptance criteria

1. `--brain` accepts echo, codex, claude, opencode, gemini, paseo, openai, openrouter, orca.
2. Unknown brains fail fast with the supported list.
3. OpenAI/OpenRouter brains call chat completions and do not invent a proprietary API.
4. Orca brain uses public CLI only. Missing terminal/agent options fail with the exact command needed.
5. STT factory supports silence, whisper-cli file transcription, and OpenAI transcriptions.
6. Protocol helpers emit ACP JSON-RPC, an A2A Agent Card, and AG-UI events without claiming a full runtime.
7. Tests cover registry, OpenAI request shape, STT wav packaging, protocol payloads, and Orca argument construction. No live network required.

## Verification

- `node --test tests/*.test.js`
- `node src/cli.js doctor` lists the new binaries/brains
- Docs name supported vs planned seams
