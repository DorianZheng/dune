import { Type, Static } from '@sinclair/typebox'

export const AgentStatus = Type.Union([
  Type.Literal('idle'),
  Type.Literal('starting'),
  Type.Literal('thinking'),
  Type.Literal('responding'),
  Type.Literal('error'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
])

export const HostExecApprovalMode = Type.Union([
  Type.Literal('approval-required'),
  Type.Literal('dangerously-skip'),
])

export const AgentSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  personality: Type.String(),
  hostExecApprovalMode: HostExecApprovalMode,
  status: AgentStatus,
  avatarColor: Type.String(),
  createdAt: Type.Number(),
})

export type Agent = Static<typeof AgentSchema>
export type AgentStatusType = Static<typeof AgentStatus>
export type HostExecApprovalModeType = Static<typeof HostExecApprovalMode>

export const CreateAgentSchema = Type.Object({
  name: Type.String(),
  personality: Type.String(),
  avatarColor: Type.Optional(Type.String()),
})

export type CreateAgent = Static<typeof CreateAgentSchema>

export const MemoryFileSchema = Type.Object({
  path: Type.String(),
  size: Type.Number(),
  modifiedAt: Type.Number(),
})

export type MemoryFile = Static<typeof MemoryFileSchema>
