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
      gap: var(--composer-gap);
      min-height: var(--composer-min-height);
      border-radius: var(--composer-radius);
      background: var(--composer-shell);
      box-shadow: var(--composer-shadow);
      padding: var(--composer-pad-y) var(--composer-pad-x);
      transition: box-shadow var(--transition-fast), background var(--transition-fast);
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
      line-height: 1.4;
      height: calc(var(--composer-min-height) - var(--composer-submit-size) - (var(--composer-pad-y) * 2) - var(--composer-gap) - var(--composer-input-top-inset));
      min-height: calc(var(--composer-min-height) - var(--composer-submit-size) - (var(--composer-pad-y) * 2) - var(--composer-gap) - var(--composer-input-top-inset));
      max-height: 220px;
      outline: none;
      overflow-y: auto;
      padding: var(--composer-input-top-inset) 2px 0;
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
      gap: 8px;
      position: relative;
    }

    .footer-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: nowrap;
    }

    .add-wrap {
      position: relative;
      flex: 0 0 auto;
    }

    .add-btn {
      width: var(--composer-submit-size);
      height: var(--composer-submit-size);
      border: none;
      border-radius: 999px;
      background: var(--bg-surface);
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
      background: var(--bg-hover);
      color: var(--text-primary);
      transform: translateY(-1px);
    }

    .add-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    .add-menu {
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      min-width: 180px;
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-md);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      z-index: 80;
    }

    .add-menu-item {
      border: none;
      background: transparent;
      color: var(--text-primary);
      text-align: left;
      border-radius: var(--radius-sm);
      padding: 7px 9px;
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
      gap: 6px;
      min-width: 0;
      flex-wrap: nowrap;
    }

    .controls-slot ::slotted([slot='footer-controls']) {
      flex: 0 0 auto;
    }

    .submit-btn {
      width: var(--composer-submit-size);
      height: var(--composer-submit-size);
      border: none;
      border-radius: 999px;
      background: var(--composer-submit-bg);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), opacity var(--transition-fast), transform var(--transition-fast);
      flex-shrink: 0;
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
      transform: translateY(-1px);
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

  private handleSendClick() {
    this.dispatchEvent(new CustomEvent<CodexComposerSendDetail>('composer-send', {
      detail: {
        value: this.value,
      },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    const sendDisabled = this.disabled || this.sending || !this.value.trim()
    const addDisabled = this.disableAddButton || this.sending
    const hasEmptyText = Boolean(this.addMenuEmptyText.trim())
    return html`
      <div class="shell" @keydown=${this.handleShellKeydown}>
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
          <button class="submit-btn" type="button" ?disabled=${sendDisabled} @click=${this.handleSendClick} aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 12h10M13 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </div>
      </div>
    `
  }
}
