import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import type { Todo } from '@dune/shared'
import * as api from '../../services/rpc.js'
import { state } from '../../state/app-state.js'

@customElement('agent-todo-panel')
export class AgentTodoPanel extends LitElement {
  @property({ type: String }) agentId = ''
  @litState() private todos: Todo[] = []
  @litState() private loading = true
  @litState() private newTitle = ''
  @litState() private newDueIn = '' // minutes from now
  @litState() private editingId: string | null = null
  @litState() private editTitle = ''

  static styles = css`
    :host {
      display: block;
    }

    .todo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .todo-header h3 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .add-form {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
    }

    .add-form input {
      flex: 1;
      min-width: 0;
      padding: 6px 8px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--border-color, #334155);
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      color: var(--text-primary);
      outline: none;
    }

    .add-form input:focus {
      border-color: var(--accent);
    }

    .add-form input.due-input {
      width: 60px;
      flex: none;
    }

    .add-btn {
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }

    .add-btn:hover { opacity: 0.9; }
    .add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .todo-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .todo-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      font-size: 13px;
    }

    .todo-main {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .todo-item:hover {
      background: var(--bg-hover);
    }

    .todo-check {
      width: 16px;
      height: 16px;
      border-radius: 3px;
      border: 2px solid var(--text-muted);
      background: none;
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .todo-check:hover {
      border-color: var(--accent);
    }

    .todo-check.done {
      background: var(--accent);
      border-color: var(--accent);
    }

    .todo-check.done::after {
      content: '✓';
      color: white;
      font-size: 11px;
      font-weight: bold;
    }

    .todo-text {
      flex: 1;
      min-width: 0;
      color: var(--text-primary);
      cursor: text;
    }

    .todo-text.done {
      text-decoration: line-through;
      color: var(--text-muted);
    }

    .todo-due {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .todo-due.overdue {
      color: var(--error);
      font-weight: 600;
    }

    .todo-delete {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 4px;
      font-size: 11px;
      border-radius: var(--radius-sm);
      opacity: 0;
      transition: opacity 0.15s;
    }

    .todo-item:hover .todo-delete {
      opacity: 1;
    }

    .todo-delete:hover {
      color: var(--error);
    }

    .todo-meta {
      padding-left: 24px;
      font-size: 11px;
      color: var(--text-secondary);
      line-height: 1.4;
      white-space: pre-wrap;
    }

    .todo-plan {
      padding-left: 24px;
      font-size: 11px;
      color: var(--text-primary);
      line-height: 1.4;
      white-space: pre-wrap;
    }

    .edit-input {
      flex: 1;
      min-width: 0;
      padding: 2px 6px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid var(--accent);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      outline: none;
    }

    .empty {
      font-size: 13px;
      color: var(--text-muted);
      font-style: italic;
    }
  `

  private wsHandlers: Array<{ event: string; handler: (payload: any) => void }> = []

