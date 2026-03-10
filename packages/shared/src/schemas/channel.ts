import { Type, Static } from '@sinclair/typebox'

export const ChannelSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  createdAt: Type.Number(),
})

export type Channel = Static<typeof ChannelSchema>

export const CreateChannelSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.String()),
})

export type CreateChannel = Static<typeof CreateChannelSchema>
