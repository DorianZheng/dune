import { LitElement, html, css } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import type { Channel, Agent } from '@dune/shared'

export type NavRow = {
  kind: 'channel' | 'agent'
  id: string
  title: string
  selected: boolean
}

type WorkspaceBrandStyle = 'signature' | 'minimal' | 'technical'

const WORKSPACE_BRAND_STYLE: WorkspaceBrandStyle = 'minimal'

@customElement('sidebar-panel')
export class SidebarPanel extends LitElement {
  @property({ type: Array }) channels: Channel[] = []
  @property({ type: Array }) agents: Agent[] = []
  @property() selectedChannelId = ''
  @property() selectedAgentId = ''
  @property() activeSurface: 'chat' | 'settings' | 'sandboxes' | 'apps' = 'chat'
  @property({ type: Boolean }) collapsed = false
  @litState() private contextMenu: { x: number; y: number; channelId: string } | null = null

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      position: relative;
    }

    .shell {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .workspace {
      padding: 10px 12px 8px;
      min-height: var(--header-height);
    }

    .workspace-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: var(--control-height);
      min-width: 0;
    }

    .workspace-brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      max-width: 100%;
      flex: 1 1 auto;
      padding: 2px 0;
      border-radius: 0;
      border: none;
      background: transparent;
      color: var(--sidebar-text-active);
      transition: color var(--transition-fast), opacity var(--transition-fast);
    }

    .workspace-brand-mark {
      width: 2px;
      height: 15px;
      border-radius: 999px;
      flex-shrink: 0;
      background: color-mix(in srgb, var(--accent) 64%, var(--sidebar-text-active));
      opacity: 0.72;
      transition: background var(--transition-fast), opacity var(--transition-fast), height var(--transition-fast);
    }

    .workspace-brand-text {
      display: inline-block;
      position: relative;
      font-size: var(--text-title-size);
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: 0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      transition: letter-spacing var(--transition-fast), font-weight var(--transition-fast), color var(--transition-fast), text-shadow var(--transition-fast);
    }

    .workspace-head:hover .workspace-brand-mark {
      opacity: 0.9;
    }

    .workspace-brand.style-signature {
      gap: 11px;
    }

    .workspace-brand.style-signature .workspace-brand-mark {
      height: 17px;
      opacity: 0.82;
      background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--warning) 36%, var(--accent)) 0%,
        color-mix(in srgb, var(--accent) 76%, var(--sidebar-text-active)) 100%
      );
    }

    .workspace-brand.style-signature .workspace-brand-text {
      font-weight: 635;
      letter-spacing: 0.014em;
      text-shadow: 0 1px 0 color-mix(in srgb, var(--bg-primary) 72%, transparent);
    }

    .workspace-brand.style-signature .workspace-brand-text::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -2px;
      height: 1px;
      background: color-mix(in srgb, var(--accent) 24%, transparent);
    }

    .workspace-brand.style-minimal .workspace-brand-mark {
      width: 1.5px;
      height: 14px;
      opacity: 0.68;
      background: color-mix(in srgb, var(--accent) 56%, var(--sidebar-text-active));
    }

    .workspace-brand.style-minimal .workspace-brand-text {
      font-weight: 615;
      letter-spacing: 0.012em;
    }

    .workspace-brand.style-technical {
      gap: 8px;
    }

    .workspace-brand.style-technical .workspace-brand-mark {
      width: 1px;
      height: 16px;
      opacity: 0.88;
      background: color-mix(in srgb, var(--accent) 72%, var(--sidebar-text-active));
    }

    .workspace-brand.style-technical .workspace-brand-text {
      font-family: var(--font-mono);
      font-size: var(--text-secondary-size);
      letter-spacing: 0.015em;
      font-weight: 620;
    }

    .workspace-head.style-signature .sidebar-toggle {
      border-color: color-mix(in srgb, var(--accent) 22%, transparent);
      background: color-mix(in srgb, var(--accent-soft) 24%, var(--sidebar-hover));
      color: var(--sidebar-text-active);
    }

    .workspace-head.style-signature .sidebar-toggle:hover {
      border-color: color-mix(in srgb, var(--accent) 30%, transparent);
      background: color-mix(in srgb, var(--accent-soft) 36%, var(--sidebar-hover));
    }

    .workspace-head.style-minimal .sidebar-toggle {
      border-color: color-mix(in srgb, var(--text-muted) 22%, transparent);
      background: color-mix(in srgb, var(--sidebar-hover) 50%, transparent);
    }

    .workspace-head.style-minimal .sidebar-toggle:hover {
      border-color: color-mix(in srgb, var(--text-muted) 32%, transparent);
      background: color-mix(in srgb, var(--sidebar-hover) 72%, transparent);
    }

    .workspace-head.style-technical .sidebar-toggle {
      border-radius: var(--radius-xs);
      border-color: color-mix(in srgb, var(--accent) 24%, transparent);
      background: color-mix(in srgb, var(--accent-soft) 18%, var(--sidebar-hover));
      color: var(--sidebar-text-active);
    }

    .workspace-head.style-technical .sidebar-toggle:hover {
      border-color: color-mix(in srgb, var(--accent) 32%, transparent);
      background: color-mix(in srgb, var(--accent-soft) 30%, var(--sidebar-hover));
    }

    .sidebar-toggle {
      width: var(--control-height);
      height: var(--control-height);
      border: 1px solid color-mix(in srgb, var(--text-muted) 18%, transparent);
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--sidebar-hover) 52%, transparent);
      color: var(--sidebar-text);
      display: none;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .sidebar-toggle:hover {
      background: color-mix(in srgb, var(--sidebar-hover) 72%, transparent);
      border-color: color-mix(in srgb, var(--text-muted) 30%, transparent);
      color: var(--sidebar-text-active);
    }

    .sidebar-toggle:focus-visible {
      border-color: color-mix(in srgb, var(--accent) 46%, transparent);
      box-shadow: 0 0 0 2px var(--focus-ring);
      color: var(--sidebar-text-active);
    }

    .sidebar-toggle svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      stroke-width: 1.9;
      fill: none;
      flex-shrink: 0;
    }

    .utility {
      padding: 6px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .utility-btn {
      width: 100%;
      min-height: var(--sidebar-utility-height);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--sidebar-text);
      display: grid;
      grid-template-columns: 16px 1fr;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      text-align: left;
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
      font-size: var(--text-body-size);
      font-weight: 500;
    }

    .utility-btn:hover {
      background: var(--sidebar-hover);
      color: var(--sidebar-text-active);
    }

    .utility-btn.active {
      background: var(--sidebar-selected);
      color: var(--sidebar-text-active);
    }

    .utility-btn svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      stroke-width: 1.8;
      fill: none;
      flex-shrink: 0;
    }

    .sections {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 10px 8px;
    }

    .group + .group {
      margin-top: 11px;
    }

    .group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 4px 5px;
      gap: 8px;
    }

    .group-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .group-title {
      font-size: var(--text-meta-size);
      font-weight: 500;
      color: var(--text-muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .group-count {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
    }

    .group-add {
      width: 20px;
      height: 20px;
      border: none;
      border-radius: var(--radius-xs);
      background: transparent;
      color: var(--text-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .group-add:hover {
      background: var(--sidebar-hover);
      color: var(--sidebar-text-active);
    }

    .group-add svg {
      width: 13px;
      height: 13px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .row {
      width: 100%;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--sidebar-text);
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      gap: 9px;
      align-items: center;
      padding: 6px 10px;
      cursor: pointer;
      text-align: left;
      transition: background var(--transition-fast), color var(--transition-fast);
      font-family: inherit;
      min-height: var(--sidebar-row-height);
    }

    .row:hover {
      background: var(--sidebar-hover);
      color: var(--sidebar-text-active);
    }

    .row.selected {
      background: var(--sidebar-selected);
      color: var(--sidebar-text-active);
    }

    .row-icon {
      width: 16px;
      height: 16px;
      border-radius: var(--radius-xs);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
    }

    .row.kind-agent .row-icon {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      margin-left: 3px;
    }

    .row-main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .row-title {
      font-size: var(--text-body-size);
      font-weight: 500;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: inherit;
    }

    .empty {
      border-radius: var(--radius-sm);
      padding: 10px;
      font-size: var(--text-meta-size);
      color: var(--text-muted);
      line-height: 1.4;
      margin: 0 2px;
      background: color-mix(in srgb, var(--sidebar-hover) 55%, transparent);
    }

    .footer {
      margin-top: auto;
      padding: 8px 10px 12px;
    }

    .context-menu {
      position: fixed;
      z-index: 500;
      min-width: 180px;
      border-radius: var(--radius);
      border: none;
      background: var(--bg-surface);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    .context-item {
      width: 100%;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      text-align: left;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-secondary-size);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .context-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .context-item svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .context-item.danger {
      color: var(--error);
    }

    .collapsed .workspace {
      padding: 10px 8px;
    }

    .collapsed .workspace-head {
      justify-content: center;
    }

    .collapsed .workspace-brand {
      display: none;
    }

    .collapsed .utility {
      padding: 8px;
      gap: 4px;
    }

    .collapsed .utility-btn {
      grid-template-columns: 1fr;
      justify-items: center;
      padding: 0;
      min-height: var(--sidebar-utility-height);
      border-radius: var(--radius-sm);
    }

    .collapsed .utility-label,
    .collapsed .group-head,
    .collapsed .row-main {
      display: none;
    }

    .collapsed .sections {
      padding: 8px;
    }

    .collapsed .rows {
      gap: 5px;
    }

    .collapsed .row {
      min-height: var(--sidebar-row-height);
      padding: 0;
      grid-template-columns: 1fr;
      justify-items: center;
      border-radius: var(--radius-sm);
    }

    .collapsed .footer {
      padding: 8px 8px 10px;
    }

    .collapsed .row.kind-channel .row-icon {
      width: 16px;
      height: 16px;
      font-size: 12px;
    }

    @media (min-width: 1025px) {
      .sidebar-toggle {
        display: inline-flex;
      }
    }
  `

  connectedCallback() {
    super.connectedCallback()
    this.dismissContext = () => { this.contextMenu = null }
    document.addEventListener('click', this.dismissContext)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    if (this.dismissContext) document.removeEventListener('click', this.dismissContext)
  }

  private dismissContext: (() => void) | null = null

  private get channelRows(): NavRow[] {
    return this.channels.map((channel) => ({
      kind: 'channel',
      id: channel.id,
      title: channel.name,
      selected: channel.id === this.selectedChannelId,
    }))
  }

  private get agentRows(): NavRow[] {
    return this.agents.map((agent) => ({
      kind: 'agent',
      id: agent.id,
      title: agent.name,
      selected: agent.id === this.selectedAgentId,
    }))
  }

  private statusColor(status: string): string {
    switch (status) {
      case 'idle':
        return 'var(--success)'
      case 'thinking':
      case 'responding':
      case 'stopping':
        return 'var(--warning)'
      case 'starting':
        return 'var(--accent)'
      case 'error':
        return 'var(--error)'
      default:
        return 'var(--text-muted)'
    }
  }

  private handleChannelContext(e: MouseEvent, channelId: string) {
    e.preventDefault()
    this.contextMenu = { x: e.clientX, y: e.clientY, channelId }
  }

  private handleContextAction(action: 'details' | 'delete') {
    if (!this.contextMenu) return
    this.dispatchEvent(new CustomEvent('channel-context-action', {
      detail: { channelId: this.contextMenu.channelId, action },
      bubbles: true,
      composed: true,
    }))
    this.contextMenu = null
  }

  private toggleSidebar() {
    this.dispatchEvent(new CustomEvent('toggle-sidebar', {
      bubbles: true,
      composed: true,
    }))
  }

  private renderUtilityButton(
    label: string,
    icon: unknown,
    onClick: () => void,
    active = false,
    testId?: string,
  ) {
    return html`
      <button
        class="utility-btn ${active ? 'active' : ''}"
        type="button"
        data-testid=${ifDefined(testId)}
        @click=${onClick}
      >
        ${icon}
        <span class="utility-label">${label}</span>
      </button>
    `
  }

  private renderRow(row: NavRow) {
    const isChannel = row.kind === 'channel'
    const icon = isChannel
      ? html`<span class="row-icon" aria-hidden="true">#</span>`
      : html`<span class="row-icon" style="background:${this.statusColor((this.agents.find(a => a.id === row.id)?.status) || 'stopped')}" aria-hidden="true"></span>`

    return html`
      <button
        class="row kind-${row.kind} ${row.selected ? 'selected' : ''}"
        type="button"
        title=${this.collapsed ? row.title : ''}
        @click=${() => this.dispatchEvent(new CustomEvent(isChannel ? 'select-channel' : 'select-agent', {
          detail: row.id,
          bubbles: true,
          composed: true,
        }))}
        @contextmenu=${isChannel ? (e: MouseEvent) => this.handleChannelContext(e, row.id) : null}
      >
        ${icon}
        <span class="row-main">
          <span class="row-title">${row.title}</span>
        </span>
      </button>
    `
  }

  render() {
    const workspaceStyle = WORKSPACE_BRAND_STYLE

    return html`
      <div class="shell ${this.collapsed ? 'collapsed' : ''}">
        <div class="workspace">
          <div class="workspace-head style-${workspaceStyle}">
            <div class="workspace-brand style-${workspaceStyle}">
              <span class="workspace-brand-mark" aria-hidden="true"></span>
              <span class="workspace-brand-text">Dune</span>
            </div>
            <button class="sidebar-toggle" type="button" title="Toggle sidebar" @click=${this.toggleSidebar}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5h16v14H4zM9 5v14" stroke-linejoin="round"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="utility">
          ${this.renderUtilityButton('Sandboxes', html`
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.5l9 5v9l-9 5-9-5v-9l9-5z" stroke-linejoin="round"></path>
              <path d="M12 21.5v-9M3 7.5l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          `, () => this.dispatchEvent(new CustomEvent('open-sandboxes', { bubbles: true, composed: true })), this.activeSurface === 'sandboxes', 'nav-sandboxes')}
          ${this.renderUtilityButton('Apps', html`
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" stroke-linecap="round" stroke-linejoin="round"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1" stroke-linecap="round" stroke-linejoin="round"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1" stroke-linecap="round" stroke-linejoin="round"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1" stroke-linecap="round" stroke-linejoin="round"></rect>
            </svg>
          `, () => this.dispatchEvent(new CustomEvent('open-apps', { bubbles: true, composed: true })), this.activeSurface === 'apps', 'nav-apps')}
        </div>

        <div class="sections">
          <section class="group">
            <div class="group-head">
              <span class="group-title">Channels</span>
              <span class="group-actions">
                <button
                  class="group-add"
                  type="button"
                  title="Create channel"
                  @click=${() => this.dispatchEvent(new CustomEvent('create-channel', { bubbles: true, composed: true }))}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke-linecap="round"></path>
                  </svg>
                </button>
              </span>
            </div>
            <div class="rows">
              ${this.channelRows.length === 0
                ? html`<div class="empty">Create your first channel to start collaborating.</div>`
                : this.channelRows.map((row) => this.renderRow(row))}
            </div>
          </section>

          <section class="group">
            <div class="group-head">
              <span class="group-title">Agents</span>
              <span class="group-actions">
                <button
                  class="group-add"
                  type="button"
                  title="Create agent"
                  @click=${() => this.dispatchEvent(new CustomEvent('create-agent', { bubbles: true, composed: true }))}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke-linecap="round"></path>
                  </svg>
                </button>
              </span>
            </div>
            <div class="rows">
              ${this.agentRows.length === 0
                ? html`<div class="empty">Create an agent to collaborate in channels.</div>`
                : this.agentRows.map((row) => this.renderRow(row))}
            </div>
          </section>
        </div>

        <div class="footer">
          ${this.renderUtilityButton('Settings', html`
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12.22 2h-.44a2 2 0 0 0-1.94 1.5l-.26 1.05a2 2 0 0 1-2.11 1.5l-1.09-.06A2 2 0 0 0 4.5 8.22l.53.95a2 2 0 0 1 0 2.16l-.53.95a2 2 0 0 0 1.88 2.93l1.09-.06a2 2 0 0 1 2.11 1.5l.26 1.05A2 2 0 0 0 11.78 20h.44a2 2 0 0 0 1.94-1.5l.26-1.05a2 2 0 0 1 2.11-1.5l1.09.06a2 2 0 0 0 1.88-2.93l-.53-.95a2 2 0 0 1 0-2.16l.53-.95a2 2 0 0 0-1.88-2.93l-1.09.06a2 2 0 0 1-2.11-1.5l-.26-1.05A2 2 0 0 0 12.22 2Z" stroke-linecap="round" stroke-linejoin="round"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          `, () => this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true })))}
        </div>
      </div>

      ${this.contextMenu ? html`
        <div class="context-menu" style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px">
          <button class="context-item" type="button" @click=${() => this.handleContextAction('details')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16v-4m0-4h.01M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 0 0-17 0Z" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Channel details</span>
          </button>
          <button class="context-item danger" type="button" @click=${() => this.handleContextAction('delete')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M10 11v6m4-6v6M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 .92h8a1 1 0 0 0 1-.92L20 7" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Delete channel</span>
          </button>
        </div>
      ` : ''}
    `
  }
}
