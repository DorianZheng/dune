import { Type, Static } from '@sinclair/typebox'

export const MIN_DUE_AT_MS = 1_000_000_000_000
export const MAX_DUE_AT_MS = 8_640_000_000_000_000
const DueAtMsSchema = Type.Integer({ minimum: MIN_DUE_AT_MS, maximum: MAX_DUE_AT_MS })

export const TodoStatus = Type.Union([Type.Literal('pending'), Type.Literal('done')])
export type TodoStatusType = Static<typeof TodoStatus>

export const TodoSchema = Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  originalTitle: Type.String(),
  originalDescription: Type.Optional(Type.String()),
  nextPlan: Type.Optional(Type.String()),
  status: TodoStatus,
  dueAt: DueAtMsSchema,
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
})

export type Todo = Static<typeof TodoSchema>

export const CreateTodoSchema = Type.Object({
  agentId: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  dueAt: DueAtMsSchema,
})

export type CreateTodo = Static<typeof CreateTodoSchema>

export const UpdateTodoSchema = Type.Object({
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  nextPlan: Type.Optional(Type.String()),
  status: Type.Optional(TodoStatus),
  dueAt: Type.Optional(DueAtMsSchema),
})

export type UpdateTodo = Static<typeof UpdateTodoSchema>
