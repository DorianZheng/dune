import { Type, Static } from '@sinclair/typebox'
import { HostOperatorApprovalMode } from './host-operator.js'

export const AgentStatus = Type.Union([
  Type.Literal('idle'),
  Type.Literal('starting'),
  Type.Literal('thinking'),
  Type.Literal('responding'),
  Type.Literal('error'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
])

export const HostExecApprovalMode = HostOperatorApprovalMode

export const AgentRole = Type.Union([
  Type.Literal('leader'),
  Type.Literal('follower'),
])

export const AgentWorkMode = Type.Union([
  Type.Literal('normal'),
  Type.Literal('plan-first'),
])

const NullableModelId = Type.Union([Type.String(), Type.Null()])

export const AgentSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  personality: Type.String(),
  role: AgentRole,
  workMode: AgentWorkMode,
  modelIdOverride: NullableModelId,
  hostOperatorApprovalMode: HostOperatorApprovalMode,
  hostOperatorApps: Type.Array(Type.String()),
  hostOperatorPaths: Type.Array(Type.String()),
  status: AgentStatus,
  avatarColor: Type.String(),
  createdAt: Type.Number(),
})

export type Agent = Static<typeof AgentSchema>
export type AgentStatusType = Static<typeof AgentStatus>
type AgentHostOperatorApprovalModeType = Static<typeof HostOperatorApprovalMode>
export type HostExecApprovalModeType = AgentHostOperatorApprovalModeType
export type AgentRoleType = Static<typeof AgentRole>
export type AgentWorkModeType = Static<typeof AgentWorkMode>

export const CreateAgentSchema = Type.Object({
  name: Type.String(),
  personality: Type.String(),
  role: Type.Optional(AgentRole),
  workMode: Type.Optional(AgentWorkMode),
  modelIdOverride: Type.Optional(NullableModelId),
  avatarColor: Type.Optional(Type.String()),
})

export type CreateAgent = Static<typeof CreateAgentSchema>

export const MemoryFileSchema = Type.Object({
  path: Type.String(),
  size: Type.Number(),
  modifiedAt: Type.Number(),
})

export type MemoryFile = Static<typeof MemoryFileSchema>
