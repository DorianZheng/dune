import { Static, Type } from '@sinclair/typebox'

export const AgentMountSchema = Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  hostPath: Type.String(),
  guestPath: Type.String(),
  readOnly: Type.Boolean(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
})

export const CreateAgentMountRequestSchema = Type.Object({
  hostPath: Type.String(),
  guestPath: Type.String(),
  readOnly: Type.Optional(Type.Boolean()),
})

export const UpdateAgentMountRequestSchema = Type.Partial(Type.Object({
  hostPath: Type.String(),
  guestPath: Type.String(),
  readOnly: Type.Boolean(),
}))

export const AgentMountHostDirectoryPickResponseSchema = Type.Union([
  Type.Object({
    status: Type.Literal('selected'),
    hostPath: Type.String(),
  }),
  Type.Object({
    status: Type.Literal('cancelled'),
  }),
])

export type AgentMount = Static<typeof AgentMountSchema>
export type CreateAgentMountRequest = Static<typeof CreateAgentMountRequestSchema>
export type UpdateAgentMountRequest = Static<typeof UpdateAgentMountRequestSchema>
export type AgentMountHostDirectoryPickResponse = Static<typeof AgentMountHostDirectoryPickResponseSchema>
