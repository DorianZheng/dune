import { WebSocket } from 'ws'
import {
  RPC_PARSE_ERROR,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_INTERNAL_ERROR,
} from '@dune/shared'

// ── Types ─────────────────────────────────────────────────────────────

export type ActorIdentity = {
  actorType: 'human' | 'agent' | 'system'
  actorId: string
}

export type CallContext = {
  actor: ActorIdentity
}

export type Handler = (params: Record<string, unknown>, ctx: CallContext) => Promise<unknown>

export type HandlerMap = Map<string, Handler>

export interface RpcDispatcher {
  onMessage(ws: WebSocket, raw: string, ctx: CallContext): void
}

// ── Factory ───────────────────────────────────────────────────────────

export function createRpcDispatcher(handlers: HandlerMap): RpcDispatcher {
  return {
    onMessage(ws: WebSocket, raw: string, ctx: CallContext) {
      void dispatch(ws, raw, ctx, handlers)
    },
  }
}

async function dispatch(ws: WebSocket, raw: string, ctx: CallContext, handlers: HandlerMap) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    sendError(ws, null, RPC_PARSE_ERROR, 'Parse error')
    return
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendError(ws, null, RPC_INVALID_REQUEST, 'Invalid request')
    return
  }

  const { id, method, params } = parsed as Record<string, unknown>

  if (typeof id !== 'string' || typeof method !== 'string') {
    sendError(ws, typeof id === 'string' ? id : null, RPC_INVALID_REQUEST, 'Invalid request: id and method must be strings')
    return
  }

  const handler = handlers.get(method)
  if (!handler) {
    sendError(ws, id, RPC_METHOD_NOT_FOUND, `Method not found: ${method}`)
    return
  }

  const resolvedParams = (params && typeof params === 'object' && !Array.isArray(params))
    ? params as Record<string, unknown>
    : {}

  try {
    const result = await handler(resolvedParams, ctx)
    sendResult(ws, id, result)
  } catch (err: unknown) {
    const { code, message } = normalizeError(err)
    sendError(ws, id, code, message)
  }
}

// ── Wire helpers ──────────────────────────────────────────────────────

function sendResult(ws: WebSocket, id: string, result: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ id, result: result ?? null }))
}

function sendError(ws: WebSocket, id: string | null, code: number, message: string) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ id, error: { code, message } }))
}

// ── Error normalization ───────────────────────────────────────────────
// Handler functions throw errors with message strings that encode the
// HTTP-like semantics from the old REST API. We map known patterns to
// appropriate RPC error codes.

const ERROR_CODE_MAP: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  missing_actor_identity: 401,
  host_operator_unavailable: 503,
  agent_running_stop_required: 409,
  request_not_pending: 409,
  box_running: 409,
  file_exists: 409,
  box_not_running: 409,
  path_exists: 409,
  dir_not_empty: 409,
  host_exec_removed: 410,
}

function normalizeError(err: unknown): { code: number; message: string } {
  if (!(err instanceof Error)) {
    return { code: RPC_INTERNAL_ERROR, message: 'Internal error' }
  }

  const msg = err.message || 'Internal error'
  const code = ERROR_CODE_MAP[msg] ?? RPC_INTERNAL_ERROR

  return { code, message: msg }
}
