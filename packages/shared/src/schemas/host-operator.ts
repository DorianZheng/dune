import { Type, Static } from '@sinclair/typebox'
import { SandboxActorType } from './sandbox.js'

export const HostOperatorApprovalMode = Type.Union([
  Type.Literal('approval-required'),
  Type.Literal('dangerously-skip'),
])

export const HostOperatorRequestKind = Type.Union([
  Type.Literal('overview'),
  Type.Literal('perceive'),
  Type.Literal('act'),
  Type.Literal('status'),
  Type.Literal('filesystem'),
])

export const HostOperatorRequestStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('rejected'),
])

export const HostOperatorDecision = Type.Union([
  Type.Literal('approve'),
  Type.Literal('reject'),
])

export const HostOperatorPerceiveMode = Type.Union([
  Type.Literal('accessibility'),
  Type.Literal('screenshot'),
  Type.Literal('composite'),
  Type.Literal('find'),
])

export const HostOperatorActAction = Type.Union([
  Type.Literal('click'),
  Type.Literal('double_click'),
  Type.Literal('right_click'),
  Type.Literal('hover'),
  Type.Literal('drag'),
  Type.Literal('scroll'),
  Type.Literal('type'),
  Type.Literal('press'),
  Type.Literal('select'),
  Type.Literal('focus'),
  Type.Literal('launch'),
  Type.Literal('close'),
  Type.Literal('clipboard_read'),
  Type.Literal('clipboard_write'),
  Type.Literal('url'),
  Type.Literal('navigate'),
])

export const HostOperatorFilesystemOp = Type.Union([
  Type.Literal('list'),
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('delete'),
  Type.Literal('search'),
])

export const HostOperatorPointSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
})

export const HostOperatorRectSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
})

export const HostOperatorTargetSchema = Type.Object({
  bundleId: Type.Optional(Type.String()),
  appName: Type.Optional(Type.String()),
  windowId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  windowTitle: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  point: Type.Optional(HostOperatorPointSchema),
})

export const HostOperatorOverviewCreateRequestSchema = Type.Object({
  kind: Type.Literal('overview'),
  bundleId: Type.Optional(Type.String()),
})

export const HostOperatorPerceiveCreateRequestSchema = Type.Object({
  kind: Type.Literal('perceive'),
  mode: HostOperatorPerceiveMode,
  bundleId: Type.String(),
  query: Type.Optional(Type.String()),
  windowId: Type.Optional(Type.Number()),
})

export const HostOperatorActCreateRequestSchema = Type.Object({
  kind: Type.Literal('act'),
  action: HostOperatorActAction,
  bundleId: Type.Optional(Type.String()),
  windowId: Type.Optional(Type.Number()),
  point: Type.Optional(HostOperatorPointSchema),
  toPoint: Type.Optional(HostOperatorPointSchema),
  text: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  deltaX: Type.Optional(Type.Number()),
  deltaY: Type.Optional(Type.Number()),
  url: Type.Optional(Type.String()),
})

export const HostOperatorStatusCreateRequestSchema = Type.Object({
  kind: Type.Literal('status'),
})

export const HostOperatorFilesystemCreateRequestSchema = Type.Object({
  kind: Type.Literal('filesystem'),
  op: HostOperatorFilesystemOp,
  path: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
})

export const HostOperatorCreateRequestSchema = Type.Union([
  HostOperatorOverviewCreateRequestSchema,
  HostOperatorPerceiveCreateRequestSchema,
  HostOperatorActCreateRequestSchema,
  HostOperatorStatusCreateRequestSchema,
  HostOperatorFilesystemCreateRequestSchema,
])

export const HostOperatorRequestSchema = Type.Object({
  requestId: Type.String(),
  agentId: Type.String(),
  requestedByType: SandboxActorType,
  requestedById: Type.String(),
  kind: HostOperatorRequestKind,
  input: HostOperatorCreateRequestSchema,
  target: Type.Union([HostOperatorTargetSchema, Type.Null()]),
  summary: Type.String(),
  status: HostOperatorRequestStatus,
  createdAt: Type.Number(),
  decidedAt: Type.Union([Type.Number(), Type.Null()]),
  startedAt: Type.Union([Type.Number(), Type.Null()]),
  completedAt: Type.Union([Type.Number(), Type.Null()]),
  approverId: Type.Union([Type.String(), Type.Null()]),
  decision: Type.Union([HostOperatorDecision, Type.Null()]),
  resultJson: Type.Union([Type.Unknown(), Type.Null()]),
  artifactPaths: Type.Array(Type.String()),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
})

export const HostOperatorDecisionRequestSchema = Type.Object({
  decision: HostOperatorDecision,
})

export const HostOperatorPendingListResponseSchema = Type.Object({
  requests: Type.Array(HostOperatorRequestSchema),
})

export const HostOperatorRunningAppSchema = Type.Object({
  bundleId: Type.String(),
  appName: Type.String(),
  pid: Type.Number(),
  active: Type.Boolean(),
})

export const HostOperatorRunningAppsResponseSchema = Type.Object({
  apps: Type.Array(HostOperatorRunningAppSchema),
})

export type HostOperatorApprovalModeType = Static<typeof HostOperatorApprovalMode>
export type HostOperatorRequestKindType = Static<typeof HostOperatorRequestKind>
export type HostOperatorRequestStatusType = Static<typeof HostOperatorRequestStatus>
export type HostOperatorDecisionType = Static<typeof HostOperatorDecision>
export type HostOperatorPerceiveModeType = Static<typeof HostOperatorPerceiveMode>
export type HostOperatorActActionType = Static<typeof HostOperatorActAction>
export type HostOperatorFilesystemOpType = Static<typeof HostOperatorFilesystemOp>
export type HostOperatorPoint = Static<typeof HostOperatorPointSchema>
export type HostOperatorRect = Static<typeof HostOperatorRectSchema>
export type HostOperatorTarget = Static<typeof HostOperatorTargetSchema>
export type HostOperatorOverviewCreateRequest = Static<typeof HostOperatorOverviewCreateRequestSchema>
export type HostOperatorPerceiveCreateRequest = Static<typeof HostOperatorPerceiveCreateRequestSchema>
export type HostOperatorActCreateRequest = Static<typeof HostOperatorActCreateRequestSchema>
export type HostOperatorStatusCreateRequest = Static<typeof HostOperatorStatusCreateRequestSchema>
export type HostOperatorFilesystemCreateRequest = Static<typeof HostOperatorFilesystemCreateRequestSchema>
export type HostOperatorCreateRequest = Static<typeof HostOperatorCreateRequestSchema>
export type HostOperatorRequest = Static<typeof HostOperatorRequestSchema>
export type HostOperatorDecisionRequest = Static<typeof HostOperatorDecisionRequestSchema>
export type HostOperatorPendingListResponse = Static<typeof HostOperatorPendingListResponseSchema>
export type HostOperatorRunningApp = Static<typeof HostOperatorRunningAppSchema>
export type HostOperatorRunningAppsResponse = Static<typeof HostOperatorRunningAppsResponseSchema>
