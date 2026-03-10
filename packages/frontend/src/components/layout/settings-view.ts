import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ClaudeSettings, ClaudeSettingsUpdate, SelectedModelProvider } from '@dune/shared'
import { getClaudeSettings, updateClaudeSettings } from '../../services/api-client.js'
import type { ThemeMode } from '../../state/ui-preferences.js'

type TrafficMode = 'inherit' | 'enabled' | 'disabled'
type SettingsSection = 'general' | 'model'

@customElement('settings-view')
export class SettingsView extends LitElement {
  @property() themeMode: ThemeMode = 'system'
  @property({ attribute: false }) initialSection: SettingsSection = 'general'

  @state() private activeSection: SettingsSection = 'general'
  @state() private claudeSettings: ClaudeSettings | null = null
  @state() private claudeLoading = false
  @state() private claudeSaving = false
  @state() private claudeStatusTone: 'idle' | 'success' | 'error' = 'idle'
  @state() private claudeStatusMessage = ''

  @state() private selectedModelProviderDraft: SelectedModelProvider | null = null
  @state() private anthropicApiKeyDraft = ''
  @state() private claudeCodeOAuthTokenDraft = ''
  @state() private anthropicAuthTokenDraft = ''
  @state() private anthropicBaseUrlDraft = ''
  @state() private trafficMode: TrafficMode = 'inherit'

