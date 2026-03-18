import { LitElement, html, css } from 'lit'
import { customElement, query } from 'lit/decorators.js'

@customElement('create-agent-dialog')
export class CreateAgentDialog extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement

  static styles = css`
    dialog {
      background: var(--bg-elevated);
      color: var(--text-primary);
      border: none;
      border-radius: var(--radius-lg);
      padding: 16px;
      max-width: 520px;
      width: min(92vw, 520px);
      box-shadow: var(--shadow-lg);
    }

    dialog::backdrop {
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
    }

    h2 {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
      line-height: 1.25;
    }

    .subtitle {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
      margin-bottom: var(--space-md);
    }

    label {
      display: block;
      font-size: var(--text-body-size);
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--space-xs);
      margin-top: var(--space-md);
    }

    input,
    textarea {
      width: 100%;
      background: var(--bg-surface);
      border: none;
      border-radius: var(--radius-sm);
      padding: 9px 11px;
      color: var(--text-primary);
      font-family: var(--font);
      font-size: var(--text-body-size);
      outline: none;
      box-sizing: border-box;
      transition: box-shadow var(--transition-fast);
    }

    input:focus,
    textarea:focus {
      box-shadow: 0 0 0 2px var(--focus-ring);
    }

    textarea {
      min-height: 82px;
      resize: vertical;
      line-height: 1.5;
    }

    .colors {
      display: flex;
      gap: var(--space-sm);
      margin-top: var(--space-xs);
      flex-wrap: wrap;
    }

    .role-options {
      display: flex;
      gap: var(--space-sm);
      margin-top: var(--space-xs);
    }

    .role-btn {
      flex: 1;
      min-height: 42px;
      border: 1px solid var(--border-color, #334155);
      background: var(--bg-surface);
      color: var(--text-primary);
      text-align: left;
      padding: 10px 12px;
    }

    .role-btn.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
    }

    .role-title {
      font-size: var(--text-body-size);
      font-weight: 600;
    }

    .role-copy {
      margin-top: 4px;
      font-size: var(--text-meta-size);
      color: var(--text-muted);
      line-height: 1.4;
    }

    .color-btn {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: 2px solid transparent;
      box-shadow: none;
      cursor: pointer;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }

    .color-btn:hover {
      transform: none;
    }

    .color-btn.selected {
      border-color: var(--text-primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-sm);
      margin-top: var(--space-md);
    }

    button {
      height: var(--control-height);
      border-radius: var(--radius-sm);
      border: none;
      padding: 0 14px;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      transition: all var(--transition-fast);
    }

    .cancel {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .cancel:hover {
      background: var(--bg-hover);
    }

    .create {
      background: var(--accent);
      color: white;
    }

    .create:hover {
      background: var(--accent-hover);
    }

    @media (max-width: 760px) {
      dialog {
        border-radius: var(--radius);
        padding: 20px;
      }
    }
  `

  private colors = ['#0f9a90', '#0ea5e9', '#3b82f6', '#6d28d9', '#ef4444', '#f97316', '#10b981', '#64748b']
  private selectedColor = this.colors[0]
  private selectedRole: 'leader' | 'follower' = 'follower'

  open() {
    this.shadowRoot?.querySelector('form')?.reset()
    this.selectedColor = this.colors[0]
    this.selectedRole = 'follower'
    this.requestUpdate()
    this.dialog?.showModal()
  }

  close() {
    this.dialog?.close()
  }

  private handleSubmit() {
    const form = this.shadowRoot!.querySelector('form') as HTMLFormElement
    const name = (form.querySelector('[name=name]') as HTMLInputElement).value.trim()
    const personality = (form.querySelector('[name=personality]') as HTMLTextAreaElement).value.trim()
    if (!name) return
    this.dispatchEvent(new CustomEvent('agent-created', {
      detail: {
        name,
        personality: personality || 'You are a helpful AI assistant.',
        role: this.selectedRole,
        avatarColor: this.selectedColor,
      },
      bubbles: true,
      composed: true,
    }))
    form.reset()
    this.close()
  }

  render() {
    return html`
      <dialog>
        <h2>Create Agent</h2>
        <p class="subtitle">Define a specialist with clear behavior and a strong voice.</p>
        <form @submit=${(e: Event) => { e.preventDefault(); this.handleSubmit() }}>
          <label for="agent-name">Name</label>
          <input id="agent-name" name="name" placeholder="e.g. Release Captain" required>

          <label for="agent-personality">Role and personality</label>
          <textarea id="agent-personality" name="personality" placeholder="Describe scope, writing style, and decision boundaries..."></textarea>

          <label>Agent role</label>
          <div class="role-options" role="radiogroup" aria-label="Agent role">
            ${[
              { id: 'leader', title: 'Leader', description: 'Defaults to Plan First with an Opus model override.' },
              { id: 'follower', title: 'Follower', description: 'Defaults to Normal mode and inherits the workspace model.' },
            ].map(role => html`
              <button
                class="role-btn ${role.id === this.selectedRole ? 'selected' : ''}"
                type="button"
                @click=${() => { this.selectedRole = role.id as 'leader' | 'follower'; this.requestUpdate() }}
                aria-pressed=${role.id === this.selectedRole}
              >
                <div class="role-title">${role.title}</div>
                <div class="role-copy">${role.description}</div>
              </button>
            `)}
          </div>

          <label>Avatar color</label>
          <div class="colors" role="radiogroup" aria-label="Avatar color">
            ${this.colors.map(c => html`
              <button
                class="color-btn ${c === this.selectedColor ? 'selected' : ''}"
                style="background: ${c}"
                @click=${(e: Event) => { e.preventDefault(); this.selectedColor = c; this.requestUpdate() }}
                type="button"
                title=${`Select ${c}`}
                aria-label=${`Select ${c}`}
                aria-pressed=${c === this.selectedColor}
              ></button>
            `)}
          </div>

          <div class="actions">
            <button type="button" class="cancel" @click=${this.close}>Cancel</button>
            <button type="submit" class="create">Create</button>
          </div>
        </form>
      </dialog>
    `
  }
}
