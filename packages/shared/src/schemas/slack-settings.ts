import { Type, Static } from '@sinclair/typebox'

export const SlackSettingsSchema = Type.Object({
  isConnected: Type.Boolean(),
  teamId: Type.Union([Type.String(), Type.Null()]),
  teamName: Type.Union([Type.String(), Type.Null()]),
  botUserId: Type.Union([Type.String(), Type.Null()]),
  installedAt: Type.Union([Type.Number(), Type.Null()]),
  hasBotToken: Type.Boolean(),
  hasAppToken: Type.Boolean(),
})

export type SlackSettings = Static<typeof SlackSettingsSchema>

export const SlackChannelLinkSchema = Type.Object({
  id: Type.String(),
  duneChannelId: Type.String(),
  slackChannelId: Type.String(),
  slackChannelName: Type.String(),
  direction: Type.Union([
    Type.Literal('bidirectional'),
    Type.Literal('inbound'),
    Type.Literal('outbound'),
  ]),
  createdAt: Type.Number(),
})

export type SlackChannelLink = Static<typeof SlackChannelLinkSchema>

export const SlackChannelSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
})

export type SlackChannel = Static<typeof SlackChannelSchema>
