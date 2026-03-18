import { LitElement, html, css } from 'lit'
import { customElement, property, query, state as litState } from 'lit/decorators.js'

export type CodexComposerInputDetail = {
  value: string
  cursor: number
}

export type CodexComposerKeydownDetail = {
  event: KeyboardEvent
  value: string
  cursor: number
}

export type CodexComposerSendDetail = {
  value: string
}

export type CodexComposerSubmitMode = 'send' | 'interrupt'

export type CodexComposerAddAction = {
  id: string
  label: string
  disabled?: boolean
}

export type CodexComposerAddActionDetail = {
  id: string
}

export type CodexComposerAddMenuToggleDetail = {
  open: boolean
}

@customElement('codex-composer')
export class CodexComposer extends LitElement {
  @property() value = ''
  @property() placeholder = 'Type your message...'
  @property({ type: Boolean }) disabled = false
  @property({ type: Boolean }) sending = false
  @property() submitMode: CodexComposerSubmitMode = 'send'
  @property({ type: Boolean }) showAddButton = true
  @property({ type: Boolean }) disableAddButton = false
  @property({ attribute: false }) addActions: CodexComposerAddAction[] = []
  @property() addMenuEmptyText = ''

  @litState() private addMenuOpen = false

  @query('.composer-input') private inputEl!: HTMLTextAreaElement

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .shell {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: var(--composer-min-height);
      border-radius: var(--composer-radius);
      background: var(--composer-shell);
      box-shadow: var(--composer-shadow);
      padding: 12px 14px 12px;
      transition: box-shadow var(--transition-fast), background var(--transition-fast);
      border: 1px solid color-mix(in srgb, var(--composer-seam) 88%, transparent);
    }

    .shell:focus-within {
      box-shadow: var(--composer-shadow), 0 0 0 2px var(--focus-ring);
    }

    .composer-input {
      width: 100%;
      resize: none;
      border: none;
      background: transparent;
      color: var(--text-primary);
      font-family: var(--font);
      font-size: 14px;
      line-height: 1.45;
      height: calc(var(--composer-min-height) - var(--composer-submit-size) - (var(--composer-pad-y) * 2) - var(--composer-gap) - var(--composer-input-top-inset));
      min-height: calc(var(--composer-min-height) - var(--composer-submit-size) - (var(--composer-pad-y) * 2) - var(--composer-gap) - var(--composer-input-top-inset));
      max-height: 240px;
      outline: none;
      overflow-y: auto;
      padding: 0;
      caret-color: var(--text-primary);
    }

    .composer-input::placeholder {
      color: var(--text-muted);
    }

