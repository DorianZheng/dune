import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import type { MiniApp } from '@dune/shared'

@customElement('apps-view')
export class AppsView extends LitElement {
  @property({ type: Array }) apps: MiniApp[] = []
  @property({ type: Boolean }) loading = false

  @litState() private query = ''
  @litState() private statusFilter: 'all' | 'published' | 'building' | 'archived' | 'error' = 'all'
  @litState() private agentFilter = ''

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary);
    }

    .shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      gap: var(--space-sm);
      padding: 10px 12px;
    }

    .toolbar {
      display: flex;
      gap: var(--space-sm);
      align-items: center;
      flex-wrap: wrap;
    }

    .title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin-right: 4px;
    }

    .search {
      flex: 1;
      min-width: 220px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: var(--text-secondary-size);
    }

    .filter-select {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: var(--text-secondary-size);
    }

    .content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding-right: 2px;
    }

    .state {
      min-height: 140px;
      border-radius: var(--radius);
      background: var(--bg-surface);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: var(--text-secondary-size);
    }

    .agent-section + .agent-section {
      margin-top: 18px;
    }

    .agent-header {
      font-size: var(--text-meta-size);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin: 0 0 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .agent-count {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 10px;
    }

    .card {
      border: none;
      border-radius: var(--radius);
      background: var(--bg-surface);
      text-align: left;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 140px;
      cursor: pointer;
      transition: background var(--transition-fast), transform var(--transition-fast);
    }

    .card:hover:not(.disabled) {
      background: var(--bg-hover);
      transform: translateY(-1px);
    }

    .card.disabled {
      opacity: 0.62;
      cursor: not-allowed;
    }

    .row-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: flex-start;
    }

    .name {
      font-size: var(--text-body-size);
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .status {
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      white-space: nowrap;
      text-transform: capitalize;
    }

    .status.published {
      background: color-mix(in srgb, var(--success) 16%, transparent);
      color: var(--success);
    }

    .status.building {
      background: color-mix(in srgb, var(--warning) 16%, transparent);
      color: var(--warning);
    }

    .status.archived {
      background: color-mix(in srgb, var(--text-muted) 18%, transparent);
      color: var(--text-muted);
    }

    .status.error {
      background: color-mix(in srgb, var(--error) 16%, transparent);
      color: var(--error);
    }

    .kind-badge {
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      white-space: nowrap;
      background: color-mix(in srgb, var(--accent-soft) 50%, transparent);
      color: var(--text-secondary);
    }

    .desc {
      font-size: var(--text-secondary-size);
      color: var(--text-secondary);
      line-height: 1.45;
      flex: 1;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
    }

    .tag {
      font-size: 11px;
      color: var(--text-secondary);
      background: color-mix(in srgb, var(--accent-soft) 45%, transparent);
      border-radius: 999px;
      padding: 2px 7px;
    }

    .meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--text-meta-size);
      color: var(--text-muted);
    }

    .backend-info {
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: var(--bg-code);
      font-size: 12px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      line-height: 1.5;
    }

    .backend-info dt {
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .backend-info dd {
      margin: 0 0 6px;
    }
  `

  private get agentNames(): string[] {
    const names = new Set<string>()
    for (const app of this.apps) {
      if (app.agentName) names.add(app.agentName)
    }
    return [...names].sort()
  }

  private get filteredApps(): MiniApp[] {
    const needle = this.query.trim().toLowerCase()
    return this.apps.filter((app) => {
      if (this.statusFilter !== 'all' && app.status !== this.statusFilter) return false
      if (this.agentFilter && app.agentName !== this.agentFilter) return false
      if (!needle) return true
      return [app.name, app.slug, app.description, app.agentName || '', ...app.tags]
        .join(' ').toLowerCase().includes(needle)
    })
  }

  private get groupedByAgent(): Array<{ agentName: string; apps: MiniApp[] }> {
    const byAgent = new Map<string, MiniApp[]>()
    for (const app of this.filteredApps) {
      const name = app.agentName || 'Unknown'
      if (!byAgent.has(name)) byAgent.set(name, [])
      byAgent.get(name)!.push(app)
    }
    return [...byAgent.entries()].map(([agentName, apps]) => ({ agentName, apps }))
  }

  private formatDate(ts: number): string {
    return new Date(ts).toLocaleString()
  }

  private handleCardClick(app: MiniApp) {
    if (!app.openable) return
    if (app.kind === 'backend') return // backend apps show info, no iframe
    this.dispatchEvent(new CustomEvent('open-miniapp', {
      detail: { slug: app.slug, agentId: app.agentId },
      bubbles: true,
      composed: true,
    }))
  }

  private renderCard(app: MiniApp) {
    const isBackend = app.kind === 'backend'
    const disabled = !app.openable

    return html`
      <div
        class="card ${disabled ? 'disabled' : ''}"
        @click=${() => this.handleCardClick(app)}
      >
        <div class="row-top">
          <div class="name">${app.name}</div>
          <span class="status ${app.status}">${app.status}</span>
        </div>
        ${isBackend ? html`<span class="kind-badge">Backend</span>` : nothing}
        <div class="desc">${app.description || 'No description yet.'}</div>
        ${isBackend && app.sandboxId ? html`
          <dl class="backend-info">
            ${app.sandboxId ? html`<dt>Sandbox</dt><dd>${app.sandboxId}</dd>` : nothing}
            ${app.port != null ? html`<dt>Port</dt><dd>${app.port}</dd>` : nothing}
            ${app.path ? html`<dt>Path</dt><dd>${app.path}</dd>` : nothing}
          </dl>
        ` : nothing}
        ${app.tags.length > 0 ? html`
          <div class="tags">
            ${app.tags.slice(0, 4).map(tag => html`<span class="tag">${tag}</span>`)}
          </div>
        ` : nothing}
        ${app.error ? html`<div style="font-size:12px;color:var(--error)">${app.error}</div>` : nothing}
        <div class="meta">
          <span>${app.slug}</span>
          <span>${this.formatDate(app.updatedAt)}</span>
        </div>
      </div>
    `
  }

  render() {
    return html`
      <div class="shell">
        <div class="toolbar">
          <span class="title">Apps</span>
          <input
            class="search"
            type="search"
            .value=${this.query}
            @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value }}
            placeholder="Search all apps..."
          />
          <select
            class="filter-select"
            .value=${this.statusFilter}
            @change=${(e: Event) => { this.statusFilter = (e.target as HTMLSelectElement).value as typeof this.statusFilter }}
          >
            <option value="all">All status</option>
            <option value="published">Published</option>
            <option value="building">Building</option>
            <option value="archived">Archived</option>
            <option value="error">Error</option>
          </select>
          <select
            class="filter-select"
            .value=${this.agentFilter}
            @change=${(e: Event) => { this.agentFilter = (e.target as HTMLSelectElement).value }}
          >
            <option value="">All agents</option>
            ${this.agentNames.map(name => html`<option value=${name}>${name}</option>`)}
          </select>
        </div>

        <div class="content">
          ${this.loading
            ? html`<div class="state">Loading apps...</div>`
            : this.groupedByAgent.length === 0
              ? html`<div class="state">No apps found.</div>`
              : this.groupedByAgent.map(group => html`
                <section class="agent-section">
                  <h3 class="agent-header">
                    <span>${group.agentName}</span>
                    <span class="agent-count">${group.apps.length}</span>
                  </h3>
                  <div class="grid">
                    ${group.apps.map(app => this.renderCard(app))}
                  </div>
                </section>
              `)}
        </div>
      </div>
    `
  }
}
