import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Message } from '@dune/shared'

@customElement('message-item')
export class MessageItem extends LitElement {
  @property({ type: Object }) message!: Message
  @property() agentName = ''
  @property() agentColor = '#64748b'

  static styles = css`
    :host {
      display: flex;
      gap: var(--space-sm);
      padding: 8px 8px;
      border-radius: var(--radius-sm);
      transition: background var(--transition-fast);
      position: relative;
      isolation: isolate;
    }

    :host(:hover) {
      background: color-mix(in srgb, var(--bg-hover) 86%, white 14%);
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      flex-shrink: 0;
      margin-top: 2px;
      border: none;
    }

    .avatar.system {
      color: var(--text-muted);
      background: var(--bg-hover);
    }

    .avatar.clickable,
    .name.clickable {
      cursor: pointer;
    }

    .avatar.clickable:hover {
      filter: brightness(0.96);
    }

    .body {
      flex: 1;
      min-width: 0;
    }

    .meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-sm);
      margin-bottom: 2px;
    }

    .name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.2;
    }

    .name.clickable:hover {
      color: var(--accent);
      text-decoration: underline;
      text-decoration-thickness: 1.5px;
      text-underline-offset: 2px;
    }

    .time {
      font-size: 11px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .content {
      font-size: 14px;
      color: var(--text-primary);
      line-height: 1.55;
      word-break: break-word;
    }

    .content p {
      margin: 0 0 var(--space-xs) 0;
    }

    .content p:last-child {
      margin-bottom: 0;
    }

    .content code {
      background: var(--bg-code);
      color: var(--text-secondary);
      padding: 2px 5px;
      border-radius: var(--radius-xs);
      border: none;
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .content pre {
      background: var(--bg-code);
      padding: 12px 14px;
      border-radius: var(--radius-sm);
      border: none;
      overflow-x: auto;
      margin: var(--space-xs) 0;
    }

    .content pre code {
      background: none;
      border: none;
      color: var(--text-primary);
      padding: 0;
    }

    :host(.system) {
      background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
      padding: 6px 9px;
    }

    :host(.system):hover {
      background: color-mix(in srgb, var(--bg-hover) 80%, transparent);
    }

    :host(.system) .name {
      font-weight: 600;
      color: var(--text-secondary);
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    :host(.system) .content {
      font-size: 13px;
      color: var(--text-secondary);
      font-style: italic;
      line-height: 1.45;
    }

    .system-icon {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      stroke-width: 1.9;
      fill: none;
    }
  `

  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  private renderContent(): unknown {
    const raw = marked.parse(this.message.content, { async: false }) as string
    const clean = DOMPurify.sanitize(raw)
    return unsafeHTML(clean)
  }

  private get isAgent(): boolean {
    return this.message.authorId !== 'admin' && this.message.authorId !== 'system'
  }

  private handleProfileClick() {
    if (!this.isAgent) return
    this.dispatchEvent(new CustomEvent('open-agent-profile', {
      detail: this.message.authorId,
      bubbles: true,
      composed: true,
    }))
  }

  private renderAvatar() {
    const isSystem = this.message.authorId === 'system'
    if (isSystem) {
      return html`
        <div class="avatar system" aria-hidden="true">
          <svg class="system-icon" viewBox="0 0 24 24">
            <path d="M12 16v-4m0-4h.01M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 0 0-17 0Z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      `
    }
    return html`
      <div class="avatar ${this.isAgent ? 'clickable' : ''}" style="background: ${this.agentColor}" @click=${this.handleProfileClick}>
        ${this.agentName.charAt(0).toUpperCase()}
      </div>
    `
  }

  render() {
    return html`
      ${this.renderAvatar()}
      <div class="body">
        <div class="meta">
          <span class="name ${this.isAgent ? 'clickable' : ''}" @click=${this.handleProfileClick}>${this.agentName}</span>
          <span class="time">${this.formatTime(this.message.timestamp)}</span>
        </div>
        <div class="content">${this.renderContent()}</div>
      </div>
    `
  }
}
