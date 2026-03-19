import type { HandlerMap, Handler, CallContext } from './protocol.js'
import { clientHandlers } from './client-api.js'

// ── Agent Handler Map ─────────────────────────────────────────────────
// Agents get a restricted subset of client methods.
// We reuse the same handler implementations — the only difference is
// which methods are exposed.

const ALLOWED_AGENT_METHODS = new Set([
  // Channels (read + send)
  'channels.list',
  'channels.getByName',
  'channels.sendMessage',

  // Mailbox
  'agents.getMailbox',
  'agents.fetchMailbox',
  'agents.ackMailbox',
  'agents.respond',

  // Agent lifecycle (self + team)
  'agents.list',
  'agents.get',
  'agents.start',
  'agents.stop',

  // Todos
  'todos.list',
  'todos.create',
  'todos.update',

  // Sandboxes (exec passthrough)
  'sandboxes.createExec',
  'sandboxes.getExecEvents',

  // Host Operator
  'agents.submitHostOperator',
  'agents.getHostOperator',
])

export const agentHandlers: HandlerMap = new Map<string, Handler>()

for (const method of ALLOWED_AGENT_METHODS) {
  const handler = clientHandlers.get(method)
  if (handler) {
    agentHandlers.set(method, handler)
  }
}
