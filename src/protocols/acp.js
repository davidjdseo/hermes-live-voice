import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * Thin ACP client for one prompt. ACP is JSON-RPC over stdio.
 * This is not an editor host. It only initialize -> session/new -> session/prompt.
 * Spec: https://agentclientprotocol.com/get-started/introduction
 */
export function createAcpClient({ command, args = [], spawnImpl = spawn } = {}) {
  if (!command) throw new TypeError('ACP client needs command')
  let child = null
  let nextId = 1
  const pending = new Map()

  const send = message => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const request = (method, params) => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  return {
    async start() {
      if (child) return
      child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      const reader = createInterface({ input: child.stdout })
      reader.on('line', line => {
        let message
        try { message = JSON.parse(line) } catch { return }
        if (message.id != null && pending.has(message.id)) {
          const waiter = pending.get(message.id)
          pending.delete(message.id)
          message.error ? waiter.reject(Object.assign(new Error(message.error.message || 'ACP error'), message.error)) : waiter.resolve(message.result)
        }
      })
      child.once('exit', () => {
        for (const waiter of pending.values()) waiter.reject(new Error('ACP process exited'))
        pending.clear()
        child = null
      })
      await request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'live-voice-agent', version: '0.2.0' },
        capabilities: {},
      })
    },
    async prompt(text) {
      await this.start()
      const session = await request('session/new', {})
      const sessionId = session?.sessionId || session?.session_id
      const result = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: String(text ?? '') }],
      })
      return result?.stopReason ? JSON.stringify(result) : (result?.text || result?.message || JSON.stringify(result ?? {}))
    },
    async close() {
      try { child?.kill('SIGTERM') } catch {}
      child = null
    },
  }
}

export function createAcpAsk({ command = process.env.LIVE_VOICE_ACP_COMMAND || 'opencode', args = process.env.LIVE_VOICE_ACP_ARGS?.split(' ') || ['acp'] } = {}) {
  const client = createAcpClient({ command, args })
  return async text => {
    try {
      return await client.prompt(text)
    } finally {
      await client.close()
    }
  }
}
