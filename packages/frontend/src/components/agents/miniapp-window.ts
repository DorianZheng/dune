import { LitElement, css, html } from 'lit'
import { customElement, property, query, state as litState } from 'lit/decorators.js'
import type { AgentStatusType } from '@dune/shared'
import { nanoid } from 'nanoid'
const newRequestId = () => nanoid(12)
import * as api from '../../services/rpc.js'

type MiniappActionResult = {
  ok: boolean
  response?: string
  error?: string
  requestId?: string
}

type AskUserChoice = {
  label: string
  value: string
}

type AskUserPromptData = {
  question: string
  placeholder: string
  defaultValue: string
  choices: AskUserChoice[]
}

type PendingAskUserRequest = AskUserPromptData & {
  requestId: string
  sourceWindow: Window
  origin: string
}

const ASK_USER_QUESTION_ACTIONS = new Set(['askuserquestion', 'ask_user_question'])

@customElement('miniapp-window')
export class MiniappWindow extends LitElement {
  @property({ type: Boolean }) open = false
  @property({ type: String }) agentId = ''
  @property({ type: String }) agentName = ''
  @property({ type: String }) appSlug = ''
  @property({ type: String }) appName = ''
  @property({ type: String }) appUrl = ''
  @property({ type: String }) errorMessage = ''
  @property({ type: Boolean }) loading = false
  @property({ type: String }) agentStatus: AgentStatusType = 'stopped'

  @litState() private askOpen = false
  @litState() private askInput = ''
  @litState() private askReply = ''
  @litState() private askSending = false
  @litState() private pendingAskUserRequest: PendingAskUserRequest | null = null
  @litState() private askUserAnswerInput = ''

