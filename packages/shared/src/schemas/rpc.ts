// ── RPC Envelope Types ────────────────────────────────────────────────

/** Client → Server request */
export type RpcRequest = {
  id: string
  method: string
  params: Record<string, unknown>
}

/** Server → Client success response */
export type RpcResponse = {
  id: string
  result: unknown
}

/** Server → Client error response */
export type RpcError = {
  id: string
  error: { code: number; message: string }
}

/** Server → Client unsolicited push event */
export type PushEvent = {
  type: string
  payload: unknown
}

// ── Standard Error Codes ──────────────────────────────────────────────

export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

// Application error codes (positive)
export const RPC_NOT_FOUND = 404
export const RPC_FORBIDDEN = 403
export const RPC_UNAUTHORIZED = 401
export const RPC_CONFLICT = 409
export const RPC_BAD_REQUEST = 400
export const RPC_UNAVAILABLE = 503
export const RPC_TIMEOUT = 504
export const RPC_GONE = 410

// ── Typed Method Registries ───────────────────────────────────────────
// These define the contract for each RPC method.
// Each entry maps params → result type.
// The actual types (Channel, Message, etc.) are imported from sibling schemas.

import type { Channel, CreateChannel } from './channel.js'
import type { Message } from './message.js'
import type { SlackSettings, SlackChannelLink, SlackChannel } from './slack-settings.js'
import type {
  Agent,
  CreateAgent,
  MemoryFile,
  AgentStatusType,
  AgentRoleType,
  AgentWorkModeType,
} from './agent.js'
import type { AgentLogEntry } from './agent-log.js'
import type { AgentMount, CreateAgentMountRequest, UpdateAgentMountRequest, AgentMountHostDirectoryPickResponse } from './agent-mount.js'
import type { Todo, CreateTodo, UpdateTodo } from './todo.js'
import type { ClaudeSettings, ClaudeSettingsUpdate } from './claude-settings.js'
import type {
  MiniApp,
  MiniAppOpenResponse,
  MiniAppActionResponse,
} from './miniapp.js'
import type {
  HostOperatorRequest,
  HostOperatorCreateRequest,
  HostOperatorDecisionRequest,
  HostOperatorRunningApp,
  HostOperatorApprovalModeType,
} from './host-operator.js'
import type {
  BoxResource,
  BoxCreateRequest,
  BoxPatchRequest,
  BoxListResponse,
  BoxStatusResponse,
  ExecResource,
  ExecCreateRequest,
  ExecListResponse,
  ExecEvent,
  FileUploadRequest,
  FileDownloadResponse,
  HostImportRequest,
  SandboxFsListResponse,
  SandboxFsMkdirRequest,
  SandboxFsMoveRequest,
  SandboxFsReadResponse,
} from './sandbox.js'

// ── Client Method Registry ────────────────────────────────────────────
// ~68 methods that the Web UI (or any client) can call.

export interface ClientMethods {
  // Channels
  'channels.list':              { params: {}; result: Channel[] }
  'channels.create':            { params: CreateChannel; result: Channel }
  'channels.get':               { params: { id: string }; result: Channel }
  'channels.getByName':         { params: { name: string }; result: Channel }
  'channels.update':            { params: { id: string } & Partial<Channel>; result: Channel }
  'channels.delete':            { params: { id: string }; result: { ok: boolean } }
  'channels.getMessages':       { params: { channelId: string; limit?: number; before?: number }; result: Message[] }
  'channels.sendMessage':       { params: { channelId: string; authorId: string; content: string }; result: Message }
  'channels.subscribe':         { params: { channelId: string; agentId: string }; result: { ok: boolean } }
  'channels.unsubscribe':       { params: { channelId: string; agentId: string }; result: { ok: boolean } }
  'channels.getSubscribers':    { params: { channelId: string }; result: string[] }

  // Agents
  'agents.list':                { params: {}; result: Agent[] }
  'agents.create':              { params: CreateAgent; result: Agent }
  'agents.get':                 { params: { id: string }; result: Agent }
  'agents.getByName':           { params: { name: string }; result: Agent }
  'agents.update':              { params: { id: string } & Partial<{
    name: string
    personality: string
    role: AgentRoleType
    workMode: AgentWorkModeType
    modelIdOverride: string | null
    hostOperatorApprovalMode: HostOperatorApprovalModeType
    hostOperatorApps: string[]
    hostOperatorPaths: string[]
    avatarColor: string
  }>; result: Agent }
  'agents.delete':              { params: { id: string }; result: { ok: boolean } }
  'agents.start':               { params: { id: string }; result: { ok: boolean; status: string } }
  'agents.stop':                { params: { id: string }; result: { ok: boolean; status: string } }
  'agents.interrupt':           { params: { id: string }; result: { ok: boolean; interrupted: boolean; status: string } }
  'agents.cancelStart':         { params: { id: string }; result: { ok: boolean } }
  'agents.startAll':            { params: {}; result: Array<{ id: string; name: string; status: string; error?: string }> }
  'agents.stopAll':             { params: {}; result: { ok: boolean } }
  'agents.redeployDaemons':     { params: {}; result: { ok: boolean } }
  'agents.getSubscriptions':    { params: { id: string }; result: string[] }
  'agents.getSkills':           { params: { id: string }; result: Array<{ name: string; description: string; preview: string; scripts: string[]; markdown: string }> }
  'agents.getSystemPrompt':     { params: { id: string }; result: { prompt: string } }
  'agents.getLogs':             { params: { id: string; limit?: number; beforeSeq?: number }; result: { entries: AgentLogEntry[]; nextBeforeSeq: number | null } }
  'agents.getScreenshot':       { params: { id: string }; result: { data: string; width: number; height: number; format: string } }
  'agents.getScreen':           { params: { id: string }; result: { guiHttpPort: number; guiHttpsPort: number; width: number; height: number } }
  'agents.exec':                { params: { id: string; cmd: string; args?: string[] }; result: unknown }
  'agents.dm':                  { params: { agentId: string; content: string; clientRequestId?: string }; result: { response: string } }

