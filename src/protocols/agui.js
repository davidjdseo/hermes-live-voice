/**
 * AG-UI event mapping for a spoken turn.
 * This is not a CopilotKit runtime. It emits the public event names so a
 * frontend can render the same turn Live Voice Agent already ran.
 * Spec: https://docs.ag-ui.com/concepts/agents
 */
export function spokenTurnToAgUiEvents({ messageId = `msg-${Date.now()}`, text = '', role = 'assistant' } = {}) {
  const content = String(text ?? '')
  return [
    { type: 'TEXT_MESSAGE_START', messageId, role },
    ...(content ? [{ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: content }] : []),
    { type: 'TEXT_MESSAGE_END', messageId },
  ]
}
