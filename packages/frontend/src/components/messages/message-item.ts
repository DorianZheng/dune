import { LitElement, html, css, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { githubAlertsExtension, githubAlertStyles } from '../../utils/marked-extensions.js'

marked.use(githubAlertsExtension)
import { highlightCodeBlocks } from '../../utils/shiki-highlighter.js'
import { renderMathBlocks } from '../../utils/katex-renderer.js'
import { renderMermaidBlocks } from '../../utils/mermaid-renderer.js'
import type { Message } from '@dune/shared'

@customElement('message-item')
export class MessageItem extends LitElement {
  @property({ type: Object }) message!: Message
  @property() agentName = ''
  @property() agentColor = '#64748b'

  static styles = css`
    :host {
      display: flex;
      gap: 12px;
      padding: 12px 14px 14px;
      border-radius: 18px;
      border: 1px solid var(--glass-border);
      background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
      transition: background var(--transition-fast), border-color var(--transition-fast);
      position: relative;
      isolation: isolate;
    }

    :host(:hover) {
      background: color-mix(in srgb, var(--bg-hover) 34%, var(--glass-bg));
      border-color: var(--border-primary);
    }

    .avatar {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      flex-shrink: 0;
      margin-top: 1px;
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
      margin-bottom: 8px;
    }

    .name {
      font-size: 13px;
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
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.58;
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
      border-radius: 14px;
      border: none;
      overflow-x: auto;
      margin: 10px 0;
    }

    .content pre code {
      background: none;
      border: none;
      color: var(--text-primary);
      padding: 0;
    }

    .content img {
      max-width: 100%;
      height: auto;
      border-radius: var(--radius);
      margin: 8px 0;
      cursor: pointer;
    }

    .content img:hover {
      opacity: 0.92;
    }

    .content pre .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--control-bg);
      border: 1px solid var(--control-border);
      color: var(--text-muted);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition-fast), background var(--transition-fast);
    }

    .content pre:hover .copy-btn {
      opacity: 1;
    }

    .content pre .copy-btn:hover {
      background: var(--control-bg-hover);
      color: var(--text-primary);
    }

    .content table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--text-primary);
      border-top: 1px solid var(--border-color);
    }

    .content thead tr {
      background: transparent;
    }

    .content th,
    .content td {
      padding: 10px 8px 10px 0;
      border-bottom: 1px solid var(--border-color);
      vertical-align: middle;
      text-align: left;
    }

    .content th {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .content td:last-child,
    .content th:last-child {
      text-align: right;
      padding-right: 0;
      white-space: nowrap;
      font-family: var(--font-mono);
    }

    .content tr:last-child td {
      border-bottom: none;
    }

    :host(.system) {
      background: color-mix(in srgb, var(--bg-hover) 72%, transparent);
      padding: 10px 12px;
      border-color: var(--border-light);
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

    ${unsafeCSS(githubAlertStyles)}
  `

  protected override updated(): void {
    if (this.shadowRoot) {
      highlightCodeBlocks(this.shadowRoot)
      renderMathBlocks(this.shadowRoot)
      renderMermaidBlocks(this.shadowRoot)
    }
  }

  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  private renderContent(): unknown {
    const raw = marked.parse(this.message.content, { async: false }) as string
    const clean = DOMPurify.sanitize(raw, {
      ADD_TAGS: ['img'],
      ADD_ATTR: ['src', 'alt', 'width', 'height', 'loading'],
    })
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
        <div class="avatar system" aria-hidden="true" data-testid="message-agent-avatar">
          <svg class="system-icon" viewBox="0 0 24 24">
            <path d="M12 16v-4m0-4h.01M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 0 0-17 0Z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      `
    }
    return html`
      <div
        class="avatar ${this.isAgent ? 'clickable' : ''}"
        style="background: ${this.agentColor}"
        @click=${this.handleProfileClick}
        data-testid="message-agent-avatar"
      >
        ${this.agentName.charAt(0).toUpperCase()}
      </div>
    `
  }

  render() {
    return html`
      ${this.renderAvatar()}
      <div class="body">
        <div class="meta">
          <span class="name ${this.isAgent ? 'clickable' : ''}" @click=${this.handleProfileClick} data-testid="message-agent-name">${this.agentName}</span>
          <span class="time">${this.formatTime(this.message.timestamp)}</span>
        </div>
        <div class="content">${this.renderContent()}</div>
      </div>
    `
  }
}