    .composer-input:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      min-height: var(--composer-submit-size);
      gap: 10px;
      position: relative;
      padding-top: 6px;
    }

    .footer-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: nowrap;
    }

    .add-wrap {
      position: relative;
      flex: 0 0 auto;
    }

    .add-btn {
      width: var(--composer-submit-size);
      height: var(--composer-submit-size);
      border: 1px solid var(--control-border);
      border-radius: 10px;
      background: var(--control-bg);
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
      flex-shrink: 0;
    }

    .add-btn svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      stroke-width: 2.2;
      fill: none;
    }

    .add-btn:hover:enabled,
    .add-btn.open:enabled {
      background: var(--control-bg-hover);
      color: var(--text-primary);
      border-color: var(--border-primary);
    }

    .add-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    .add-menu {
      position: absolute;
      left: 0;
      bottom: calc(100% + 10px);
      min-width: 220px;
      border-radius: 12px;
      background: var(--sheet-bg);
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-md);
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 80;
    }

    .add-menu-item {
      border: none;
      background: transparent;
      color: var(--text-primary);
      text-align: left;
      border-radius: 10px;
      padding: 9px 10px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }

    .add-menu-item:hover:enabled {
      background: var(--bg-hover);
    }

    .add-menu-item:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .add-menu-empty {
      width: 20px;
      height: 8px;
      align-self: center;
    }

    .add-menu-empty.has-text {
      width: auto;
      height: auto;
      font-size: 12px;
      color: var(--text-muted);
      padding: 6px 8px;
      align-self: flex-start;
    }

    .controls-slot {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex-wrap: nowrap;
    }

    .controls-slot ::slotted([slot='footer-controls']) {
      flex: 0 0 auto;
      border: 1px solid var(--control-border);
      border-radius: 999px;
      min-height: var(--control-height);
      padding: 0 10px;
      background: var(--control-bg);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
    }

    .controls-slot ::slotted([slot='footer-controls']:hover) {
      background: var(--control-bg-hover);
      color: var(--text-primary);
      border-color: var(--border-primary);
    }

    .submit-btn {
      width: var(--composer-submit-size);
      height: var(--composer-submit-size);
      border: 1px solid transparent;
      border-radius: 999px;
      background: var(--composer-submit-bg);
      color: var(--button-primary-text);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast), transform var(--transition-fast);
      flex-shrink: 0;
      box-shadow: none;
    }

    .submit-btn svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      stroke-width: 2.2;
      fill: none;
    }

    .submit-btn:hover:enabled {
      background: var(--composer-submit-hover);
      border-color: color-mix(in srgb, var(--composer-submit-hover) 42%, transparent);
      transform: translateY(-1px);
    }

    .submit-btn.interrupt {
      background: var(--error);
    }

    .submit-btn.interrupt:hover:enabled {
      background: color-mix(in srgb, var(--error) 84%, black 16%);
    }

    .submit-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      background: var(--composer-submit-disabled);
      transform: none;
    }
  `

  updated(changed: Map<string, unknown>) {
    if (changed.has('value') && this.inputEl && this.inputEl.value !== this.value) {
      this.inputEl.value = this.value
    }
    if ((changed.has('disabled') || changed.has('sending')) && (this.disabled || this.sending)) {
      this.closeAddMenu()
    }
  }

  get cursor(): number {
    return this.inputEl?.selectionStart ?? this.value.length
  }

  focusInput() {
    this.inputEl?.focus()
  }

  setCursor(next: number) {
    const bounded = Math.max(0, Math.min(next, this.value.length))
    this.updateComplete.then(() => {
      this.inputEl?.setSelectionRange(bounded, bounded)
    })
  }

  private emitInput() {
    this.dispatchEvent(new CustomEvent<CodexComposerInputDetail>('composer-input', {
      detail: {
        value: this.value,
        cursor: this.cursor,
      },
      bubbles: true,
      composed: true,
    }))
  }

  private handleInput(e: Event) {
    this.value = (e.target as HTMLTextAreaElement).value
    this.emitInput()
  }

  private emitAddMenuToggle() {
    this.dispatchEvent(new CustomEvent<CodexComposerAddMenuToggleDetail>('composer-add-menu-toggle', {
      detail: { open: this.addMenuOpen },
      bubbles: true,
      composed: true,
    }))
  }

  private closeAddMenu() {
    if (!this.addMenuOpen) return
    this.addMenuOpen = false
    this.emitAddMenuToggle()
  }

  private openAddMenu() {
    if (this.addMenuOpen || this.disableAddButton || this.sending) return
    this.addMenuOpen = true
    this.emitAddMenuToggle()
  }

  toggleAddMenu() {
    if (this.addMenuOpen) this.closeAddMenu()
    else this.openAddMenu()
  }

  closeAddActionsMenu() {
    this.closeAddMenu()
  }

  private handleShellKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.addMenuOpen) {
      event.preventDefault()
      event.stopPropagation()
      this.closeAddMenu()
    }
  }

  private handleHostPointerDown = (event: PointerEvent) => {
    if (!this.addMenuOpen) return
    const path = event.composedPath()
    if (!path.includes(this)) this.closeAddMenu()
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('pointerdown', this.handleHostPointerDown, { capture: true })
  }

  disconnectedCallback(): void {
    window.removeEventListener('pointerdown', this.handleHostPointerDown, { capture: true })
    super.disconnectedCallback()
  }

  private handleAddButtonClick(event: Event) {
    event.preventDefault()
    event.stopPropagation()
    this.toggleAddMenu()
  }

  private handleAddActionClick(actionId: string) {
    this.dispatchEvent(new CustomEvent<CodexComposerAddActionDetail>('composer-add-action', {
      detail: { id: actionId },
      bubbles: true,
      composed: true,
    }))
    this.closeAddMenu()
  }

  private handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.addMenuOpen) {
      event.preventDefault()
      event.stopPropagation()
      this.closeAddMenu()
      return
    }
    this.dispatchEvent(new CustomEvent<CodexComposerKeydownDetail>('composer-keydown', {
      detail: {
        event,
        value: this.value,
        cursor: this.cursor,
      },
      bubbles: true,
      composed: true,
    }))
  }

  private handleSubmitClick() {
    const eventName = this.submitMode === 'interrupt' ? 'composer-interrupt' : 'composer-send'
    this.dispatchEvent(new CustomEvent<CodexComposerSendDetail>(eventName, {
      detail: {
        value: this.value,
      },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    const isInterruptMode = this.submitMode === 'interrupt'
    const sendDisabled = isInterruptMode
      ? this.disabled || this.sending
      : this.disabled || this.sending || !this.value.trim()
    const addDisabled = this.disableAddButton || this.sending
    const hasEmptyText = Boolean(this.addMenuEmptyText.trim())
    return html`
      <div class="shell" data-testid="composer-shell" @keydown=${this.handleShellKeydown}>
        <textarea
          class="composer-input"
          .value=${this.value}
          .placeholder=${this.placeholder}
          ?disabled=${this.disabled || this.sending}
          rows="3"
          @input=${this.handleInput}
          @keydown=${this.handleKeydown}
        ></textarea>
        <div class="footer">
          <div class="footer-left">
            ${this.showAddButton
              ? html`
                  <div class="add-wrap">
                    <button
                      class="add-btn ${this.addMenuOpen ? 'open' : ''}"
                      type="button"
                      ?disabled=${addDisabled}
                      @click=${this.handleAddButtonClick}
                      aria-label="Open actions"
                      aria-expanded=${this.addMenuOpen ? 'true' : 'false'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke-linecap="round"></path>
                      </svg>
                    </button>
                    ${this.addMenuOpen
                      ? html`
                          <div class="add-menu" role="menu" aria-label="Composer actions">
                            ${this.addActions.length === 0
                              ? html`<div class="add-menu-empty ${hasEmptyText ? 'has-text' : ''}">${this.addMenuEmptyText}</div>`
                              : this.addActions.map((action) => html`
                                  <button
                                    class="add-menu-item"
                                    role="menuitem"
                                    type="button"
                                    @click=${() => this.handleAddActionClick(action.id)}
                                    ?disabled=${Boolean(action.disabled) || addDisabled}
                                  >
                                    ${action.label}
                                  </button>
                                `)}
                          </div>
                        `
                      : null}
                  </div>
                `
              : null}
            <span class="controls-slot">
              <slot name="footer-controls"></slot>
            </span>
          </div>
          <button
            class="submit-btn ${isInterruptMode ? 'interrupt' : ''}"
            type="button"
            ?disabled=${sendDisabled}
            @click=${this.handleSubmitClick}
            aria-label=${isInterruptMode ? 'Interrupt workflow' : 'Send'}
          >
            ${isInterruptMode
              ? html`
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="8" y="8" width="8" height="8" rx="1.5"></rect>
                  </svg>
                `
              : html`
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 12h10M13 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                `}
          </button>
        </div>
      </div>
    `
  }
}