  @query('iframe') private iframeEl?: HTMLIFrameElement

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 120;
      pointer-events: none;
    }

    .overlay {
      position: absolute;
      inset: 0;
      background: rgba(13, 13, 13, 0.5);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      padding: 16px;
    }

    .window {
      width: min(1280px, 96vw);
      height: min(860px, 92vh);
      background: var(--bg-elevated);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    .header {
      height: 46px;
      padding: 0 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-secondary-size);
      border-bottom: none;
      flex-shrink: 0;
    }

    .title {
      color: var(--text-primary);
      font-weight: 600;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .meta {
      color: var(--text-muted);
      white-space: nowrap;
    }

    .spacer {
      flex: 1;
    }

    .btn {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-hover);
      color: var(--text-secondary);
      font-size: var(--text-meta-size);
      font-weight: 600;
      padding: 6px 10px;
    }

    .btn:hover {
      color: var(--text-primary);
      background: color-mix(in srgb, var(--bg-hover) 72%, var(--accent-soft));
    }

    .body {
      flex: 1;
      min-height: 0;
      position: relative;
      background: var(--bg-primary);
    }

    iframe {
      border: none;
      width: 100%;
      height: 100%;
      background: #fff;
    }

    .state {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      background: var(--bg-primary);
      text-align: center;
      padding: 20px;
      z-index: 1;
    }

    .offline {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: rgba(13, 13, 13, 0.52);
      color: #fff;
      text-align: center;
      z-index: 3;
      padding: 20px;
    }

    .offline-btn {
      border: none;
      border-radius: var(--radius-sm);
      padding: 7px 12px;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      color: var(--text-primary);
      background: #fff;
    }

    .ask-drawer {
      position: absolute;
      top: 46px;
      right: 0;
      width: min(380px, 92vw);
      height: calc(100% - 46px);
      background: var(--bg-elevated);
      border-left: none;
      box-shadow: var(--shadow-md);
      display: flex;
      flex-direction: column;
      z-index: 4;
    }

    .ask-head {
      padding: 10px 12px;
      border-bottom: none;
      font-size: var(--text-secondary-size);
      color: var(--text-secondary);
      font-weight: 600;
      background: var(--bg-surface);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .ask-body {
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-height: 0;
    }

    .ask-input {
      resize: none;
      min-height: 120px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 10px;
      font-size: var(--text-secondary-size);
      line-height: 1.5;
    }

    .ask-send {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--accent);
      color: #fff;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      padding: 8px 12px;
      align-self: flex-end;
    }

    .ask-send:disabled {
      opacity: 0.6;
    }

    .ask-reply {
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-secondary-size);
      line-height: 1.5;
      padding: 10px;
      overflow: auto;
      flex: 1;
      min-height: 110px;
      white-space: pre-wrap;
    }

    .ask-user-overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      background: rgba(13, 13, 13, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .ask-user-modal {
      width: min(560px, 100%);
      max-height: min(520px, calc(100% - 24px));
      background: var(--bg-elevated);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
    }

    .ask-user-title {
      font-size: var(--text-secondary-size);
      color: var(--text-secondary);
      font-weight: 600;
    }

    .ask-user-question {
      font-size: var(--text-body-size);
      color: var(--text-primary);
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .ask-user-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .ask-user-choice {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-secondary-size);
      padding: 7px 11px;
      max-width: 100%;
    }

    .ask-user-choice:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .ask-user-input {
      resize: vertical;
      min-height: 110px;
      max-height: 240px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 10px;
      font-size: var(--text-secondary-size);
      line-height: 1.5;
      font-family: inherit;
    }

    .ask-user-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 2px;
    }

    .ask-user-submit {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--accent);
      color: #fff;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      padding: 8px 12px;
    }

    .ask-user-submit:disabled {
      opacity: 0.6;
    }

    @media (max-width: 860px) {
      .window {
        width: 100vw;
        height: 100vh;
        border-radius: 0;
      }

      .ask-drawer {
        width: 100%;
      }
    }
  `

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('message', this.handleWindowMessage)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('message', this.handleWindowMessage)
    this.clearAskUserRequest()
  }

  private get offline(): boolean {
    return this.agentStatus === 'stopped' || this.agentStatus === 'error'
  }

  private pickString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value !== 'string') continue
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
    return ''
  }

  private resolveTargetOrigin(origin: string): string {
    return origin && origin !== 'null' ? origin : '*'
  }

  private isAskUserQuestionAction(action: string): boolean {
    return ASK_USER_QUESTION_ACTIONS.has(action.toLowerCase())
  }

  private normalizeAskUserChoices(raw: unknown): AskUserChoice[] {
    if (!Array.isArray(raw)) return []

    const choices: AskUserChoice[] = []
    for (const item of raw) {
      if (typeof item === 'string') {
        const text = item.trim()
        if (text) choices.push({ label: text, value: text })
        continue
      }

      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const label = this.pickString(record.label, record.value, record.text)
      if (!label) continue
      const value = this.pickString(record.value) || label
      choices.push({ label, value })
    }

    return choices
  }

  private parseAskUserQuestionPayload(payload: unknown): AskUserPromptData {
    const record = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {}

    return {
      question: this.pickString(record.question, record.prompt, record.text) || 'Please provide input.',
      placeholder: this.pickString(record.placeholder) || 'Type your answer...',
      defaultValue: this.pickString(record.defaultValue),
      choices: this.normalizeAskUserChoices(record.choices),
    }
  }

  private postMiniappActionResult(targetWindow: Window, origin: string, result: MiniappActionResult): void {
    targetWindow.postMessage({
      type: 'dune:miniapp-action-result',
      requestId: result.requestId,
      ok: !!result.ok,
      response: result.response,
      error: result.error,
    }, origin)
  }

  private resolvePendingAskUserQuestion(result: Omit<MiniappActionResult, 'requestId'>): void {
    const pending = this.pendingAskUserRequest
    if (!pending) return
    this.postMiniappActionResult(pending.sourceWindow, pending.origin, {
      requestId: pending.requestId,
      ...result,
    })
    this.clearAskUserRequest()
  }

  private clearAskUserRequest(): void {
    this.pendingAskUserRequest = null
    this.askUserAnswerInput = ''
  }

  private readonly handleWindowMessage = async (event: MessageEvent) => {
    if (!this.open || !this.agentId || !this.appSlug) return
    if (event.source !== this.iframeEl?.contentWindow) return

    const data = event.data
    if (!data || typeof data !== 'object' || data.type !== 'dune:miniapp-action') return

    const requestId = typeof data.requestId === 'string' ? data.requestId : newRequestId()
    const action = typeof data.action === 'string' ? data.action : ''
    const payload = data.payload
    const sourceWindow = event.source as Window
    const origin = this.resolveTargetOrigin(event.origin)

    let result: MiniappActionResult
    if (!action) {
      result = { ok: false, error: 'Missing action', requestId }
      this.postMiniappActionResult(sourceWindow, origin, result)
      return
    }

    if (this.isAskUserQuestionAction(action)) {
      if (this.pendingAskUserRequest) {
        this.postMiniappActionResult(sourceWindow, origin, {
          ok: false,
          error: 'AskUserQuestion already pending',
          requestId,
        })
        return
      }

      const prompt = this.parseAskUserQuestionPayload(payload)
      this.pendingAskUserRequest = {
        ...prompt,
        requestId,
        sourceWindow,
        origin,
      }
      this.askUserAnswerInput = prompt.defaultValue
      return
    }

    try {
      const response = await api.sendAgentAppAction(this.agentId, this.appSlug, action, payload, requestId)
      result = response
    } catch (err: any) {
      result = { ok: false, error: err.message || 'Action failed', requestId }
    }

    this.postMiniappActionResult(sourceWindow, origin, result)
  }

  private closeWindow() {
    if (this.pendingAskUserRequest) {
      this.resolvePendingAskUserQuestion({ ok: false, error: 'User cancelled' })
    }
    this.dispatchEvent(new CustomEvent('close-miniapp-window', { bubbles: true, composed: true }))
  }

  private reloadApp() {
    this.dispatchEvent(new CustomEvent('reload-miniapp-window', { bubbles: true, composed: true }))
  }

  private restartAndReload() {
    this.dispatchEvent(new CustomEvent('restart-reload-miniapp', { bubbles: true, composed: true }))
  }

  private cancelAskUserQuestionRequest() {
    this.resolvePendingAskUserQuestion({ ok: false, error: 'User cancelled' })
  }

  private submitAskUserQuestionRequest() {
    const answer = this.askUserAnswerInput.trim()
    if (!answer) return
    this.resolvePendingAskUserQuestion({ ok: true, response: answer })
  }

  private applyAskUserChoice(choice: AskUserChoice) {
    this.askUserAnswerInput = choice.value
  }

  private toggleAsk() {
    this.askOpen = !this.askOpen
    if (!this.askOpen) {
      this.askReply = ''
      this.askInput = ''
      this.askSending = false
    }
  }

  private async sendAsk() {
    const content = this.askInput.trim()
    if (!content || !this.agentId) return

    this.askSending = true
    const wrapped = `[Miniapp: ${this.appName} (${this.appSlug})]\n${content}`
    try {
      const resp = await api.sendDirectMessage(this.agentId, wrapped)
      this.askReply = resp.response || '[NO_RESPONSE]'
    } catch (err: any) {
      this.askReply = `Error: ${err.message || 'failed to send'}`
    }
    this.askSending = false
  }

  render() {
    if (!this.open) return html``

    return html`
      <div class="overlay" @click=${this.closeWindow}>
        <div class="window" @click=${(e: Event) => e.stopPropagation()}>
          <div class="header">
            <span class="title">${this.appName || this.appSlug}</span>
            <span class="meta">by ${this.agentName}</span>
            <span class="meta">${this.agentStatus}</span>
            <span class="spacer"></span>
            <button class="btn" type="button" @click=${this.toggleAsk}>Ask Agent</button>
            <button class="btn" type="button" @click=${this.reloadApp}>Reload</button>
            <button class="btn" type="button" @click=${this.closeWindow}>Close</button>
          </div>

          <div class="body">
            ${this.loading
              ? html`<div class="state">Starting agent and loading miniapp...</div>`
              : this.errorMessage
                ? html`<div class="state">${this.errorMessage}</div>`
                : this.appUrl
                  ? html`<iframe src=${this.appUrl} title=${this.appName || this.appSlug}></iframe>`
                  : html`<div class="state">No app URL available.</div>`}

            ${this.offline ? html`
              <div class="offline">
                <div>Agent is offline. This miniapp cannot run right now.</div>
                <button class="offline-btn" type="button" @click=${this.restartAndReload}>Restart & Reload</button>
              </div>
            ` : ''}

            ${this.askOpen ? html`
              <div class="ask-drawer">
                <div class="ask-head">
                  <span>Ask ${this.agentName}</span>
                  <button class="btn" type="button" @click=${this.toggleAsk}>Close</button>
                </div>
                <div class="ask-body">
                  <textarea
                    class="ask-input"
                    .value=${this.askInput}
                    @input=${(e: Event) => { this.askInput = (e.target as HTMLTextAreaElement).value }}
                    placeholder="Ask for help with this miniapp..."
                  ></textarea>
                  <button class="ask-send" type="button" ?disabled=${this.askSending || !this.askInput.trim()} @click=${this.sendAsk}>
                    ${this.askSending ? 'Sending...' : 'Send'}
                  </button>
                  <div class="ask-reply">${this.askReply || 'Replies will appear here.'}</div>
                </div>
              </div>
            ` : ''}

            ${this.pendingAskUserRequest ? html`
              <div class="ask-user-overlay" @click=${this.cancelAskUserQuestionRequest}>
                <div class="ask-user-modal" @click=${(e: Event) => e.stopPropagation()}>
                  <div class="ask-user-title">Question from ${this.appName || this.appSlug}</div>
                  <div class="ask-user-question">${this.pendingAskUserRequest.question}</div>

                  ${this.pendingAskUserRequest.choices.length > 0 ? html`
                    <div class="ask-user-choices">
                      ${this.pendingAskUserRequest.choices.map((choice) => html`
                        <button
                          class="ask-user-choice"
                          type="button"
                          @click=${() => this.applyAskUserChoice(choice)}
                        >
                          ${choice.label}
                        </button>
                      `)}
                    </div>
                  ` : ''}

                  <textarea
                    class="ask-user-input"
                    .value=${this.askUserAnswerInput}
                    placeholder=${this.pendingAskUserRequest.placeholder}
                    @input=${(e: Event) => { this.askUserAnswerInput = (e.target as HTMLTextAreaElement).value }}
                  ></textarea>

                  <div class="ask-user-actions">
                    <button class="btn" type="button" @click=${this.cancelAskUserQuestionRequest}>Cancel</button>
                    <button
                      class="ask-user-submit"
                      type="button"
                      ?disabled=${!this.askUserAnswerInput.trim()}
                      @click=${this.submitAskUserQuestionRequest}
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `
  }
}