  connectedCallback() {
    super.connectedCallback()
    this.loadTodos()
    this.setupWs()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    for (const { event, handler } of this.wsHandlers) {
      state.ws?.off(event, handler)
    }
    this.wsHandlers = []
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('agentId') && this.agentId) {
      this.loadTodos()
    }
  }

  private setupWs() {
    const onChange = (payload: Todo) => {
      if (payload.agentId !== this.agentId) return
      const idx = this.todos.findIndex(t => t.id === payload.id)
      if (idx >= 0) {
        this.todos = [...this.todos.slice(0, idx), payload, ...this.todos.slice(idx + 1)]
      } else {
        this.todos = [payload, ...this.todos]
      }
    }
    const onDelete = (payload: { id: string; agentId: string }) => {
      if (payload.agentId !== this.agentId) return
      this.todos = this.todos.filter(t => t.id !== payload.id)
    }

    state.ws?.on('todo:change', onChange)
    state.ws?.on('todo:delete', onDelete)
    this.wsHandlers.push(
      { event: 'todo:change', handler: onChange },
      { event: 'todo:delete', handler: onDelete },
    )
  }

  private async loadTodos() {
    if (!this.agentId) return
    this.loading = true
    try {
      this.todos = await api.listTodos(this.agentId)
    } catch {
      this.todos = []
    } finally {
      this.loading = false
    }
  }

  private async handleAdd() {
    const title = this.newTitle.trim()
    if (!title) return

    const minutes = parseFloat(this.newDueIn.trim())
    if (!this.newDueIn.trim() || isNaN(minutes) || minutes <= 0) return

    const dueAt = Date.now() + minutes * 60_000

    try {
      await api.createTodo({ agentId: this.agentId, title, dueAt })
      this.newTitle = ''
      this.newDueIn = ''
    } catch (err) {
      console.error('Failed to create todo:', err)
    }
  }

  private handleAddKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.handleAdd()
    }
  }

  private async toggleDone(todo: Todo) {
    const newStatus = todo.status === 'done' ? 'pending' : 'done'
    try {
      await api.updateTodo(todo.id, { status: newStatus })
    } catch (err) {
      console.error('Failed to update todo:', err)
    }
  }

  private startEdit(todo: Todo) {
    this.editingId = todo.id
    this.editTitle = todo.title
  }

  private async saveEdit(todo: Todo) {
    this.editingId = null
    const newTitle = this.editTitle.trim()
    if (!newTitle || newTitle === todo.title) return
    try {
      await api.updateTodo(todo.id, { title: newTitle })
    } catch (err) {
      console.error('Failed to update todo:', err)
    }
  }

  private handleEditKeydown(e: KeyboardEvent, todo: Todo) {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.saveEdit(todo)
    } else if (e.key === 'Escape') {
      this.editingId = null
    }
  }

  private async handleDelete(id: string) {
    try {
      await api.deleteTodo(id)
    } catch (err) {
      console.error('Failed to delete todo:', err)
    }
  }

  private formatDue(dueAt: number): { text: string; overdue: boolean } {
    const now = Date.now()
    const overdue = dueAt <= now
    const diff = Math.abs(dueAt - now)
    const mins = Math.round(diff / 60_000)
    if (mins < 60) return { text: overdue ? `${mins}m ago` : `in ${mins}m`, overdue }
    const hours = Math.round(mins / 60)
    if (hours < 24) return { text: overdue ? `${hours}h ago` : `in ${hours}h`, overdue }
    const days = Math.round(hours / 24)
    return { text: overdue ? `${days}d ago` : `in ${days}d`, overdue }
  }

  render() {
    if (!this.agentId) return nothing

    const pending = this.todos.filter(t => t.status === 'pending')
    const done = this.todos.filter(t => t.status === 'done')

    return html`
      <div class="todo-header">
        <h3>Todos</h3>
      </div>

      <div class="add-form">
        <input
          placeholder="New todo..."
          .value=${this.newTitle}
          @input=${(e: Event) => { this.newTitle = (e.target as HTMLInputElement).value }}
          @keydown=${this.handleAddKeydown}
        />
        <input
          class="due-input"
          placeholder="min *"
          title="Due in minutes (required)"
          .value=${this.newDueIn}
          @input=${(e: Event) => { this.newDueIn = (e.target as HTMLInputElement).value }}
          @keydown=${this.handleAddKeydown}
        />
        <button class="add-btn" @click=${this.handleAdd} ?disabled=${!this.newTitle.trim() || !this.newDueIn.trim() || isNaN(parseFloat(this.newDueIn.trim())) || parseFloat(this.newDueIn.trim()) <= 0}>Add</button>
      </div>

      ${this.loading ? html`<div class="empty">Loading...</div>` : html`
        <div class="todo-list">
          ${pending.map(todo => this.renderTodoItem(todo))}
          ${done.map(todo => this.renderTodoItem(todo))}
        </div>
        ${this.todos.length === 0 ? html`<div class="empty">No todos yet</div>` : nothing}
      `}
    `
  }

  private renderTodoItem(todo: Todo) {
    const isDone = todo.status === 'done'
    const due = todo.dueAt ? this.formatDue(todo.dueAt) : null
    const showOriginalDescription = !!todo.originalDescription
    const showNextPlan = !!todo.nextPlan

    return html`
      <div class="todo-item">
        <div class="todo-main">
          <button
            class="todo-check ${isDone ? 'done' : ''}"
            @click=${() => this.toggleDone(todo)}
            title=${isDone ? 'Mark pending' : 'Mark done'}
          ></button>
          ${this.editingId === todo.id ? html`
            <input
              class="edit-input"
              .value=${this.editTitle}
              @input=${(e: Event) => { this.editTitle = (e.target as HTMLInputElement).value }}
              @keydown=${(e: KeyboardEvent) => this.handleEditKeydown(e, todo)}
              @blur=${() => this.saveEdit(todo)}
            />
          ` : html`
            <span class="todo-text ${isDone ? 'done' : ''}" @dblclick=${() => this.startEdit(todo)}>${todo.title}</span>
          `}
          ${due ? html`<span class="todo-due ${due.overdue && !isDone ? 'overdue' : ''}">${due.text}</span>` : nothing}
          <button class="todo-delete" @click=${() => this.handleDelete(todo.id)} title="Delete">✕</button>
        </div>
        <div class="todo-meta">Original request: ${todo.originalTitle}</div>
        ${showOriginalDescription ? html`<div class="todo-meta">Original details: ${todo.originalDescription}</div>` : nothing}
        ${showNextPlan ? html`<div class="todo-plan">Next plan: ${todo.nextPlan}</div>` : nothing}
      </div>
    `
  }
}