  @state() private clearAnthropicApiKey = false
  @state() private clearClaudeCodeOAuthToken = false
  @state() private clearAnthropicAuthToken = false

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: var(--bg-primary);
    }

    .layout {
      height: 100%;
      display: grid;
      grid-template-columns: var(--settings-nav-width) minmax(0, 1fr);
      min-height: 0;
    }

    .nav {
      background: var(--sidebar-bg);
      padding: 12px 8px 12px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      gap: 10px;
      position: relative;
      isolation: isolate;
    }

    .nav::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: var(--split-shadow-width);
      height: 100%;
      background: var(--split-shadow-strip);
      pointer-events: none;
      z-index: 2;
    }

    .back-btn {
      width: 100%;
      min-height: var(--control-height);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--text-secondary-size);
      font-weight: 500;
      text-align: left;
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .back-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .back-btn svg,
    .nav-item svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .nav-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .nav-item {
      width: 100%;
      min-height: var(--sidebar-row-height);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--text-body-size);
      font-weight: 500;
      text-align: left;
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .nav-item:hover,
    .nav-item.active {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .content {
      min-height: 0;
      overflow-y: auto;
      padding: 14px 16px 20px;
      background: var(--bg-primary);
    }

    .top {
      min-height: var(--header-height);
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      margin-bottom: 14px;
    }

    .title {
      font-size: var(--text-display-size);
      font-weight: 600;
      color: var(--text-primary);
    }

    .section {
      margin-top: 10px;
    }

    .section-title {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .card {
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      overflow: visible;
      padding: 3px;
    }

    .settings-card {
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      padding: 12px;
      display: grid;
      gap: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
    }

    .row-copy {
      min-width: 0;
    }

    .row-label,
    .field-title {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.25;
    }

    .row-sub,
    .field-help {
      margin-top: 3px;
      font-size: var(--text-secondary-size);
      color: var(--text-muted);
      line-height: 1.4;
    }

    .segmented {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--bg-hover) 75%, transparent);
      padding: 3px;
      max-width: 100%;
      overflow-x: auto;
    }

    .segment {
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--text-secondary);
      height: 30px;
      padding: 0 11px;
      font-size: var(--text-secondary-size);
      font-weight: 500;
      white-space: nowrap;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .segment:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .segment.active {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .field-grid {
      display: grid;
      gap: 10px;
    }

    .field {
      padding: 10px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
      display: grid;
      gap: 7px;
    }

    .field-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .field-status {
      font-size: var(--text-secondary-size);
      color: var(--text-muted);
      white-space: nowrap;
    }

    .field-status.success {
      color: var(--text-primary);
    }

    .field-status.warn {
      color: #c38b00;
    }

    .text-input {
      width: 100%;
      min-height: 34px;
      border: 1px solid color-mix(in srgb, var(--text-muted) 24%, transparent);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: var(--text-body-size);
      padding: 7px 9px;
      outline: none;
    }

    .text-input:focus {
      border-color: color-mix(in srgb, var(--text-primary) 40%, transparent);
    }

    .field-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      border: none;
      border-radius: var(--radius-sm);
      min-height: 32px;
      padding: 0 10px;
      background: var(--bg-hover);
      color: var(--text-primary);
      font-size: var(--text-secondary-size);
      font-weight: 500;
      transition: background var(--transition-fast), opacity var(--transition-fast);
    }

    .btn:hover {
      background: color-mix(in srgb, var(--bg-hover) 75%, var(--text-primary) 8%);
    }

    .btn:disabled {
      opacity: 0.55;
    }

    .btn.primary {
      background: color-mix(in srgb, var(--text-primary) 16%, var(--bg-hover));
    }

    .meta-line {
      font-size: var(--text-secondary-size);
      color: var(--text-muted);
    }

    .feedback {
      font-size: var(--text-secondary-size);
      line-height: 1.4;
    }

    .feedback.success {
      color: #2c7a4b;
    }

    .feedback.error {
      color: #b33a3a;
    }

    @media (max-width: 920px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
      }

      .nav {
        padding: 10px;
      }

      .nav::after {
        display: none;
      }

      .content {
        padding: 14px;
      }

      .row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `

  override connectedCallback() {
    super.connectedCallback()
    void this.loadClaudeSettings()
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('initialSection')) {
      this.activeSection = this.initialSection
    }
  }

  private closeSettings() {
    this.dispatchEvent(new CustomEvent('close-settings', {
      bubbles: true,
      composed: true,
    }))
  }

  private emitThemeMode(value: ThemeMode) {
    this.dispatchEvent(new CustomEvent<ThemeMode>('theme-mode-change', {
      detail: value,
      bubbles: true,
      composed: true,
    }))
  }

  private setActiveSection(section: SettingsSection) {
    this.activeSection = section
  }

  private resetSettingsDrafts(settings: ClaudeSettings) {
    this.selectedModelProviderDraft = settings.selectedModelProvider ?? null
    this.anthropicApiKeyDraft = ''
    this.claudeCodeOAuthTokenDraft = ''
    this.anthropicAuthTokenDraft = ''
    this.clearAnthropicApiKey = false
    this.clearClaudeCodeOAuthToken = false
    this.clearAnthropicAuthToken = false
    this.anthropicBaseUrlDraft = settings.anthropicBaseUrl ?? ''

    if (settings.claudeCodeDisableNonessentialTraffic === '1') {
      this.trafficMode = 'enabled'
    } else if (settings.claudeCodeDisableNonessentialTraffic === '0') {
      this.trafficMode = 'disabled'
    } else {
      this.trafficMode = 'inherit'
    }
  }

  private async loadClaudeSettings() {
    this.claudeLoading = true
    try {
      const settings = await getClaudeSettings()
      this.claudeSettings = settings
      this.resetSettingsDrafts(settings)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load model settings'
      this.claudeStatusTone = 'error'
      this.claudeStatusMessage = message
    } finally {
      this.claudeLoading = false
    }
  }

  private buildSettingsPatch(): ClaudeSettingsUpdate {
    const patch: ClaudeSettingsUpdate = {}
    const currentSettings = this.claudeSettings

    if (this.selectedModelProviderDraft !== (currentSettings?.selectedModelProvider ?? null)) {
      patch.selectedModelProvider = this.selectedModelProviderDraft
    }

    const nextBaseUrl = this.anthropicBaseUrlDraft.trim()
    const currentBaseUrl = currentSettings?.anthropicBaseUrl ?? ''
    if (nextBaseUrl !== currentBaseUrl) {
      patch.anthropicBaseUrl = nextBaseUrl || null
    }

    const nextTrafficValue = this.trafficMode === 'inherit'
      ? ''
      : this.trafficMode === 'enabled'
        ? '1'
        : '0'
    const currentTrafficValue = currentSettings?.claudeCodeDisableNonessentialTraffic ?? ''
    if (nextTrafficValue !== currentTrafficValue) {
      patch.claudeCodeDisableNonessentialTraffic = nextTrafficValue || null
    }

    const nextApiKey = this.anthropicApiKeyDraft.trim()
    if (nextApiKey) {
      patch.anthropicApiKey = nextApiKey
    } else if (this.clearAnthropicApiKey) {
      patch.anthropicApiKey = null
    }

    const nextOAuthToken = this.claudeCodeOAuthTokenDraft.trim()
    if (nextOAuthToken) {
      patch.claudeCodeOAuthToken = nextOAuthToken
    } else if (this.clearClaudeCodeOAuthToken) {
      patch.claudeCodeOAuthToken = null
    }

    const nextAuthToken = this.anthropicAuthTokenDraft.trim()
    if (nextAuthToken) {
      patch.anthropicAuthToken = nextAuthToken
    } else if (this.clearAnthropicAuthToken) {
      patch.anthropicAuthToken = null
    }

    return patch
  }

  private hasSettingsChanges(): boolean {
    return Object.keys(this.buildSettingsPatch()).length > 0
  }

  private async saveSettings() {
    if (this.claudeSaving) return
    const patch = this.buildSettingsPatch()

    if (Object.keys(patch).length === 0) {
      this.claudeStatusTone = 'success'
      this.claudeStatusMessage = 'No changes to save.'
      return
    }

    this.claudeSaving = true
    this.claudeStatusTone = 'idle'
    this.claudeStatusMessage = ''

    try {
      const settings = await updateClaudeSettings(patch)
      this.claudeSettings = settings
      this.resetSettingsDrafts(settings)
      this.dispatchEvent(new CustomEvent<ClaudeSettings>('settings-saved', {
        detail: settings,
        bubbles: true,
        composed: true,
      }))
      this.claudeStatusTone = 'success'
      this.claudeStatusMessage = 'Model settings saved.'
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save model settings'
      this.claudeStatusTone = 'error'
      this.claudeStatusMessage = message
    } finally {
      this.claudeSaving = false
    }
  }

  private renderThemeSegment(label: string, value: ThemeMode) {
    const active = value === this.themeMode
    return html`
      <button
        class="segment ${active ? 'active' : ''}"
        type="button"
        aria-pressed=${active}
        @click=${() => this.emitThemeMode(value)}
      >${label}</button>
    `
  }

  private renderTrafficOption(label: string, value: TrafficMode) {
    const active = this.trafficMode === value
    return html`
      <button
        class="segment ${active ? 'active' : ''}"
        type="button"
        aria-pressed=${active}
        @click=${() => {
          this.trafficMode = value
          this.clearClaudeStatusMessage()
        }}
      >${label}</button>
    `
  }

  private renderProviderOption(label: string, value: SelectedModelProvider) {
    const active = this.selectedModelProviderDraft === value
    return html`
      <button
        class="segment ${active ? 'active' : ''}"
        type="button"
        aria-pressed=${active}
        @click=${() => {
          this.selectedModelProviderDraft = value
          this.clearClaudeStatusMessage()
        }}
      >${label}</button>
    `
  }

  private secretStatus(hasValue: boolean, draft: string, clearFlag: boolean): { label: string; tone: '' | 'success' | 'warn' } {
    if (draft.trim()) return { label: 'Will update', tone: 'warn' }
    if (clearFlag) return { label: 'Will clear', tone: 'warn' }
    if (hasValue) return { label: 'Configured', tone: 'success' }
    return { label: 'Not set', tone: '' }
  }

  private clearClaudeStatusMessage() {
    this.claudeStatusTone = 'idle'
    this.claudeStatusMessage = ''
  }

  private formatUpdatedAt(timestamp: number | null): string {
    if (!timestamp) return 'Never saved from UI'
    return new Date(timestamp).toLocaleString()
  }

  private renderGeneralSection() {
    return html`
      <section class="section">
        <h2 class="section-title">General</h2>
        <div class="card">
          <div class="row">
            <div class="row-copy">
              <div class="row-label">Theme</div>
              <p class="row-sub">Use light, dark, or follow your system preference.</p>
            </div>
            <div class="segmented" role="radiogroup" aria-label="Theme mode">
              ${this.renderThemeSegment('Light', 'light')}
              ${this.renderThemeSegment('Dark', 'dark')}
              ${this.renderThemeSegment('System', 'system')}
            </div>
          </div>
        </div>
      </section>
    `
  }

  private renderModelSection() {
    const hasChanges = this.hasSettingsChanges()
    const apiKeyStatus = this.secretStatus(
      !!this.claudeSettings?.hasAnthropicApiKey,
      this.anthropicApiKeyDraft,
      this.clearAnthropicApiKey,
    )
    const oauthStatus = this.secretStatus(
      !!this.claudeSettings?.hasClaudeCodeOAuthToken,
      this.claudeCodeOAuthTokenDraft,
      this.clearClaudeCodeOAuthToken,
    )
    const authTokenStatus = this.secretStatus(
      !!this.claudeSettings?.hasAnthropicAuthToken,
      this.anthropicAuthTokenDraft,
      this.clearAnthropicAuthToken,
    )
    const providerLabel = this.selectedModelProviderDraft === 'claude' ? 'Claude selected' : 'Not set'

    return html`
      <section class="section">
        <h2 class="section-title">Model</h2>
        <div class="settings-card">
          <div class="meta-line">Last updated: ${this.formatUpdatedAt(this.claudeSettings?.updatedAt ?? null)}</div>

          <div class="field">
            <div class="field-top">
              <div class="field-title">Default provider</div>
              <div class="field-status ${this.selectedModelProviderDraft ? 'success' : ''}">${providerLabel}</div>
            </div>
            <div class="field-help">Choose the provider chat uses before sending prompts.</div>
            <div class="field-actions">
              <div class="segmented" role="radiogroup" aria-label="Model provider">
                ${this.renderProviderOption('Claude', 'claude')}
              </div>
              <button
                class="btn"
                type="button"
                .disabled=${this.claudeSaving || this.claudeLoading || this.selectedModelProviderDraft === null}
                @click=${() => {
                  this.selectedModelProviderDraft = null
                  this.clearClaudeStatusMessage()
                }}
              >Clear selection</button>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Claude</h2>
        <div class="settings-card">
          <div class="field-grid">
            <div class="field">
              <div class="field-top">
                <div class="field-title">Anthropic API Key</div>
                <div class="field-status ${apiKeyStatus.tone}">${apiKeyStatus.label}</div>
              </div>
              <div class="field-help">Used as ANTHROPIC_API_KEY for Claude runtime.</div>
              <input
                class="text-input"
                type="password"
                placeholder="Enter new API key"
                autocomplete="off"
                .value=${this.anthropicApiKeyDraft}
                @input=${(e: Event) => {
                  this.anthropicApiKeyDraft = (e.target as HTMLInputElement).value
                  if (this.anthropicApiKeyDraft.trim()) this.clearAnthropicApiKey = false
                  this.clearClaudeStatusMessage()
                }}
              />
              <div class="field-actions">
                <button
                  class="btn"
                  type="button"
                  .disabled=${this.claudeSaving || this.claudeLoading}
                  @click=${() => {
                    this.anthropicApiKeyDraft = ''
                    this.clearAnthropicApiKey = true
                    this.clearClaudeStatusMessage()
                  }}
                >Clear</button>
              </div>
            </div>

            <div class="field">
              <div class="field-top">
                <div class="field-title">Claude Code OAuth Token</div>
                <div class="field-status ${oauthStatus.tone}">${oauthStatus.label}</div>
              </div>
              <div class="field-help">Used as CLAUDE_CODE_OAUTH_TOKEN for Claude CLI execution.</div>
              <input
                class="text-input"
                type="password"
                placeholder="Enter new OAuth token"
                autocomplete="off"
                .value=${this.claudeCodeOAuthTokenDraft}
                @input=${(e: Event) => {
                  this.claudeCodeOAuthTokenDraft = (e.target as HTMLInputElement).value
                  if (this.claudeCodeOAuthTokenDraft.trim()) this.clearClaudeCodeOAuthToken = false
                  this.clearClaudeStatusMessage()
                }}
              />
              <div class="field-actions">
                <button
                  class="btn"
                  type="button"
                  .disabled=${this.claudeSaving || this.claudeLoading}
                  @click=${() => {
                    this.claudeCodeOAuthTokenDraft = ''
                    this.clearClaudeCodeOAuthToken = true
                    this.clearClaudeStatusMessage()
                  }}
                >Clear</button>
              </div>
            </div>

            <div class="field">
              <div class="field-top">
                <div class="field-title">Anthropic Auth Token</div>
                <div class="field-status ${authTokenStatus.tone}">${authTokenStatus.label}</div>
              </div>
              <div class="field-help">Written into /config/.claude/settings.json under env.ANTHROPIC_AUTH_TOKEN.</div>
              <input
                class="text-input"
                type="password"
                placeholder="Enter new auth token"
                autocomplete="off"
                .value=${this.anthropicAuthTokenDraft}
                @input=${(e: Event) => {
                  this.anthropicAuthTokenDraft = (e.target as HTMLInputElement).value
                  if (this.anthropicAuthTokenDraft.trim()) this.clearAnthropicAuthToken = false
                  this.clearClaudeStatusMessage()
                }}
              />
              <div class="field-actions">
                <button
                  class="btn"
                  type="button"
                  .disabled=${this.claudeSaving || this.claudeLoading}
                  @click=${() => {
                    this.anthropicAuthTokenDraft = ''
                    this.clearAnthropicAuthToken = true
                    this.clearClaudeStatusMessage()
                  }}
                >Clear</button>
              </div>
            </div>

            <div class="field">
              <div class="field-top">
                <div class="field-title">Anthropic Base URL</div>
                <div class="field-status">${this.anthropicBaseUrlDraft.trim() ? 'Set' : 'Using fallback'}</div>
              </div>
              <div class="field-help">Written into /config/.claude/settings.json under env.ANTHROPIC_BASE_URL.</div>
              <input
                class="text-input"
                type="text"
                placeholder="https://api.anthropic.com"
                .value=${this.anthropicBaseUrlDraft}
                @input=${(e: Event) => {
                  this.anthropicBaseUrlDraft = (e.target as HTMLInputElement).value
                  this.clearClaudeStatusMessage()
                }}
              />
            </div>

            <div class="field">
              <div class="field-top">
                <div class="field-title">Disable Nonessential Traffic</div>
                <div class="field-status">${this.trafficMode === 'inherit' ? 'Using fallback' : this.trafficMode === 'enabled' ? 'Enabled' : 'Disabled'}</div>
              </div>
              <div class="field-help">Controls CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC in settings.json env.</div>
              <div class="segmented" role="radiogroup" aria-label="Disable nonessential traffic">
                ${this.renderTrafficOption('Inherit', 'inherit')}
                ${this.renderTrafficOption('Enabled', 'enabled')}
                ${this.renderTrafficOption('Disabled', 'disabled')}
              </div>
            </div>
          </div>

          <div class="field-actions">
            <button
              class="btn"
              type="button"
              .disabled=${this.claudeSaving}
              @click=${() => void this.loadClaudeSettings()}
            >Reload</button>
            <button
              class="btn primary"
              type="button"
              .disabled=${this.claudeLoading || this.claudeSaving || !hasChanges}
              @click=${() => void this.saveSettings()}
            >${this.claudeSaving ? 'Saving...' : 'Save model settings'}</button>
          </div>

          ${this.claudeLoading
            ? html`<div class="feedback">Loading model settings...</div>`
            : nothing}
          ${this.claudeStatusMessage
            ? html`
                <div class="feedback ${this.claudeStatusTone === 'success' ? 'success' : ''} ${this.claudeStatusTone === 'error' ? 'error' : ''}">
                  ${this.claudeStatusMessage}
                </div>
              `
            : nothing}
        </div>
      </section>
    `
  }

  override render() {
    const isGeneral = this.activeSection === 'general'
    const isModel = this.activeSection === 'model'

    return html`
      <div class="layout">
        <aside class="nav" aria-label="Settings navigation">
          <button class="back-btn" type="button" @click=${this.closeSettings}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 6 8 12l6 6" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Back to app</span>
          </button>

          <div class="nav-list">
            <button
              class="nav-item ${isGeneral ? 'active' : ''}"
              type="button"
              aria-current=${isGeneral ? 'page' : 'false'}
              @click=${() => this.setActiveSection('general')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"></path>
              </svg>
              <span>General</span>
            </button>
            <button
              class="nav-item ${isModel ? 'active' : ''}"
              type="button"
              aria-current=${isModel ? 'page' : 'false'}
              @click=${() => this.setActiveSection('model')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m12 4 8 4-8 4-8-4 8-4Zm-8 4v8l8 4 8-4V8" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
              <span>Model</span>
            </button>
          </div>
        </aside>

        <main class="content">
          <div class="top">
            <h1 class="title">Settings</h1>
          </div>
          ${this.activeSection === 'general'
            ? this.renderGeneralSection()
            : this.renderModelSection()}
        </main>
      </div>
    `
  }
}
