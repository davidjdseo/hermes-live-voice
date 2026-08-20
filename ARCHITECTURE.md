# Architecture

`src/core.js` is a dependency-free session-scoped state machine. It normalizes
Korean/English transcripts, rejects fillers and Korean near-echo with edit /
character n-gram similarity, applies wake / continue / choice gates, aggregates
deltas, parses closed voice blocks, deduplicates completion events, and owns one
bounded injectable re-arm timer.

`src/adapters/contract.js` defines the small harness boundary. Hermes-specific
`RpcEvent { type, session_id, payload }` normalization and public RPC wiring
live in `src/adapters/hermes.js`. `src/bridge.js` constructs `VoiceCore`,
subscribes to every normalized voice/message event, dispatches only events
owned by the active session, and exposes async `start`, `stop`, and `dispose`.
Ownership is checked against the controller session, not a changing focused-tab
value.

`src/plugin.template.js` is the only desktop integration. The stdlib Node
script injects the core, Hermes adapter, generic bridge, and compatibility
runtime helpers into a plain ESM file. The shipped file imports only
`@hermes/plugin-sdk` and `react/jsx-runtime`, uses an SDK atom for reactive UI,
and stores a global runtime disposer for hot reload. The package exports the
bridge, core, contract, and adapter entrypoints without adding dependencies.

The Hermes Desktop disk scanner currently requires a real directory entry. The
installer's macOS link mode uses a narrow managed shim under
`~/.hermes/desktop-plugins/`; its sole `plugin.js` is a symlink to the checkout.
This is an installation compatibility detail, not a second plugin implementation.

The Python half is intentionally a no-op registration boundary: voice uses
Hermes public RPCs and does not bypass approval or policy handling.
