import { Type, Static } from '@sinclair/typebox'
import { MessageSchema } from './message.js'
import { AgentStatus } from './agent.js'
import { AgentLogEntrySchema } from './agent-log.js'
import { TodoSchema } from './todo.js'
import { HostOperatorRequestSchema } from './host-operator.js'

export const WsMessageNew = Type.Object({
  type: Type.Literal('message:new'),
  payload: MessageSchema,
})

export const WsMessageUpdate = Type.Object({
  type: Type.Literal('message:update'),
  payload: Type.Object({
    id: Type.String(),
    content: Type.String(),
    isStreaming: Type.Boolean(),
  }),
})

export const WsAgentStatus = Type.Object({
  type: Type.Literal('agent:status'),
  payload: Type.Object({
    agentId: Type.String(),
    status: AgentStatus,
  }),
})

export const WsAgentTyping = Type.Object({
  type: Type.Literal('agent:typing'),
  payload: Type.Object({
    agentId: Type.String(),
    channelId: Type.String(),
    isTyping: Type.Boolean(),
  }),
})

export const WsAgentLog = Type.Object({
  type: Type.Literal('agent:log'),
  payload: Type.Object({
    agentId: Type.String(),
    entries: Type.Array(AgentLogEntrySchema),
  }),
})

export const WsAgentScreen = Type.Object({
  type: Type.Literal('agent:screen'),
  payload: Type.Object({
    agentId: Type.String(),
    guiHttpPort: Type.Number(),
    guiHttpsPort: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  }),
})

export const WsTodoChange = Type.Object({
  type: Type.Literal('todo:change'),
  payload: TodoSchema,
})

export const WsTodoDelete = Type.Object({
  type: Type.Literal('todo:delete'),
  payload: Type.Object({
    id: Type.String(),
    agentId: Type.String(),
  }),
})

const WorkspaceInvalidateResource = Type.Union([
  Type.Literal('agents'),
  Type.Literal('channels'),
])

const WorkspaceInvalidateReason = Type.Union([
  Type.Literal('created'),
  Type.Literal('updated'),
  Type.Literal('deleted'),
])

export const WsWorkspaceInvalidate = Type.Object({
  type: Type.Literal('workspace:invalidate'),
  payload: Type.Object({
    resources: Type.Array(WorkspaceInvalidateResource, { minItems: 1 }),
    reason: WorkspaceInvalidateReason,
  }),
})

export const WsHostOperatorPending = Type.Object({
  type: Type.Literal('host-operator:pending'),
  payload: HostOperatorRequestSchema,
})

export const WsHostOperatorUpdated = Type.Object({
  type: Type.Literal('host-operator:updated'),
  payload: HostOperatorRequestSchema,
})

export const WsEvent = Type.Union([
  WsMessageNew,
  WsMessageUpdate,
  WsAgentStatus,
  WsAgentTyping,
  WsAgentLog,
  WsAgentScreen,
  WsTodoChange,
  WsTodoDelete,
  WsWorkspaceInvalidate,
  WsHostOperatorPending,
  WsHostOperatorUpdated,
])
export type WsEventType = Static<typeof WsEvent>