  // Agent Mounts
  'agents.listMounts':          { params: { id: string }; result: AgentMount[] }
  'agents.createMount':         { params: { id: string } & CreateAgentMountRequest; result: AgentMount }
  'agents.updateMount':         { params: { id: string; mountId: string } & UpdateAgentMountRequest; result: AgentMount }
  'agents.deleteMount':         { params: { id: string; mountId: string }; result: void }
  'agents.selectMountHostDir':  { params: { id: string }; result: AgentMountHostDirectoryPickResponse }

  // Agent Memory
  'agents.listMemory':          { params: { agentId: string }; result: MemoryFile[] }
  'agents.readMemory':          { params: { agentId: string; path: string }; result: { content: string } }
  'agents.writeMemory':         { params: { agentId: string; path: string; content: string }; result: { ok: boolean } }
  'agents.createMemory':        { params: { agentId: string; path: string; content?: string }; result: { ok: boolean } }
  'agents.deleteMemory':        { params: { agentId: string; path: string }; result: { ok: boolean } }

  // Agent Mailbox
  'agents.getMailbox':          { params: { id: string }; result: unknown }
  'agents.fetchMailbox':        { params: { id: string }; result: unknown }
  'agents.ackMailbox':          { params: { id: string; batchId: string }; result: { ok: boolean } }
  'agents.getUnread':           { params: { id: string }; result: unknown }
  'agents.ack':                 { params: { id: string; channelId: string; timestamp: number }; result: { ok: boolean } }
  'agents.respond':             { params: { id: string; mode?: string; channels?: unknown[] }; result: { ok: boolean; response: string } }

  // Agent Apps
  'agents.listApps':            { params: { agentId: string }; result: MiniApp[] }
  'agents.listAllApps':         { params: {}; result: MiniApp[] }
  'agents.openApp':             { params: { agentId: string; slug: string }; result: MiniAppOpenResponse }
  'agents.openAppCrossAgent':   { params: { agentId: string; slug: string }; result: MiniAppOpenResponse }
  'agents.appAction':           { params: { agentId: string; slug: string; action: string; payload?: unknown; requestId?: string }; result: MiniAppActionResponse }

  // Agent Host Operator
  'agents.submitHostOperator':  { params: { id: string } & HostOperatorCreateRequest; result: HostOperatorRequest }
  'agents.getHostOperator':     { params: { requestId: string }; result: HostOperatorRequest }

  // Todos
  'todos.list':                 { params: { agentId: string; status?: string }; result: Todo[] }
  'todos.create':               { params: CreateTodo; result: Todo }
  'todos.update':               { params: { id: string } & UpdateTodo; result: Todo }
  'todos.delete':               { params: { id: string }; result: { ok: boolean } }

  // Settings
  'settings.getClaude':         { params: {}; result: ClaudeSettings }
  'settings.updateClaude':      { params: ClaudeSettingsUpdate; result: ClaudeSettings }
  'settings.getAdminPlane':     { params: {}; result: { hostCommandAdminBaseUrl: string; hostOperatorAdminBaseUrl: string } }

  // Admin Host Operator
  'admin.listPendingHostOp':    { params: {}; result: { requests: HostOperatorRequest[] } }
  'admin.decideHostOp':         { params: { requestId: string } & HostOperatorDecisionRequest; result: HostOperatorRequest }
  'admin.listHostOpApps':       { params: {}; result: { apps: HostOperatorRunningApp[] } }

