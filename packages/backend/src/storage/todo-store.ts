import { getDb } from './database.js'
import { newId } from '../utils/ids.js'
import type { Todo, CreateTodo, UpdateTodo } from '@dune/shared'

function mapRow(row: any): Todo {
  return {
    id: row.id,
    agentId: row.agentId,
    title: row.title,
    description: row.description ?? undefined,
    originalTitle: row.originalTitle,
    originalDescription: row.originalDescription ?? undefined,
    nextPlan: row.nextPlan ?? undefined,
    status: row.status,
    dueAt: row.dueAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const SELECT_COLS = [
  'id',
  'agent_id as agentId',
  'title',
  'description',
  'original_title as originalTitle',
  'original_description as originalDescription',
  'next_plan as nextPlan',
  'status',
  'due_at as dueAt',
  'created_at as createdAt',
  'updated_at as updatedAt',
].join(', ')

export function createTodo(input: CreateTodo): Todo {
  const now = Date.now()
  const todo: Todo = {
    id: newId(),
    agentId: input.agentId,
    title: input.title,
    description: input.description,
    originalTitle: input.title,
    originalDescription: input.description,
    nextPlan: undefined,
    status: 'pending',
    dueAt: input.dueAt,
    createdAt: now,
    updatedAt: now,
  }
  getDb().prepare(
    `INSERT INTO todos (
      id, agent_id, title, description, original_title, original_description, next_plan, status, due_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    todo.id,
    todo.agentId,
    todo.title,
    todo.description ?? null,
    todo.originalTitle,
    todo.originalDescription ?? null,
    todo.nextPlan ?? null,
    todo.status,
    todo.dueAt ?? null,
    todo.createdAt,
    todo.updatedAt,
  )
  return todo
}

export function getTodo(id: string): Todo | undefined {
  const row = getDb().prepare(`SELECT ${SELECT_COLS} FROM todos WHERE id = ?`).get(id)
  return row ? mapRow(row) : undefined
}

export function listTodos(agentId: string, status?: string): Todo[] {
  if (status) {
    return getDb().prepare(`SELECT ${SELECT_COLS} FROM todos WHERE agent_id = ? AND status = ? ORDER BY created_at DESC`)
      .all(agentId, status).map(mapRow)
  }
  return getDb().prepare(`SELECT ${SELECT_COLS} FROM todos WHERE agent_id = ? ORDER BY created_at DESC`)
    .all(agentId).map(mapRow)
}

export function updateTodo(id: string, input: UpdateTodo): Todo | undefined {
  const existing = getTodo(id)
  if (!existing) return undefined

  const now = Date.now()
  const title = input.title ?? existing.title
  const description = input.description !== undefined ? input.description : existing.description
  const nextPlan = input.nextPlan !== undefined ? input.nextPlan : existing.nextPlan
  const status = input.status ?? existing.status
  const dueAt = input.dueAt ?? existing.dueAt

  getDb().prepare(
    'UPDATE todos SET title = ?, description = ?, next_plan = ?, status = ?, due_at = ?, updated_at = ? WHERE id = ?'
  ).run(title, description ?? null, nextPlan ?? null, status, dueAt ?? null, now, id)

  return { ...existing, title, description, nextPlan, status, dueAt, updatedAt: now }
}

export function deleteTodo(id: string): Todo | undefined {
  const existing = getTodo(id)
  if (!existing) return undefined
  getDb().prepare('DELETE FROM todos WHERE id = ?').run(id)
  return existing
}

export function getPendingTodosWithDue(): Todo[] {
  return getDb().prepare(`SELECT ${SELECT_COLS} FROM todos WHERE status = 'pending' AND due_at IS NOT NULL`)
    .all().map(mapRow)
}

export function getPendingTodosByAgent(agentId: string): Todo[] {
  return getDb().prepare(`SELECT ${SELECT_COLS} FROM todos WHERE agent_id = ? AND status = 'pending' ORDER BY due_at ASC, created_at ASC`)
    .all(agentId).map(mapRow)
}
