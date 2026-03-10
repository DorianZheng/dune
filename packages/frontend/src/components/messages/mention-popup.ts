import { LitElement, html, css } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { Agent } from '@dune/shared'

@customElement('mention-popup')
export class MentionPopup extends LitElement {
  @property({ type: Array }) agents: Agent[] = []
  @property() filter = ''
  @property({ type: Boolean }) visible = false

  @state() private selectedIndex = 0

  static styles = css`
    :host {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 120;
      pointer-events: none;
    }

    .popup {
      background: var(--bg-elevated);
      border: none;
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      max-height: 232px;
      overflow-y: auto;
      pointer-events: auto;
      animation: popup-in var(--transition-fast);
      transform-origin: bottom center;
    }

    .popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
      padding: 10px 12px 6px;
      font-size: var(--text-meta-size);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: none;
    }

    .popup-hint {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: none;
      letter-spacing: 0;
    }

    .list {
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .row {
      display: grid;
      grid-template-columns: 26px 1fr auto auto;
      align-items: center;
      gap: var(--space-xs);
      border-radius: var(--radius-sm);
      border: none;
      padding: 6px 8px;
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .row:hover,
    .row.selected {
      background: var(--bg-hover);
    }

    .avatar {
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: white;
      flex-shrink: 0;
    }

    .name {
      font-size: var(--text-body-size);
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .hint {
      margin-left: var(--space-xs);
      padding: 2px 5px;
      border: none;
      border-radius: var(--radius-xs);
      font-size: 10px;
      color: var(--text-muted);
      line-height: 1;
      white-space: nowrap;
      flex-shrink: 0;
      background: color-mix(in srgb, var(--bg-elevated) 90%, white 10%);
    }

    .empty {
      padding: 12px;
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
    }

    @keyframes popup-in {
      from {
        opacity: 0;
        transform: translateY(4px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `

  private get filtered(): Agent[] {
    if (!this.filter) return this.agents
    const f = this.filter.toLowerCase()
    return this.agents.filter(a => a.name.toLowerCase().startsWith(f))
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('filter') || changed.has('agents')) {
      this.selectedIndex = 0
    }
  }

  private statusColor(status: string): string {
    switch (status) {
      case 'idle': return 'var(--success)'
      case 'thinking':
      case 'responding': return 'var(--warning)'
      case 'error': return 'var(--error)'
      default: return 'var(--text-muted)'
    }
  }

  handleKeydown(e: KeyboardEvent): boolean {
    const items = this.filtered
    if (items.length === 0) return false

    if (e.key === 'ArrowDown') {
      this.selectedIndex = (this.selectedIndex + 1) % items.length
      return true
    }
    if (e.key === 'ArrowUp') {
      this.selectedIndex = (this.selectedIndex - 1 + items.length) % items.length
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      this.selectAgent(items[this.selectedIndex])
      return true
    }
    if (e.key === 'Escape') {
      this.dispatchEvent(new CustomEvent('mention-close', { bubbles: true, composed: true }))
      return true
    }
    return false
  }

  private selectAgent(agent: Agent) {
    this.dispatchEvent(new CustomEvent('mention-select', {
      detail: agent,
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    if (!this.visible) return null

    const items = this.filtered
    if (items.length === 0) {
      return html`<div class="popup"><div class="empty">No matching agents</div></div>`
    }

    return html`
      <div class="popup">
        <div class="popup-header">
          <span>Agents</span>
          <span class="popup-hint">Arrow keys + Enter</span>
        </div>
        <div class="list">
          ${items.map((agent, i) => html`
            <div
              class="row ${i === this.selectedIndex ? 'selected' : ''}"
              @click=${() => this.selectAgent(agent)}
              @mouseenter=${() => { this.selectedIndex = i }}
            >
              <div class="avatar" style="background: ${agent.avatarColor}">${agent.name.charAt(0).toUpperCase()}</div>
              <span class="name">${agent.name}</span>
              <span class="status-dot" style="background: ${this.statusColor(agent.status)}"></span>
              ${i === this.selectedIndex ? html`<span class="hint">Enter</span>` : null}
            </div>
          `)}
        </div>
      </div>
    `
  }
}
