import { LitElement, css, html } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import type { Agent, MiniApp } from '@dune/shared'

@customElement('agent-app-library')
export class AgentAppLibrary extends LitElement {
  @property({ type: Object }) agent!: Agent
  @property({ type: Array }) apps: MiniApp[] = []
  @property({ type: Boolean }) loading = false
  @property({ type: String }) errorMessage = ''
  @property({ type: Object }) runtimeErrors: Record<string, string> = {}

  @litState() private query = ''
  @litState() private statusFilter: 'all' | 'published' | 'building' | 'archived' | 'error' = 'all'

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

    .status-select {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: var(--text-secondary-size);
    }

    .refresh-btn {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-secondary-size);
      padding: 8px 11px;
      font-weight: 600;
    }

    .refresh-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
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

    .collection + .collection {
      margin-top: 14px;
    }

    .collection-title {
      font-size: var(--text-meta-size);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin: 0 0 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .collection-count {
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
      transition: background var(--transition-fast), transform var(--transition-fast);
    }

    .card:hover:enabled {
      background: var(--bg-hover);
      transform: translateY(-1px);
    }

    .card:disabled {
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

    .meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--text-meta-size);
      color: var(--text-muted);
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

    .error-inline {
      font-size: var(--text-meta-size);
      color: var(--error);
      margin-top: 2px;
      line-height: 1.4;
    }
  `

  private formatDate(ts: number): string {
    return new Date(ts).toLocaleString()
  }

  private emitRefresh() {
    this.dispatchEvent(new CustomEvent('refresh-apps', { bubbles: true, composed: true }))
  }

  private emitOpen(slug: string) {
    this.dispatchEvent(new CustomEvent('open-miniapp', {
      detail: { slug },
      bubbles: true,
      composed: true,
    }))
  }

  private renderAppCard(app: MiniApp) {
    const runtimeError = this.runtimeErrors[app.slug]
    const disabled = !app.openable || !!runtimeError
    const cardError = runtimeError || app.error || ''
    return html`
      <button
        class="card"
        type="button"
        ?disabled=${disabled}
        title=${disabled ? (cardError || 'Miniapp unavailable') : 'Open miniapp'}
        @click=${() => this.emitOpen(app.slug)}
      >
        <div class="row-top">
          <div class="name">${app.name}</div>
          <span class="status ${app.status}">${app.status}</span>
        </div>
        <div class="desc">${app.description || 'No description yet.'}</div>
        ${app.tags.length > 0 ? html`
          <div class="tags">
            ${app.tags.slice(0, 4).map(tag => html`<span class="tag">${tag}</span>`)}
          </div>
        ` : ''}
        ${cardError ? html`<div class="error-inline">${cardError}</div>` : ''}
        <div class="meta">
          <span>${app.slug}</span>
          <span>${this.formatDate(app.updatedAt)}</span>
        </div>
      </button>
    `
  }

  private get filteredApps(): MiniApp[] {
    const needle = this.query.trim().toLowerCase()
    return this.apps.filter((app) => {
      if (this.statusFilter !== 'all' && app.status !== this.statusFilter) return false
      if (!needle) return true
      return [
        app.name,
        app.slug,
        app.description,
        app.collection,
        ...app.tags,
      ].join(' ').toLowerCase().includes(needle)
    })
  }

  private get groupedApps(): Array<{ collection: string; apps: MiniApp[] }> {
    const byCollection = new Map<string, MiniApp[]>()
    for (const app of this.filteredApps) {
      const collection = app.collection || 'Uncategorized'
      if (!byCollection.has(collection)) byCollection.set(collection, [])
      byCollection.get(collection)!.push(app)
    }
    return [...byCollection.entries()].map(([collection, apps]) => ({ collection, apps }))
  }

  render() {
    return html`
      <div class="shell">
        <div class="toolbar">
          <input
            class="search"
            type="search"
            .value=${this.query}
            @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value }}
            placeholder=${`Search ${this.agent?.name || 'agent'} miniapps...`}
          />
          <select
            class="status-select"
            .value=${this.statusFilter}
            @change=${(e: Event) => { this.statusFilter = (e.target as HTMLSelectElement).value as typeof this.statusFilter }}
          >
            <option value="all">All status</option>
            <option value="published">Published</option>
            <option value="building">Building</option>
            <option value="archived">Archived</option>
            <option value="error">Error</option>
          </select>
          <button class="refresh-btn" type="button" @click=${this.emitRefresh}>Refresh</button>
        </div>

        <div class="content">
          ${this.loading
            ? html`<div class="state">Loading miniapps...</div>`
            : this.errorMessage
              ? html`<div class="state">${this.errorMessage}</div>`
              : this.groupedApps.length === 0
                ? html`<div class="state">No miniapps found for this agent.</div>`
                : this.groupedApps.map(group => html`
                  <section class="collection">
                    <h3 class="collection-title">
                      <span>${group.collection}</span>
                      <span class="collection-count">${group.apps.length}</span>
                    </h3>
                    <div class="grid">
                      ${group.apps.map(app => this.renderAppCard(app))}
                    </div>
                  </section>
                `)}
        </div>
      </div>
    `
  }
}
