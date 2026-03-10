import * as todoStore from '../storage/todo-store.js'
import { sendMessage } from '../agents/agent-manager.js'
import { broadcastAll } from '../websocket/ws-server.js'
import { MAX_SINGLE_TIMER_MS, isValidDueAtMs } from './due-at.js'

type Notifier = (agentId: string, content: string) => Promise<void>

const defaultNotifier: Notifier = async (agentId, content) => {
  await sendMessage(agentId, [{ authorName: 'System', content }], {
    source: 'dm',
    content,
  })
}

let notifier: Notifier = defaultNotifier

export function setNotifier(fn: Notifier): void {
  notifier = fn
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function _reset(): void {
  for (const [id] of timers) {
    clearTimer(id)
  }
  notifier = defaultNotifier
}

export function armTimer(todoId: string, dueAt: number): void {
  clearTimer(todoId)
  if (!isValidDueAtMs(dueAt)) {
    console.warn(`[todo-timer] Skipping timer for todo ${todoId}: invalid dueAt=${String(dueAt)}`)
    return
  }
  const remaining = dueAt - Date.now()
  const delay = remaining <= 0 ? 0 : Math.min(remaining, MAX_SINGLE_TIMER_MS)
  const timer = setTimeout(() => {
    timers.delete(todoId)
    onTimerFired(todoId).catch((err: any) => {
      console.warn(`[todo-timer] Timer callback failed for todo ${todoId}: ${err.message}`)
    })
  }, delay)
  timer.unref()
  timers.set(todoId, timer)
}

export function clearTimer(todoId: string): void {
  const existing = timers.get(todoId)
  if (existing) {
    clearTimeout(existing)
    timers.delete(todoId)
  }
}

async function onDue(todoId: string): Promise<void> {
  const todo = todoStore.getTodo(todoId)
  if (!todo || todo.status !== 'pending') return

  // Auto-mark as done so duplicate idle reminders don't fire for the same todo
  todoStore.updateTodo(todo.id, { status: 'done' })

  const content = `[Reminder] Your todo is due: "${todo.title}" (id: ${todo.id})${todo.description ? `\n${todo.description}` : ''}\n\nThis todo has been auto-completed. Remember to schedule your next todo to stay active.`

  try {
    await notifier(todo.agentId, content)
  } catch (err: any) {
    console.warn(`[todo-timer] Failed to DM agent ${todo.agentId} for todo ${todoId}: ${err.message}`)
  }
}

async function onTimerFired(todoId: string): Promise<void> {
  const todo = todoStore.getTodo(todoId)
  if (!todo || todo.status !== 'pending') return

  if (!isValidDueAtMs(todo.dueAt)) {
    console.warn(`[todo-timer] Skipping timer for todo ${todoId}: invalid persisted dueAt=${String(todo.dueAt)}`)
    return
  }

  const remaining = todo.dueAt - Date.now()
  if (remaining > 0) {
    armTimer(todo.id, todo.dueAt)
    return
  }

  await onDue(todoId)
}

export function reloadTimers(): void {
  // Clear all existing timers
  for (const [id] of timers) {
    clearTimer(id)
  }

  const pending = todoStore.getPendingTodosWithDue()
  for (const todo of pending) {
    if (todo.dueAt !== undefined) {
      armTimer(todo.id, todo.dueAt)
    }
  }
  console.log(`[todo-timer] Loaded ${pending.length} pending timers`)
}