  // Sandboxes
  'sandboxes.listBoxes':        { params: {}; result: BoxListResponse }
  'sandboxes.createBox':        { params: BoxCreateRequest; result: BoxResource }
  'sandboxes.getBox':           { params: { boxId: string }; result: BoxResource }
  'sandboxes.patchBox':         { params: { boxId: string } & BoxPatchRequest; result: BoxResource }
  'sandboxes.deleteBox':        { params: { boxId: string; force?: boolean }; result: void }
  'sandboxes.startBox':         { params: { boxId: string }; result: BoxResource }
  'sandboxes.stopBox':          { params: { boxId: string }; result: { removed: boolean; box: BoxResource | null } }
  'sandboxes.getBoxStatus':     { params: { boxId: string }; result: BoxStatusResponse }
  'sandboxes.createExec':       { params: { boxId: string } & ExecCreateRequest; result: ExecResource }
  'sandboxes.listExecs':        { params: { boxId: string }; result: ExecListResponse }
  'sandboxes.getExec':          { params: { boxId: string; execId: string }; result: ExecResource }
  'sandboxes.getExecEvents':    { params: { boxId: string; execId: string; afterSeq?: number; limit?: number }; result: ExecEvent[] }
  'sandboxes.uploadFiles':      { params: { boxId: string } & FileUploadRequest; result: void }
  'sandboxes.downloadFile':     { params: { boxId: string; path: string }; result: FileDownloadResponse }
  'sandboxes.importHostPath':   { params: { boxId: string } & HostImportRequest; result: void }
  'sandboxes.listFs':           { params: { boxId: string; path: string; includeHidden?: boolean; limit?: number }; result: SandboxFsListResponse }
  'sandboxes.readFs':           { params: { boxId: string; path: string; maxBytes?: number }; result: SandboxFsReadResponse }
  'sandboxes.mkdirFs':          { params: { boxId: string } & SandboxFsMkdirRequest; result: void }
  'sandboxes.moveFs':           { params: { boxId: string } & SandboxFsMoveRequest; result: void }
  'sandboxes.deleteFs':         { params: { boxId: string; path: string; recursive?: boolean }; result: void }

  // Messages
  'messages.get':               { params: { id: string }; result: Message }

  // Slack
  'slack.getSettings':          { params: {}; result: SlackSettings }
  'slack.updateSettings':       { params: { botToken?: string; appToken?: string }; result: SlackSettings }
  'slack.disconnect':           { params: {}; result: { ok: boolean } }
  'slack.listRemoteChannels':   { params: {}; result: SlackChannel[] }
  'slack.listLinks':            { params: {}; result: SlackChannelLink[] }
  'slack.createLink':           { params: { duneChannelId: string; slackChannelId: string; slackChannelName: string; direction?: string }; result: SlackChannelLink }
  'slack.deleteLink':           { params: { id: string }; result: { ok: boolean } }
  'slack.listChannels':         { params: {}; result: SlackChannelLink[] }
  'slack.send':                 { params: { slackChannelId: string; content: string; agentName?: string }; result: { ok: boolean } }

  // Terminal (special — opens a binary stream, not JSON RPC)
  'terminal.open':              { params: { boxId: string }; result: { sessionId: string } }
}

// ── Agent Method Registry ─────────────────────────────────────────────
// ~20 methods that agents can call (restricted subset).

export interface AgentMethods {
  // Channels (read + send)
  'channels.list':              { params: {}; result: Channel[] }
  'channels.getByName':         { params: { name: string }; result: Channel }
  'channels.sendMessage':       { params: { channelId: string; authorId: string; content: string }; result: Message }

  // Mailbox
  'agents.getMailbox':          { params: { id: string }; result: unknown }
  'agents.fetchMailbox':        { params: { id: string }; result: unknown }
  'agents.ackMailbox':          { params: { id: string; batchId: string }; result: { ok: boolean } }
  'agents.respond':             { params: { id: string; mode?: string; channels?: unknown[] }; result: { ok: boolean; response: string } }

  // Agent lifecycle (self + team)
  'agents.list':                { params: {}; result: Agent[] }
  'agents.get':                 { params: { id: string }; result: Agent }
  'agents.start':               { params: { id: string }; result: { ok: boolean; status: string } }
  'agents.stop':                { params: { id: string }; result: { ok: boolean; status: string } }

  // Todos
  'todos.list':                 { params: { agentId: string; status?: string }; result: Todo[] }
  'todos.create':               { params: CreateTodo; result: Todo }
  'todos.update':               { params: { id: string } & UpdateTodo; result: Todo }

  // Sandboxes (passthrough)
  'sandboxes.createExec':       { params: { boxId: string } & ExecCreateRequest; result: ExecResource }
  'sandboxes.getExecEvents':    { params: { boxId: string; execId: string; afterSeq?: number; limit?: number }; result: ExecEvent[] }

  // Host Operator
  'agents.submitHostOperator':  { params: { id: string } & HostOperatorCreateRequest; result: HostOperatorRequest }
  'agents.getHostOperator':     { params: { requestId: string }; result: HostOperatorRequest }

  // Slack
  'slack.listChannels':         { params: {}; result: SlackChannelLink[] }
  'slack.send':                 { params: { slackChannelId: string; content: string; agentName?: string }; result: { ok: boolean } }
}

// ── Helper: extract method names ──────────────────────────────────────
export type ClientMethodName = keyof ClientMethods
export type AgentMethodName = keyof AgentMethods
