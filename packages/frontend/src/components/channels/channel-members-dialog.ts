import { LitElement, html, css } from 'lit'
import { customElement, property, query, state as litState } from 'lit/decorators.js'
import type { Agent } from '@dune/shared'
import * as api from '../../services/rpc.js'

@customElement('channel-members-dialog')
export class ChannelMembersDialog extends LitElement {
  @property({ type: Array }) agents: Agent[] = []
  @query('dialog') dialog!: HTMLDialogElement
  @litState() private subscribedIds: string[] = []
  @litState() private loading = false
  private channelId = ''

  static styles = css`
    dialog {
      background: var(--bg-elevated);
      color: var(--text-primary);
      border: none;
      border-radius: var(--radius-lg);
      padding: 18px;
      max-width: 460px;
      width: min(92vw, 460px);
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
      margin: 0 0 2px;
    }

    .subtitle {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: var(--space-md);
    }

    .agent-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 320px;
      overflow-y: auto;
      padding-right: 2px;
    }

    .agent-row {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      border: none;
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .agent-row:hover {
      background: var(--bg-hover);
    }

    .agent-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .agent-name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toggle {
      position: relative;
      width: 38px;
      height: 20px;
      border-radius: 999px;
      background: var(--bg-subtle);
      border: none;
      cursor: pointer;
      padding: 0;
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }

    .toggle.active {
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

    .toggle.active::after {
      transform: translateX(18px);
    }

    .empty,
    .loading {
      border-radius: var(--radius);
      padding: 16px;
      font-size: 13px;
      text-align: center;
      color: var(--text-muted);
      background: var(--bg-surface);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--space-lg);
    }

    .done-btn {
      height: 34px;
      border-radius: var(--radius-sm);
      border: none;
      padding: 0 14px;
      font-size: 13px;
      font-weight: 600;
      background: var(--accent);
      color: white;
      transition: transform var(--transition-fast), filter var(--transition-fast);
    }

    .done-btn:hover {
      background: var(--accent-hover);
      transform: none;
    }
  `

  async open(channelId: string) {
    this.channelId = channelId
    this.loading = true
    this.dialog?.showModal()
    try {
      this.subscribedIds = await api.getChannelSubscribers(channelId)
    } catch (e) {
      console.error('Failed to load subscribers:', e)
      this.subscribedIds = []
    }
    this.loading = false
  }

  private close() {
    this.dialog?.close()
    this.dispatchEvent(new CustomEvent('members-changed', {
      detail: { channelId: this.channelId, count: this.subscribedIds.length },
      bubbles: true,
      composed: true,
    }))
  }

  private async toggleAgent(agentId: string) {
    const isSubscribed = this.subscribedIds.includes(agentId)
    try {
      if (isSubscribed) {
        await api.unsubscribeAgentFromChannel(this.channelId, agentId)
        this.subscribedIds = this.subscribedIds.filter(id => id !== agentId)
      } else {
        await api.subscribeAgentToChannel(this.channelId, agentId)
        this.subscribedIds = [...this.subscribedIds, agentId]
      }
    } catch (e) {
      console.error('Failed to update subscription:', e)
    }
  }

  render() {
    return html`
      <dialog>
        <h2>Channel Members</h2>
        <div class="subtitle">${this.subscribedIds.length} agent${this.subscribedIds.length !== 1 ? 's' : ''} currently subscribed</div>

        ${this.loading
          ? html`<div class="loading">Loading members...</div>`
          : this.agents.length === 0
            ? html`<div class="empty">No agents available yet.</div>`
            : html`
              <div class="agent-list">
                ${this.agents.map(a => {
                  const subscribed = this.subscribedIds.includes(a.id)
                  return html`
                    <div class="agent-row" @click=${() => this.toggleAgent(a.id)}>
                      <span class="agent-dot" style="background: ${a.avatarColor}"></span>
                      <span class="agent-name">${a.name}</span>
                      <button
                        class="toggle ${subscribed ? 'active' : ''}"
                        type="button"
                        aria-label=${subscribed ? `Remove ${a.name}` : `Add ${a.name}`}
                        @click=${(e: Event) => { e.stopPropagation(); this.toggleAgent(a.id) }}
                      ></button>
                    </div>
                  `
                })}
              </div>
            `}

        <div class="actions">
          <button class="done-btn" type="button" @click=${this.close}>Done</button>
        </div>
      </dialog>
    `
  }
}
