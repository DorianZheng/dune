import { Type, Static } from '@sinclair/typebox'

export const MiniAppStatus = Type.Union([
  Type.Literal('published'),
  Type.Literal('building'),
  Type.Literal('archived'),
  Type.Literal('error'),
])

export const MiniAppSchema = Type.Object({
  agentId: Type.String(),
  slug: Type.String(),
  name: Type.String(),
  description: Type.String(),
  collection: Type.String(),
  status: MiniAppStatus,
  entry: Type.String(),
  order: Type.Number(),
  tags: Type.Array(Type.String()),
  updatedAt: Type.Number(),
  entryExists: Type.Boolean(),
  openable: Type.Boolean(),
  error: Type.Optional(Type.String()),
  agentName: Type.Optional(Type.String()),
  kind: Type.Optional(Type.Union([Type.Literal('frontend'), Type.Literal('backend')])),
  sandboxId: Type.Optional(Type.String()),
  port: Type.Optional(Type.Number()),
  path: Type.Optional(Type.String()),
})

export type MiniApp = Static<typeof MiniAppSchema>
export type MiniAppStatusType = Static<typeof MiniAppStatus>

export const MiniAppOpenResponseSchema = Type.Object({
  app: MiniAppSchema,
  url: Type.String(),
})

export type MiniAppOpenResponse = Static<typeof MiniAppOpenResponseSchema>

export const MiniAppActionRequestSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  action: Type.String(),
  payload: Type.Optional(Type.Unknown()),
})

export type MiniAppActionRequest = Static<typeof MiniAppActionRequestSchema>

export const MiniAppActionResponseSchema = Type.Object({
  ok: Type.Boolean(),
  response: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
})

export type MiniAppActionResponse = Static<typeof MiniAppActionResponseSchema>
