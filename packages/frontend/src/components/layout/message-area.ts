import { LitElement, html, css } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { Message, Agent, Channel, SelectedModelProvider } from '@dune/shared'
import type { MentionPopup } from '../messages/mention-popup.js'
import './codex-composer.js'
import type {
  CodexComposer,
  CodexComposerAddAction,
  CodexComposerInputDetail,
  CodexComposerKeydownDetail,
} from './codex-composer.js'

const CHANNEL_COMPOSER_ACTIONS: CodexComposerAddAction[] = []

@customElement('message-area')
export class MessageArea extends LitElement {
  @property({ type: Array }) messages: Message[] = []
  @property({ type: Array }) agents: Agent[] = []
  @property({ type: Object }) channel: Channel | null = null
  @property({ type: Array }) typingAgentIds: string[] = []
  @property({ type: Number }) subscriberCount = 0
  @property({ attribute: false }) selectedModelProvider: SelectedModelProvider | null = null

  @state() private mentionActive = false
  @state() private mentionFilter = ''
  @state() private showModelSelectionPrompt = false
  private mentionStartPos = 0

  @query('.messages') messagesContainer!: HTMLDivElement
  @query('codex-composer') composerEl!: CodexComposer
  @query('mention-popup') popupEl!: MentionPopup

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
      padding: 8px 10px;
      background: var(--bg-primary);
      min-height: var(--header-height);
    }

    .header-main {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
      flex: 1;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      transition: background var(--transition-fast);
    }

    .header-left:hover {
      background: var(--bg-hover);
    }

    .channel-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--accent-soft) 72%, var(--bg-elevated));
      color: var(--accent);
      font-size: 15px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .header-titles {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .header-name {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .header-desc {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      line-height: 1.3;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
    }

    .members-btn {
      border: none;
      border-radius: var(--radius-sm);
      height: var(--control-height);
      background: var(--bg-subtle);
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-xs);
      cursor: pointer;
      transition: all var(--transition-fast);
      box-shadow: none;
    }

    .members-btn {
      padding: 0 9px;
      min-width: 46px;
      font-size: var(--text-meta-size);
      font-weight: 600;
    }

    .members-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      transform: none;
    }

    .members-btn svg {
      width: 16px;
      height: 16px;
      stroke-width: 1.9;
      stroke: currentColor;
      fill: none;
      flex-shrink: 0;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px 10px;
      background: transparent;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 0;
    }

    .empty {
      margin: auto;
      width: min(540px, 100%);
      border-radius: var(--radius);
      padding: var(--space-xl) var(--space-lg);
      color: var(--text-secondary);
      font-size: 15px;
      text-align: center;
      background: var(--bg-surface);
    }

    .typing {
      padding: 0 10px 5px;
      font-size: var(--text-meta-size);
      color: var(--text-muted);
      min-height: 20px;
      line-height: 1.4;
    }

    .typing-active {
      color: var(--text-secondary);
    }

    .input-area {
      padding: 4px 0 6px;
      background: var(--bg-primary);
    }

    .input-guard {
      width: var(--composer-main-ratio);
      margin: 0 auto 8px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--warning) 10%, var(--bg-surface));
      color: var(--text-primary);
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .input-guard-copy {
      font-size: var(--text-secondary-size);
      line-height: 1.4;
      color: var(--text-secondary);
    }

    .input-guard-btn {
      border: none;
      border-radius: var(--radius-sm);
      min-height: 30px;
      padding: 0 10px;
      background: var(--bg-hover);
      color: var(--text-primary);
      font-size: var(--text-secondary-size);
      font-weight: 600;
    }

    .composer-shell {
      position: relative;
      width: var(--composer-main-ratio);
      margin-inline: auto;
    }

    @media (max-width: 1024px) {
      .header,
      .messages,
      .typing {
        padding-left: 10px;
        padding-right: 10px;
      }
    }

    @media (max-width: 760px) {
      .header {
        min-height: var(--header-height);
        padding-top: 8px;
        padding-bottom: 8px;
      }

      .channel-mark {
        width: 24px;
        height: 24px;
        border-radius: 8px;
      }

      .header-name {
        font-size: 15px;
      }

      .header-desc {
        font-size: 11px;
      }

      .members-btn span:last-child {
        min-width: 12px;
      }

      .messages {
        padding-top: 6px;
      }

      .input-area {
        padding-bottom: 6px;
      }

      .composer-shell {
        width: calc(100% - 20px);
      }

      .input-guard {
        width: calc(100% - 20px);
      }
    }

  `

  private getAgentName(id: string): string {
    if (id === 'admin') return 'You'
    if (id === 'system') return 'System'
    return this.agents.find(a => a.id === id)?.name || 'Unknown'
  }

  private getAgentColor(id: string): string {
    if (id === 'admin') return 'var(--text-muted)'
    if (id === 'system') return 'var(--text-muted)'
    return this.agents.find(a => a.id === id)?.avatarColor || 'var(--text-muted)'
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight
      }
    })
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('messages')) {
      this.scrollToBottom()
    }
    if (changed.has('channel') && this.composerEl) {
      this.composerEl.value = ''
      this.mentionActive = false
    }
    if (changed.has('selectedModelProvider') && this.selectedModelProvider) {
      this.showModelSelectionPrompt = false
    }
  }

  private handleOpenDetails() {
    if (!this.channel) return
    this.dispatchEvent(new CustomEvent('open-channel-details', {
      detail: this.channel.id,
      bubbles: true,
      composed: true,
    }))
  }

  private handleManageMembers() {
    if (!this.channel) return
    this.dispatchEvent(new CustomEvent('manage-members', {
      detail: this.channel.id,
      bubbles: true,
      composed: true,
    }))
  }

  private handleSend() {
    const content = this.composerEl?.value?.trim()
    if (!content || !this.channel) return
    if (!this.selectedModelProvider) {
      this.showModelSelectionPrompt = true
      this.composerEl?.focusInput()
      return
    }
    this.dispatchEvent(new CustomEvent('send-message', {
      detail: { channelId: this.channel.id, content },
      bubbles: true,
      composed: true,
    }))
    this.composerEl.value = ''
    this.composerEl.focusInput()
    this.mentionActive = false
  }

  private updateMentionState(value: string, cursor: number) {
    for (let i = cursor - 1; i >= 0; i--) {
      if (value[i] === '@') {
        if (i === 0 || /\s/.test(value[i - 1])) {
          this.mentionActive = true
          this.mentionFilter = value.slice(i + 1, cursor)
          this.mentionStartPos = i
          return
        }
        break
      }
      if (/\s/.test(value[i])) break
    }
    this.mentionActive = false
  }

  private handleComposerInput(e: CustomEvent<CodexComposerInputDetail>) {
    this.updateMentionState(e.detail.value, e.detail.cursor)
  }

  private handleComposerKeydown(e: CustomEvent<CodexComposerKeydownDetail>) {
    const keyboardEvent = e.detail.event
    if (this.mentionActive && this.popupEl) {
      const handled = this.popupEl.handleKeydown(keyboardEvent)
      if (handled) {
        keyboardEvent.preventDefault()
        return
      }
    }

    const wantsSend = keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey
    if (wantsSend) {
      keyboardEvent.preventDefault()
      this.handleSend()
    }
  }

  private handleMentionSelect(e: CustomEvent) {
    const agent = e.detail as Agent
    const value = this.composerEl?.value ?? ''
    const cursor = this.composerEl?.cursor ?? value.length
    const before = value.slice(0, this.mentionStartPos)
    const after = value.slice(cursor)
    this.composerEl.value = `${before}@${agent.name} ${after}`
    this.mentionActive = false

    const newPos = before.length + 1 + agent.name.length + 1
    this.composerEl.setCursor(newPos)
    this.composerEl.focusInput()
  }

  private handleOpenModelSettings() {
    this.dispatchEvent(new CustomEvent<{ section: 'model' }>('open-settings', {
      detail: { section: 'model' },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    if (!this.channel) {
      return html`<div class="messages"><p class="empty">Select or create a channel to start collaborating.</p></div>`
    }

    const typingNames = this.typingAgentIds.map(id => this.getAgentName(id))
    const typingText = typingNames.length > 0
      ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} thinking...`
      : ''

    return html`
      <div class="header">
        <div class="header-main">
          <div class="header-left" @click=${this.handleOpenDetails}>
            <span class="channel-mark" aria-hidden="true">#</span>
            <div class="header-titles">
              <span class="header-name">${this.channel.name}</span>
              ${this.channel.description
                ? html`<span class="header-desc">${this.channel.description}</span>`
                : html`<span class="header-desc">No description yet. Click to add one.</span>`}
            </div>
          </div>
        </div>
        <div class="header-right">
          <button class="members-btn" type="button" title="Manage members" @click=${this.handleManageMembers}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-6.5a3.5 3.5 0 0 1 0 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>${this.subscriberCount}</span>
          </button>
        </div>
      </div>

      <div class="messages">
        ${this.messages.length === 0
          ? html`<p class="empty">No messages yet. Start with a clear prompt so agents can coordinate effectively.</p>`
          : this.messages.map(m => html`
            <message-item
              class=${m.authorId === 'system' ? 'system' : ''}
              .message=${m}
              .agentName=${this.getAgentName(m.authorId)}
              .agentColor=${this.getAgentColor(m.authorId)}
            ></message-item>
          `)
        }
      </div>

      <div class="typing ${typingText ? 'typing-active' : ''}">${typingText}</div>

      <div class="input-area">
        ${this.showModelSelectionPrompt
          ? html`
              <div class="input-guard" role="status" aria-live="polite">
                <div class="input-guard-copy">Set a model in Settings &gt; Model first.</div>
                <button class="input-guard-btn" type="button" @click=${this.handleOpenModelSettings}>
                  Open Settings
                </button>
              </div>
            `
          : ''}
        <div class="composer-shell">
          <mention-popup
            .agents=${this.agents}
            .filter=${this.mentionFilter}
            .visible=${this.mentionActive}
            @mention-select=${this.handleMentionSelect}
            @mention-close=${() => { this.mentionActive = false }}
          ></mention-popup>
          <codex-composer
            .placeholder=${`Message #${this.channel.name}...`}
            .addActions=${CHANNEL_COMPOSER_ACTIONS}
            @composer-input=${this.handleComposerInput}
            @composer-keydown=${this.handleComposerKeydown}
            @composer-send=${this.handleSend}
          ></codex-composer>
        </div>
      </div>
    `
  }
}
