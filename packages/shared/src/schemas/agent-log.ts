import { Type, Static } from '@sinclair/typebox'

export const AgentLogEntryType = Type.Union([
  Type.Literal('text'),
  Type.Literal('tool_use'),
  Type.Literal('tool_result'),
  Type.Literal('result'),
  Type.Literal('runtime'),
  Type.Literal('error'),
  Type.Literal('system'),
  Type.Literal('user_message'),
  Type.Literal('mailbox_notice'),
  Type.Literal('channel_input'),
  Type.Literal('thinking'),
])

export const AgentLogEntrySchema = Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  timestamp: Type.Number(),
  type: AgentLogEntryType,
  data: Type.Record(Type.String(), Type.Unknown()),
})

export type AgentLogEntry = Static<typeof AgentLogEntrySchema>
