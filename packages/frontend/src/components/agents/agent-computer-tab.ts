import { LitElement, html, css } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import * as api from '../../services/rpc.js'

@customElement('agent-computer-tab')
export class AgentComputerTab extends LitElement {
  @property({ type: String }) agentId: string = ''
  @property({ type: Number }) guiHttpPort: number = 0
  @litState() private screenshotSrc: string = ''
  @litState() private screenshotError: string = ''
  @litState() private polling = false

  private pollTimer?: ReturnType<typeof setInterval>

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    .container {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: 8px 10px;
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--bg-surface);
    }

    .toolbar-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 7px;
      border-radius: 999px;
      border: none;
      background: var(--bg-hover);
      color: var(--text-secondary);
      font-weight: 600;
    }

    .toolbar-badge svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }

    .spacer {
      flex: 1;
    }

    .open-link {
      color: var(--accent);
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
      border-radius: var(--radius-sm);
      padding: 4px 8px;
      transition: background var(--transition-fast);
    }

    .open-link:hover {
      background: var(--accent-soft);
    }

    .control-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: none;
      border-radius: var(--radius-sm);
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-hover);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .control-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .control-btn svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .iframe-container {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      background: var(--bg-subtle);
    }

    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }

    .screenshot-container {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: var(--space-md);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: var(--bg-primary);
    }

    .screenshot-container img {
      max-width: 100%;
      border-radius: var(--radius);
      box-shadow: var(--shadow-md);
    }

    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      padding: var(--space-lg);
      text-align: center;
    }

    .error {
      color: var(--error);
      font-size: 12px;
      margin: var(--space-sm) var(--space-md) 0;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--error) 10%, transparent);
    }
  `

  disconnectedCallback() {
    super.disconnectedCallback()
    this.stopPolling()
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('agentId') || changed.has('guiHttpPort')) {
      this.screenshotSrc = ''
      this.screenshotError = ''
      this.stopPolling()
    }
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
      this.polling = false
    }
  }

  private startPolling() {
    if (this.polling) return
    this.polling = true
    this.takeScreenshot()
    this.pollTimer = setInterval(() => this.takeScreenshot(), 2000)
  }

  private async takeScreenshot() {
    if (!this.agentId) return
    try {
      const shot = await api.getAgentScreenshot(this.agentId)
      this.screenshotSrc = `data:image/png;base64,${shot.data}`
      this.screenshotError = ''
    } catch (err: any) {
      this.screenshotError = err.message || 'Failed to take screenshot'
    }
  }

  render() {
    if (!this.agentId) {
      return html`<div class="empty">No agent selected.</div>`
    }

    if (this.guiHttpPort) {
      const url = `http://localhost:${this.guiHttpPort}`
      return html`
        <div class="container">
          <div class="toolbar">
            <span class="toolbar-badge">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12h20M12 2v20" stroke-linecap="round"></path>
              </svg>
              <span>Desktop</span>
            </span>
            <span class="spacer"></span>
            <a class="open-link" href=${url} target="_blank" rel="noopener">Open in new tab</a>
          </div>
          <div class="iframe-container">
            <iframe src=${url} allow="clipboard-read; clipboard-write"></iframe>
          </div>
        </div>
      `
    }

    return html`
      <div class="container">
        <div class="toolbar">
          <span class="toolbar-badge">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"></path>
            </svg>
            <span>Screenshot Mode</span>
          </span>
          <span class="spacer"></span>
          <button class="control-btn" type="button" @click=${() => this.startPolling()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 6v12l10-6-10-6Z" stroke-linejoin="round"></path>
            </svg>
            <span>${this.polling ? 'Live' : 'Start Live'}</span>
          </button>
          <button class="control-btn" type="button" @click=${() => this.takeScreenshot()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 9h2l1-2h4l1 2h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" stroke-linejoin="round"></path>
              <circle cx="12" cy="14" r="3"></circle>
            </svg>
            <span>Capture</span>
          </button>
        </div>
        ${this.screenshotError ? html`<div class="error">${this.screenshotError}</div>` : ''}
        ${this.screenshotSrc
          ? html`<div class="screenshot-container"><img src=${this.screenshotSrc} alt="Agent desktop" /></div>`
          : html`<div class="empty">Capture a screenshot to inspect the agent desktop.</div>`}
      </div>
    `
  }
}
