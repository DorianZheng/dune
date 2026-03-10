import { Type, Static } from '@sinclair/typebox'
import { SandboxActorType } from './sandbox.js'

export const HostCommandScope = Type.Union([
  Type.Literal('workspace'),
  Type.Literal('full-host'),
])

export const HostCommandStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('rejected'),
])

export const HostCommandDecision = Type.Union([
  Type.Literal('approve'),
  Type.Literal('reject'),
])

export const HostCommandRequestSchema = Type.Object({
  requestId: Type.String(),
  agentId: Type.String(),
  requestedByType: SandboxActorType,
  requestedById: Type.String(),
  command: Type.String(),
  args: Type.Array(Type.String()),
  cwd: Type.String(),
  scope: HostCommandScope,
  status: HostCommandStatus,
  createdAt: Type.Number(),
  decidedAt: Type.Union([Type.Number(), Type.Null()]),
  startedAt: Type.Union([Type.Number(), Type.Null()]),
  completedAt: Type.Union([Type.Number(), Type.Null()]),
  approverId: Type.Union([Type.String(), Type.Null()]),
  decision: Type.Union([HostCommandDecision, Type.Null()]),
  elevatedConfirmed: Type.Boolean(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  stdout: Type.String(),
  stderr: Type.String(),
  stdoutTruncated: Type.Boolean(),
  stderrTruncated: Type.Boolean(),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
})

export const HostCommandCreateRequestSchema = Type.Object({
  command: Type.String(),
  args: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String()),
  scope: Type.Optional(HostCommandScope),
})

export const HostCommandDecisionRequestSchema = Type.Object({
  decision: HostCommandDecision,
  elevatedConfirmed: Type.Optional(Type.Boolean()),
})

export const HostCommandPendingListResponseSchema = Type.Object({
  requests: Type.Array(HostCommandRequestSchema),
})

export type HostCommandScopeType = Static<typeof HostCommandScope>
export type HostCommandStatusType = Static<typeof HostCommandStatus>
export type HostCommandDecisionType = Static<typeof HostCommandDecision>
export type HostCommandRequest = Static<typeof HostCommandRequestSchema>
export type HostCommandCreateRequest = Static<typeof HostCommandCreateRequestSchema>
export type HostCommandDecisionRequest = Static<typeof HostCommandDecisionRequestSchema>
export type HostCommandPendingListResponse = Static<typeof HostCommandPendingListResponseSchema>
