import { Type, Static } from '@sinclair/typebox'

export const MessageSchema = Type.Object({
  id: Type.String(),
  channelId: Type.String(),
  authorId: Type.String(),
  content: Type.String(),
  timestamp: Type.Number(),
  mentionedAgentIds: Type.Array(Type.String()),
})

export type Message = Static<typeof MessageSchema>

export const CreateMessageSchema = Type.Object({
  content: Type.String(),
  authorId: Type.String(),
})

export type CreateMessage = Static<typeof CreateMessageSchema>
