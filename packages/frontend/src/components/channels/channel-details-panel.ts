import { LitElement, html, css } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import type { Channel, Agent } from '@dune/shared'
import * as api from '../../services/api-client.js'

@customElement('channel-details-panel')
export class ChannelDetailsPanel extends LitElement {
  @property({ type: Object }) channel: Channel | null = null
  @property({ type: Array }) agents: Agent[] = []
  @litState() private subscribers: string[] = []
  @litState() private editingName = false
  @litState() private editingDesc = false

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal {
      position: relative;
      width: min(560px, 92vw);
      max-height: 85vh;
      background: var(--bg-elevated);
      border: none;
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 14px 10px;
    }
    .channel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .hash {
      font-size: 16px;
      font-weight: 600;
      color: var(--accent);
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--accent-soft);
      flex-shrink: 0;
    }
    .name {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      cursor: pointer;
      border-radius: var(--radius-sm);
      padding: 3px 6px;
      margin: -3px -6px;
      transition: background var(--transition-fast);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name:hover {
      background: var(--bg-hover);
    }
    .name-input {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      background: var(--bg-surface);
      border: none;
      border-radius: var(--radius-sm);
      padding: 3px 6px;
      outline: none;
      font-family: var(--font);
      box-shadow: 0 0 0 2px var(--focus-ring);
      width: min(100%, 360px);
    }
    .close-btn {
      width: 30px;
      height: 30px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .close-btn:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }
    .close-btn svg {
      width: 16px;
      height: 16px;
      stroke-width: 2;
      stroke: currentColor;
      fill: none;
    }
    .tab-content {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      padding-top: var(--space-xs);
    }
    .section-card {
      margin: 0 12px 10px;
      border-radius: var(--radius);
      padding: 12px;
      background: var(--bg-surface);
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .section-content {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.5;
      margin: 0;
      cursor: pointer;
      padding: 6px;
      border-radius: var(--radius-sm);
      transition: background var(--transition-fast);
    }
    .section-content:hover {
      background: var(--bg-hover);
    }
    .desc-input {
      width: 100%;
      font-size: 14px;
      color: var(--text-primary);
      background: var(--bg-surface);
      border: none;
      border-radius: var(--radius-sm);
      padding: 8px;
      outline: none;
      font-family: var(--font);
      box-shadow: 0 0 0 2px var(--focus-ring);
      resize: vertical;
      min-height: 48px;
      box-sizing: border-box;
    }
    .placeholder {
      font-size: 13px;
      color: var(--text-muted);
      font-style: italic;
      margin: 0;
      cursor: pointer;
      padding: 6px;
      border-radius: var(--radius-sm);
    }
    .placeholder:hover {
      background: var(--bg-hover);
    }
    .member-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
    }
    .member-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .member-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }
    .member-name {
      font-size: 14px;
      color: var(--text-primary);
    }
    .toggle {
      position: relative;
      width: 38px;
      height: 20px;
      background: var(--bg-subtle);
      border: none;
      border-radius: 999px;
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .toggle.on {
      background: var(--accent);
    }
    .toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      box-shadow: var(--shadow-sm);
      transition: transform var(--transition-fast);
    }
    .toggle.on::after {
      transform: translateX(18px);
    }
    .actions-row {
      display: flex;
      gap: 8px;
      padding: 0 12px 12px;
      margin-top: 4px;
      padding-top: 10px;
    }
    .action-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-surface);
      border: none;
      border-radius: var(--radius-sm);
      padding: 7px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      transition: all var(--transition-fast);
    }
    .action-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .action-btn.danger:hover {
      color: var(--error);
      background: color-mix(in srgb, var(--error) 8%, transparent);
    }
    .created-text {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0;
    }

    @media (max-width: 760px) {
      .modal-header {
        padding: 16px 16px 12px;
      }

      .tab-content {
        padding-top: var(--space-xs);
      }

      .section-card,
      .actions-row {
        margin-left: 10px;
        margin-right: 10px;
      }

      .actions-row {
        padding: 12px 0 14px;
      }
    }
  `

  private _keyHandler: ((e: KeyboardEvent) => void) | null = null

  connectedCallback() {
    super.connectedCallback()
    this._keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.handleClose() }
    document.addEventListener('keydown', this._keyHandler)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler)
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('channel') && this.channel) {
      this.editingName = false
      this.editingDesc = false
      this.loadSubscribers()
    }
  }

  private async loadSubscribers() {
    if (!this.channel) return
    try {
      this.subscribers = await api.getChannelSubscribers(this.channel.id)
    } catch {
      this.subscribers = []
    }
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close-details', { bubbles: true, composed: true }))
  }

  private handleBackdropClick(e: Event) {
    if ((e.target as HTMLElement).classList.contains('backdrop')) this.handleClose()
  }

  private startEditName() {
    this.editingName = true
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.name-input') as HTMLInputElement
      input?.focus()
      input?.select()
    })
  }

  private saveName(e: Event) {
    const input = e.target as HTMLInputElement
    const name = input.value.trim()
    this.editingName = false
    if (!name || !this.channel || name === this.channel.name) return
    this.dispatchEvent(new CustomEvent('channel-updated', {
      detail: { id: this.channel.id, data: { name } },
      bubbles: true, composed: true,
    }))
  }

  private handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    if (e.key === 'Escape') { this.editingName = false }
  }

  private startEditDesc() {
    this.editingDesc = true
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.desc-input') as HTMLTextAreaElement
      input?.focus()
    })
  }

  private saveDesc(e: Event) {
    const input = e.target as HTMLTextAreaElement
    const description = input.value.trim()
    this.editingDesc = false
    if (!this.channel) return
    if (description === (this.channel.description || '')) return
    this.dispatchEvent(new CustomEvent('channel-updated', {
      detail: { id: this.channel.id, data: { description } },
      bubbles: true, composed: true,
    }))
  }

  private handleDescKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
    if (e.key === 'Escape') { this.editingDesc = false }
  }

  private async handleToggleMember(agentId: string) {
    if (!this.channel) return
    const isMember = this.subscribers.includes(agentId)
    try {
      if (isMember) {
        await api.unsubscribeAgentFromChannel(this.channel.id, agentId)
        this.subscribers = this.subscribers.filter(id => id !== agentId)
      } else {
        await api.subscribeAgentToChannel(this.channel.id, agentId)
        this.subscribers = [...this.subscribers, agentId]
      }
      this.dispatchEvent(new CustomEvent('members-changed', {
        detail: { count: this.subscribers.length },
        bubbles: true, composed: true,
      }))
    } catch (err) {
      console.error('Failed to toggle member:', err)
    }
  }

  private handleDelete() {
    if (!this.channel) return
    if (!confirm(`Delete channel "#${this.channel.name}"? All messages will be lost.`)) return
    this.dispatchEvent(new CustomEvent('channel-deleted', {
      detail: this.channel.id,
      bubbles: true, composed: true,
    }))
  }

  private formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  }

  render() {
    const ch = this.channel
    if (!ch) return html``

    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        <div class="modal">
          <div class="modal-header">
            <div class="channel-title">
              <span class="hash">#</span>
              ${this.editingName
                ? html`<input class="name-input" .value=${ch.name} @blur=${this.saveName} @keydown=${this.handleNameKeydown}>`
                : html`<span class="name" @click=${this.startEditName}>${ch.name}</span>`
              }
            </div>
            <button class="close-btn" type="button" @click=${this.handleClose} aria-label="Close channel details">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"></path>
              </svg>
            </button>
          </div>

          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">Description</div>
              ${this.editingDesc
                ? html`<textarea class="desc-input" .value=${ch.description || ''} @blur=${this.saveDesc} @keydown=${this.handleDescKeydown}></textarea>`
                : ch.description
                  ? html`<p class="section-content" @click=${this.startEditDesc}>${ch.description}</p>`
                  : html`<p class="placeholder" @click=${this.startEditDesc}>Add a description...</p>`
              }
            </div>

            <div class="section-card">
              <div class="section-title">Members (${this.subscribers.length})</div>
              ${this.agents.map(a => {
                const isMember = this.subscribers.includes(a.id)
                return html`
                  <div class="member-row">
                    <div class="member-info">
                      <span class="member-dot" style="background: ${a.avatarColor}"></span>
                      <span class="member-name">${a.name}</span>
                    </div>
                    <button class="toggle ${isMember ? 'on' : ''}" @click=${() => this.handleToggleMember(a.id)}></button>
                  </div>
                `
              })}
              ${this.agents.length === 0 ? html`<p class="placeholder">No agents created yet</p>` : ''}
            </div>

            <div class="section-card">
              <div class="section-title">Created</div>
              <p class="created-text">${this.formatDate(ch.createdAt)}</p>
            </div>
          </div>

          <div class="actions-row">
            <button class="action-btn danger" @click=${this.handleDelete}>Delete channel</button>
          </div>
        </div>
      </div>
    `
  }
}
