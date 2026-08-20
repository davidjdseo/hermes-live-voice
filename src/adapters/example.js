import { assertAgentHarnessAdapter } from './contract.js'

// Dependency-free shape for a future harness. `transport` supplies the six
// operations; this example intentionally does not claim an IDE integration.
export function createExampleAdapter(transport) {
  return assertAgentHarnessAdapter({
    getSessionId: transport.getSessionId,
    toggle: transport.toggle,
    record: transport.record,
    speak: transport.speak,
    submit: transport.submit,
    subscribe: transport.subscribe
  })
}
