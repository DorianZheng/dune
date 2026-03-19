import { LitElement, html, css } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import type { Channel, Agent } from '@dune/shared'
import * as api from '../../services/rpc.js'
import { uiPreferences } from '../../state/ui-preferences.js'

const DEFAULT_INSPECTOR_WIDTH_PX = 520
const INSPECTOR_MIN_WIDTH_PX = 360
const INSPECTOR_MAX_WIDTH_PX = 760
const INSPECTOR_VIEWPORT_GUTTER_PX = 24
const INSPECTOR_RESIZE_STEP_PX = 16
const INSPECTOR_RESIZE_STEP_FAST_PX = 32
const INSPECTOR_RESIZE_DESKTOP_QUERY = '(min-width: 761px)'

@customElement('channel-details-panel')
export class ChannelDetailsPanel extends LitElement {
  @property({ type: Object }) channel: Channel | null = null
  @property({ type: Array }) agents: Agent[] = []
  @litState() private subscribers: string[] = []
  @litState() private editingName = false
  @litState() private editingDesc = false
  @litState() private inspectorWidthPx = DEFAULT_INSPECTOR_WIDTH_PX
  @litState() private inspectorResizeActive = false
  private inspectorResizePointerId: number | null = null
  private inspectorResizeStartX = 0
  private inspectorResizeStartWidth = DEFAULT_INSPECTOR_WIDTH_PX
  private inspectorResizeListenersBound = false
  private readonly uiPreferenceChangeHandler = () => this.syncInspectorWidthFromPreferences()
  private readonly windowResizeHandler = () => {
    if (this.inspectorResizeActive && !this.isResizableInspectorLayout()) {
      this.finishInspectorResize()
      return
    }
    if (!this.isResizableInspectorLayout()) {
      this.requestUpdate()
      return
    }
    const nextWidth = this.clampInspectorWidth(this.inspectorWidthPx)
    if (nextWidth !== this.inspectorWidthPx) {
      this.inspectorWidthPx = nextWidth
      uiPreferences.setInspectorWidth(nextWidth)
      return
    }
    this.requestUpdate()
  }

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: flex;
      align-items: stretch;
      justify-content: flex-end;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: var(--sheet-scrim);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      align-items: stretch;
      justify-content: flex-end;
      padding: 12px 0 12px 12px;
    }
    .sheet-shell {
      display: grid;
      grid-template-columns: 6px auto;
      gap: 0;
      min-height: 0;
      height: 100%;
      align-items: stretch;
    }
    .inspector-resizer {
      width: 6px;
      min-height: 0;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      cursor: col-resize;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .inspector-resizer::before {
      content: '';
      width: 2px;
      height: 38px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--border-primary) 72%, transparent);
      transition: background var(--transition-fast), height var(--transition-fast);
    }
    .inspector-resizer:hover::before,
    .inspector-resizer.active::before {
      background: color-mix(in srgb, var(--accent) 55%, var(--border-primary));
      height: 48px;
    }
    .inspector-resizer:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
    .modal {
      position: relative;
      width: min(480px, 40vw);
      height: 100%;
      max-height: none;
      background: var(--sheet-bg);
      border: 1px solid var(--border-color);
      border-radius: 30px 0 0 30px;
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal.resize-active {
      transition: none;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 18px 12px;
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
      :host,
      .backdrop {
        align-items: center;
        justify-content: center;
      }

      .backdrop {
        padding: 0;
      }

      .modal {
        width: min(560px, 92vw);
        height: auto;
        max-height: 88vh;
        border-radius: 24px;
      }

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
    this.inspectorWidthPx = this.clampInspectorWidth(uiPreferences.getInspectorWidth() ?? DEFAULT_INSPECTOR_WIDTH_PX)
    uiPreferences.addEventListener('change', this.uiPreferenceChangeHandler)
    window.addEventListener('resize', this.windowResizeHandler)
  }

  disconnectedCallback() {
    this.finishInspectorResize()
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler)
    uiPreferences.removeEventListener('change', this.uiPreferenceChangeHandler)
    window.removeEventListener('resize', this.windowResizeHandler)
    super.disconnectedCallback()
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

  private syncInspectorWidthFromPreferences() {
    const persisted = uiPreferences.getInspectorWidth()
    if (persisted == null) return
    const nextWidth = this.clampInspectorWidth(persisted)
    if (nextWidth !== this.inspectorWidthPx) {
      this.inspectorWidthPx = nextWidth
    }
  }

  private isResizableInspectorLayout(): boolean {
    return window.matchMedia(INSPECTOR_RESIZE_DESKTOP_QUERY).matches
  }

  private getInspectorWidthEffectiveMax(viewportWidth = window.innerWidth): number {
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return INSPECTOR_MAX_WIDTH_PX
    const viewportBound = Math.floor(viewportWidth - INSPECTOR_VIEWPORT_GUTTER_PX)
    return Math.max(INSPECTOR_MIN_WIDTH_PX, Math.min(INSPECTOR_MAX_WIDTH_PX, viewportBound))
  }

  private clampInspectorWidth(width: number, viewportWidth = window.innerWidth): number {
    if (!Number.isFinite(width)) return DEFAULT_INSPECTOR_WIDTH_PX
    const min = INSPECTOR_MIN_WIDTH_PX
    const max = this.getInspectorWidthEffectiveMax(viewportWidth)
    if (width < min) return min
    if (width > max) return max
    return Math.round(width)
  }

  private persistInspectorWidth() {
    const nextWidth = this.clampInspectorWidth(this.inspectorWidthPx)
    this.inspectorWidthPx = nextWidth
    uiPreferences.setInspectorWidth(nextWidth)
  }

  private bindInspectorResizeListeners() {
    if (this.inspectorResizeListenersBound) return
    this.inspectorResizeListenersBound = true
    window.addEventListener('pointermove', this.handleInspectorResizePointerMove)
    window.addEventListener('pointerup', this.handleInspectorResizePointerEnd)
    window.addEventListener('pointercancel', this.handleInspectorResizePointerEnd)
  }

  private unbindInspectorResizeListeners() {
    if (!this.inspectorResizeListenersBound) return
    this.inspectorResizeListenersBound = false
    window.removeEventListener('pointermove', this.handleInspectorResizePointerMove)
    window.removeEventListener('pointerup', this.handleInspectorResizePointerEnd)
    window.removeEventListener('pointercancel', this.handleInspectorResizePointerEnd)
  }

  private finishInspectorResize() {
    const wasActive = this.inspectorResizeActive
    this.inspectorResizeActive = false
    this.inspectorResizePointerId = null
    this.unbindInspectorResizeListeners()
    if (wasActive) this.persistInspectorWidth()
  }

  private readonly handleInspectorResizePointerMove = (event: PointerEvent) => {
    if (!this.inspectorResizeActive) return
    if (this.inspectorResizePointerId !== null && event.pointerId !== this.inspectorResizePointerId) return
    const deltaX = event.clientX - this.inspectorResizeStartX
    const width = this.inspectorResizeStartWidth - deltaX
    this.inspectorWidthPx = this.clampInspectorWidth(width)
  }

  private readonly handleInspectorResizePointerEnd = (event: PointerEvent) => {
    if (!this.inspectorResizeActive) return
    if (this.inspectorResizePointerId !== null && event.pointerId !== this.inspectorResizePointerId) return
    this.finishInspectorResize()
  }

  private handleInspectorResizePointerDown(event: PointerEvent) {
    if (!this.isResizableInspectorLayout()) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement | null
    if (handle?.setPointerCapture) {
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // Continue using window listeners if pointer capture is unavailable.
      }
    }
    this.inspectorResizeActive = true
    this.inspectorResizePointerId = event.pointerId
    this.inspectorResizeStartX = event.clientX
    this.inspectorResizeStartWidth = this.clampInspectorWidth(this.inspectorWidthPx)
    this.bindInspectorResizeListeners()
  }

  private handleInspectorResizeKeydown(event: KeyboardEvent) {
    if (!this.isResizableInspectorLayout()) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? INSPECTOR_RESIZE_STEP_FAST_PX : INSPECTOR_RESIZE_STEP_PX
    const delta = event.key === 'ArrowLeft' ? step : -step
    this.inspectorWidthPx = this.clampInspectorWidth(this.inspectorWidthPx + delta)
    this.persistInspectorWidth()
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
    const inspectorResizable = this.isResizableInspectorLayout()
    const inspectorWidth = this.clampInspectorWidth(this.inspectorWidthPx)
    const inspectorWidthMax = this.getInspectorWidthEffectiveMax()
    const modalClass = ['modal', this.inspectorResizeActive ? 'resize-active' : ''].filter(Boolean).join(' ')
    const modalStyle = inspectorResizable ? `width:${inspectorWidth}px;` : ''
    const modal = html`
      <div class=${modalClass} style=${modalStyle} data-testid="channel-details-modal">
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
    `

    return html`
      <div class="backdrop" @click=${this.handleBackdropClick}>
        ${inspectorResizable ? html`
          <div class="sheet-shell">
            <button
              class="inspector-resizer ${this.inspectorResizeActive ? 'active' : ''}"
              type="button"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              aria-valuemin=${String(INSPECTOR_MIN_WIDTH_PX)}
              aria-valuemax=${String(inspectorWidthMax)}
              aria-valuenow=${String(inspectorWidth)}
              data-testid="channel-details-resizer"
              @pointerdown=${this.handleInspectorResizePointerDown}
              @keydown=${this.handleInspectorResizeKeydown}
            ></button>
            ${modal}
          </div>
        ` : modal}
      </div>
    `
  }
}
