/**
 * Small harness boundary. VoiceCore only consumes callbacks; an adapter owns
 * transport, session lookup, request verbs, and event normalization.
 */
export function assertAgentHarnessAdapter(adapter) {
  const required = ['getSessionId', 'toggle', 'record', 'speak', 'submit', 'subscribe'];
  for (const name of required) if (typeof adapter?.[name] !== 'function') throw new TypeError(`AgentHarnessAdapter.${name} is required`);
  return adapter;
}
export function ownsSession(event, sessionId) { return Boolean(sessionId) && event?.sessionId === sessionId; }
