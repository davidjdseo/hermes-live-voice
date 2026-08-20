"""Hermes agent-side registration boundary for the unified desktop plugin."""

def register(ctx) -> None:
    """Keep the native agent half intentionally empty; voice uses public desktop RPC."""
    return None
