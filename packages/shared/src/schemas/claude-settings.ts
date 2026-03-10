import { Type, Static } from '@sinclair/typebox'

const NullableString = Type.Union([Type.String(), Type.Null()])
export const SelectedModelProviderSchema = Type.Union([Type.Literal('claude'), Type.Null()])
export type SelectedModelProvider = Static<typeof SelectedModelProviderSchema>

export const ClaudeSettingsSchema = Type.Object({
  selectedModelProvider: SelectedModelProviderSchema,
  anthropicBaseUrl: NullableString,
  claudeCodeDisableNonessentialTraffic: NullableString,
  hasAnthropicApiKey: Type.Boolean(),
  hasClaudeCodeOAuthToken: Type.Boolean(),
  hasAnthropicAuthToken: Type.Boolean(),
  updatedAt: Type.Union([Type.Number(), Type.Null()]),
})

export type ClaudeSettings = Static<typeof ClaudeSettingsSchema>

export const ClaudeSettingsUpdateSchema = Type.Object({
  selectedModelProvider: Type.Optional(SelectedModelProviderSchema),
  anthropicApiKey: Type.Optional(NullableString),
  claudeCodeOAuthToken: Type.Optional(NullableString),
  anthropicAuthToken: Type.Optional(NullableString),
  anthropicBaseUrl: Type.Optional(NullableString),
  claudeCodeDisableNonessentialTraffic: Type.Optional(NullableString),
})

export type ClaudeSettingsUpdate = Static<typeof ClaudeSettingsUpdateSchema>
