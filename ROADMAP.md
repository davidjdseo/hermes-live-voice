# Roadmap

## v0.1

- Hermes Agent v0.20.4 public RPC adapter
- portable marker protocol and harness-neutral core
- deterministic session, echo, interruption, and re-arm tests

## Later, only with a real public seam

- additional harness adapters with explicit approval/session contracts;
- measured speech-duration calibration;
- accessibility review of the native pane.

## Community adapter milestones

These are targets, not support claims. Each adapter remains planned/community
until its public seam and acceptance checks are verified.

- Orca adapter: document the public session/event/audio seam; map its
  worktree/terminal/agent lifecycle without cross-session routing; verify
  start/stop, interruption, stale-event rejection, permissions, cleanup, and
  a focused integration check.
- Paseo adapter: document public workspace/agent/session ownership and voice
  events; bridge lifecycle teardown idempotently; verify the six contract
  capabilities, interruption, stale events, privacy boundaries, cleanup, and
  a focused integration check.
- Pi Coding Agent adapter: publish an extension or RPC/SDK bridge; map session
  identity, turn events, microphone/TTS/prompt paths, and handle ownership;
  verify interruption, session switching, permission failures, no audio or
  transcript leakage, cleanup, and a focused integration check.

No IDE integration, remote audio service, new model, or framework is planned
without a concrete supported API and a testable user need.
