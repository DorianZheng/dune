import { Type, Static } from '@sinclair/typebox'

export const DeploymentInitiator = Type.Union([
  Type.Literal('human'),
  Type.Literal('agent'),
])

export const DeploymentStatus = Type.Union([
  Type.Literal('preparing'),
  Type.Literal('building'),
  Type.Literal('starting'),
  Type.Literal('ready'),
  Type.Literal('failed'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
])

export const DeploymentConfigSchema = Type.Object({
  agentId: Type.String(),
  sourcePath: Type.String(),
  buildCommand: Type.String(),
  startCommand: Type.String(),
  updatedAt: Type.Number(),
})

export const DeploymentRunSchema = Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  initiator: DeploymentInitiator,
  status: DeploymentStatus,
  sandboxId: Type.Union([Type.String(), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  stoppedAt: Type.Union([Type.Number(), Type.Null()]),
})

export const DeploymentLogLineSchema = Type.Object({
  runId: Type.String(),
  seq: Type.Number(),
  timestamp: Type.Number(),
  line: Type.String(),
})

export const DeploymentSummarySchema = Type.Object({
  config: Type.Union([DeploymentConfigSchema, Type.Null()]),
  activeRun: Type.Union([DeploymentRunSchema, Type.Null()]),
  runs: Type.Array(DeploymentRunSchema),
})

export type DeploymentInitiatorType = Static<typeof DeploymentInitiator>
export type DeploymentStatusType = Static<typeof DeploymentStatus>
export type DeploymentConfig = Static<typeof DeploymentConfigSchema>
export type DeploymentRun = Static<typeof DeploymentRunSchema>
export type DeploymentLogLine = Static<typeof DeploymentLogLineSchema>
export type DeploymentSummary = Static<typeof DeploymentSummarySchema>
