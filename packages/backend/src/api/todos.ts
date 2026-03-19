import { Hono } from 'hono'
import * as todoStore from '../storage/todo-store.js'
import * as todoTimer from '../todos/todo-timer.js'
import { parseAndValidateDueAt } from '../todos/due-at.js'
import { sendToAll as broadcastAll } from '../gateway/broadcast.js'

export const todosApi = new Hono()

// List todos for an agent
todosApi.get('/', (c) => {
  const agentId = c.req.query('agentId')
  if (!agentId) return c.json({ error: 'agentId query param required' }, 400)
  const status = c.req.query('status')
  const todos = todoStore.listTodos(agentId, status || undefined)
  return c.json(todos)
})

// Create a todo
todosApi.post('/', async (c) => {
  const body = await c.req.json()
  const { agentId, title, description, dueAt } = body
  if (!agentId || !title) return c.json({ error: 'agentId and title required' }, 400)
  const parsedDueAt = parseAndValidateDueAt(dueAt)
  if (!parsedDueAt.ok) return c.json({ error: parsedDueAt.error }, 400)

  const todo = todoStore.createTodo({ agentId, title, description, dueAt: parsedDueAt.value })
  todoTimer.armTimer(todo.id, todo.dueAt)
  broadcastAll({ type: 'todo:change', payload: todo })
  return c.json(todo, 201)
})

// Update a todo
todosApi.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  if (body.dueAt !== undefined) {
    const parsedDueAt = parseAndValidateDueAt(body.dueAt)
    if (!parsedDueAt.ok) return c.json({ error: parsedDueAt.error }, 400)
    body.dueAt = parsedDueAt.value
  }

  const updated = todoStore.updateTodo(id, body)
  if (!updated) return c.json({ error: 'Not found' }, 404)

  // Reset timer if dueAt changed
  if (body.dueAt !== undefined || body.status !== undefined) {
    todoTimer.clearTimer(id)
    if (updated.status === 'pending' && updated.dueAt) {
      todoTimer.armTimer(id, updated.dueAt)
    }
  }

  broadcastAll({ type: 'todo:change', payload: updated })
  return c.json(updated)
})

// Delete a todo
todosApi.delete('/:id', (c) => {
  const id = c.req.param('id')
  const deleted = todoStore.deleteTodo(id)
  if (!deleted) return c.json({ error: 'Not found' }, 404)
  todoTimer.clearTimer(id)
  broadcastAll({ type: 'todo:delete', payload: { id, agentId: deleted.agentId } })
  return c.json({ ok: true })
})
