import { LitElement, html, css } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import type { AgentMount } from '@dune/shared'
import * as api from '../../services/api-client.js'

@customElement('agent-mounts-panel')
export class AgentMountsPanel extends LitElement {
  @property({ type: String }) agentId = ''
  @property({ type: Boolean }) agentRunning = false

  @litState() private mounts: AgentMount[] = []
  @litState() private mountsLoading = false
  @litState() private mountsError = ''
  @litState() private mountsInfo = ''
  @litState() private mountBusy = false
  @litState() private hostPickerBusy = false
  @litState() private newHostPath = ''
  @litState() private newGuestPath = '/workspace/local'
  @litState() private newReadOnly = true
  @litState() private mountDrafts: Record<string, { hostPath: string; guestPath: string; readOnly: boolean }> = {}

  static styles = css`
    :host {
      display: block;
    }

    .mounts-panel {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 260px;
      overflow: auto;
    }

    .mounts-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .mounts-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .spacer {
      flex: 1;
    }

    .mounts-note {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .mounts-info,
    .mounts-error {
      font-size: 12px;
      padding: 7px 9px;
      border-radius: var(--radius-sm);
    }

    .mounts-info {
      color: var(--success);
      background: color-mix(in srgb, var(--success) 12%, transparent);
    }

    .mounts-error {
      color: var(--error);
      background: color-mix(in srgb, var(--error) 10%, transparent);
    }

    .mount-row,
    .new-mount-row {
      display: grid;
      grid-template-columns: minmax(120px, 1.4fr) minmax(120px, 1.2fr) auto auto auto;
      gap: 8px;
      align-items: center;
    }

    .host-input-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .host-input-group .mount-input {
      flex: 1;
    }

    .mount-input {
      width: 100%;
      min-width: 0;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      padding: 6px 8px;
    }

    .mount-check {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .mount-btn {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-hover);
      color: var(--text-primary);
      font-size: 12px;
      font-weight: 600;
      padding: 6px 10px;
      cursor: pointer;
      transition: background var(--transition-fast);
      white-space: nowrap;
    }

    .mount-btn:hover {
      background: color-mix(in srgb, var(--accent) 14%, var(--bg-hover));
    }

    .mount-btn.danger:hover {
      background: color-mix(in srgb, var(--error) 16%, var(--bg-hover));
    }

    .mount-btn:disabled,
    .mount-input:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .mount-empty {
      font-size: 12px;
      color: var(--text-muted);
      padding: 4px 2px;
    }

    @media (max-width: 860px) {
      .mount-row,
      .new-mount-row {
        grid-template-columns: 1fr;
      }

      .mount-check {
        justify-self: start;
      }
    }
  `

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('agentId')) return
    this.mountsError = ''
    this.mountsInfo = ''
    this.newHostPath = ''
    this.newGuestPath = '/workspace/local'
    this.newReadOnly = true
    void this.loadMounts()
  }

  private setMountDrafts(nextMounts: AgentMount[]) {
    const drafts: Record<string, { hostPath: string; guestPath: string; readOnly: boolean }> = {}
    for (const mount of nextMounts) {
      drafts[mount.id] = {
        hostPath: mount.hostPath,
        guestPath: mount.guestPath,
        readOnly: mount.readOnly,
      }
    }
    this.mountDrafts = drafts
  }

  private async loadMounts() {
    if (!this.agentId) return
    this.mountsLoading = true
    this.mountsError = ''
    try {
      const mounts = await api.listAgentMounts(this.agentId)
      this.mounts = mounts
      this.setMountDrafts(mounts)
    } catch (err: any) {
      this.mountsError = err?.message || 'Failed to load mounts'
    } finally {
      this.mountsLoading = false
    }
  }

  private setMountDraft(id: string, patch: Partial<{ hostPath: string; guestPath: string; readOnly: boolean }>) {
    const current = this.mountDrafts[id]
    if (!current) return
    this.mountDrafts = {
      ...this.mountDrafts,
      [id]: { ...current, ...patch },
    }
  }

  private async createMount() {
    if (!this.agentId || this.mountBusy) return
    this.mountBusy = true
    this.mountsError = ''
    this.mountsInfo = ''
    try {
      await api.createAgentMount(this.agentId, {
        hostPath: this.newHostPath.trim(),
        guestPath: this.newGuestPath.trim(),
        readOnly: this.newReadOnly,
      })
      this.mountsInfo = 'Mount created.'
      this.newHostPath = ''
      this.newGuestPath = '/workspace/local'
      this.newReadOnly = true
      await this.loadMounts()
    } catch (err: any) {
      this.mountsError = err?.message || 'Failed to create mount'
    } finally {
      this.mountBusy = false
    }
  }

  private normalizeGuestPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').trim()
    if (!normalized) return ''
    if (normalized === '/') return '/'
    return normalized.replace(/\/+$/, '')
  }

  private mountGuestPathConflicts(candidatePath: string): boolean {
    const candidate = this.normalizeGuestPath(candidatePath)
    if (!candidate) return false
    for (const mount of this.mounts) {
      const existing = this.normalizeGuestPath(mount.guestPath)
      if (!existing) continue
      if (existing === candidate) return true
      if (existing.startsWith(`${candidate}/`)) return true
      if (candidate.startsWith(`${existing}/`)) return true
    }
    return false
  }

  private suggestGuestPathFromHost(hostPath: string): string {
    const normalizedHost = hostPath.replace(/\\/g, '/').replace(/\/+$/, '').trim()
    const tail = normalizedHost.split('/').pop() || 'local'
    const base = tail
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'local'
    let candidate = `/workspace/${base}`
    let suffix = 2
    while (this.mountGuestPathConflicts(candidate)) {
      candidate = `/workspace/${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private async browseHostPath() {
    if (!this.agentId || this.mountBusy || this.hostPickerBusy) return
    this.hostPickerBusy = true
    this.mountsError = ''
    this.mountsInfo = ''
    try {
      const result = await api.selectAgentMountHostDirectory(this.agentId)
      if (result.status === 'selected') {
        this.newHostPath = result.hostPath
        this.newGuestPath = this.suggestGuestPathFromHost(result.hostPath)
      }
    } catch (err: any) {
      const message = String(err?.message || '')
      if (message === 'folder_picker_unavailable') {
        this.mountsError = 'Folder picker is unavailable on this system. Enter host path manually.'
      } else if (message === 'folder_picker_failed') {
        this.mountsError = 'Failed to open folder picker. Enter host path manually.'
      } else {
        this.mountsError = err?.message || 'Failed to choose host folder'
      }
    } finally {
      this.hostPickerBusy = false
    }
  }

  private async saveMount(mountId: string) {
    if (!this.agentId || this.mountBusy) return
    const draft = this.mountDrafts[mountId]
    if (!draft) return
    this.mountBusy = true
    this.mountsError = ''
    this.mountsInfo = ''
    try {
      await api.updateAgentMount(this.agentId, mountId, {
        hostPath: draft.hostPath.trim(),
        guestPath: draft.guestPath.trim(),
        readOnly: draft.readOnly,
      })
      this.mountsInfo = 'Mount updated.'
      await this.loadMounts()
    } catch (err: any) {
      this.mountsError = err?.message || 'Failed to update mount'
    } finally {
      this.mountBusy = false
    }
  }

  private async deleteMount(mountId: string) {
    if (!this.agentId || this.mountBusy) return
    if (!confirm('Delete this mount?')) return
    this.mountBusy = true
    this.mountsError = ''
    this.mountsInfo = ''
    try {
      await api.deleteAgentMount(this.agentId, mountId)
      this.mountsInfo = 'Mount deleted.'
      await this.loadMounts()
    } catch (err: any) {
      this.mountsError = err?.message || 'Failed to delete mount'
    } finally {
      this.mountBusy = false
    }
  }

  render() {
    const controlsDisabled = this.mountBusy || this.hostPickerBusy || this.mountsLoading || this.agentRunning
    return html`
      <div class="mounts-panel">
        <div class="mounts-header">
          <span class="mounts-title">Local Mounts</span>
          <span class="spacer"></span>
          <button class="mount-btn" type="button" @click=${() => this.loadMounts()} ?disabled=${this.mountsLoading}>Refresh</button>
        </div>
        <div class="mounts-note">Bind host paths into the agent container. Stop the agent before changing mounts.</div>
        ${this.mountsInfo ? html`<div class="mounts-info">${this.mountsInfo}</div>` : ''}
        ${this.mountsError ? html`<div class="mounts-error">${this.mountsError}</div>` : ''}
        <div class="new-mount-row">
          <div class="host-input-group">
            <input
              class="mount-input"
              .value=${this.newHostPath}
              @input=${(e: Event) => { this.newHostPath = (e.target as HTMLInputElement).value }}
              placeholder="/absolute/host/path"
              ?disabled=${controlsDisabled}
            />
            <button class="mount-btn" type="button" @click=${() => this.browseHostPath()} ?disabled=${controlsDisabled}>
              ${this.hostPickerBusy ? 'Browsing...' : 'Browse'}
            </button>
          </div>
          <input
            class="mount-input"
            .value=${this.newGuestPath}
            @input=${(e: Event) => { this.newGuestPath = (e.target as HTMLInputElement).value }}
            placeholder="/workspace/project"
            ?disabled=${controlsDisabled}
          />
          <label class="mount-check">
            <input
              type="checkbox"
              .checked=${this.newReadOnly}
              @change=${(e: Event) => { this.newReadOnly = (e.target as HTMLInputElement).checked }}
              ?disabled=${controlsDisabled}
            />
            <span>Read-only</span>
          </label>
          <button class="mount-btn" type="button" @click=${() => this.createMount()} ?disabled=${controlsDisabled}>
            Add Mount
          </button>
          <span></span>
        </div>
        ${this.mountsLoading
          ? html`<div class="mount-empty">Loading mounts...</div>`
          : this.mounts.length === 0
            ? html`<div class="mount-empty">No mounts configured.</div>`
            : this.mounts.map((mount) => {
                const draft = this.mountDrafts[mount.id] || {
                  hostPath: mount.hostPath,
                  guestPath: mount.guestPath,
                  readOnly: mount.readOnly,
                }
                return html`
                  <div class="mount-row">
                    <input
                      class="mount-input"
                      .value=${draft.hostPath}
                      @input=${(e: Event) => this.setMountDraft(mount.id, { hostPath: (e.target as HTMLInputElement).value })}
                      ?disabled=${controlsDisabled}
                    />
                    <input
                      class="mount-input"
                      .value=${draft.guestPath}
                      @input=${(e: Event) => this.setMountDraft(mount.id, { guestPath: (e.target as HTMLInputElement).value })}
                      ?disabled=${controlsDisabled}
                    />
                    <label class="mount-check">
                      <input
                        type="checkbox"
                        .checked=${draft.readOnly}
                        @change=${(e: Event) => this.setMountDraft(mount.id, { readOnly: (e.target as HTMLInputElement).checked })}
                        ?disabled=${controlsDisabled}
                      />
                      <span>Read-only</span>
                    </label>
                    <button class="mount-btn" type="button" @click=${() => this.saveMount(mount.id)} ?disabled=${controlsDisabled}>
                      Save
                    </button>
                    <button class="mount-btn danger" type="button" @click=${() => this.deleteMount(mount.id)} ?disabled=${controlsDisabled}>
                      Delete
                    </button>
                  </div>
                `
              })}
      </div>
    `
  }
}
