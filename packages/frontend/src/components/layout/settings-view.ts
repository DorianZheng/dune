import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ClaudeSettings, ClaudeSettingsUpdate, SelectedModelProvider, SlackSettings, SlackChannelLink, SlackChannel, Channel } from '@dune/shared'
import { getClaudeSettings, updateClaudeSettings, getSlackSettings, updateSlackSettings, disconnectSlack, listSlackRemoteChannels, listSlackLinks, createSlackLink, deleteSlackLink, listChannels } from '../../services/rpc.js'

import type { ThemeMode } from '../../state/ui-preferences.js'

type TrafficMode = 'inherit' | 'enabled' | 'disabled'
type SettingsSection = 'general' | 'model' | 'integrations'

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
  @state() private defaultModelIdDraft = ''
  @state() private anthropicApiKeyDraft = ''
  @state() private claudeCodeOAuthTokenDraft = ''
  @state() private anthropicAuthTokenDraft = ''
  @state() private anthropicBaseUrlDraft = ''
  @state() private trafficMode: TrafficMode = 'inherit'

  @state() private clearAnthropicApiKey = false
  @state() private clearClaudeCodeOAuthToken = false
  @state() private clearAnthropicAuthToken = false

  // Slack
  @state() private slackSettings: SlackSettings | null = null
  @state() private slackLoading = false
  @state() private slackBotTokenDraft = ''
  @state() private slackAppTokenDraft = ''
  @state() private slackLinks: SlackChannelLink[] = []
  @state() private slackRemoteChannels: SlackChannel[] = []
  @state() private duneChannels: Channel[] = []
  @state() private slackLinkDuneChannelId = ''
  @state() private slackLinkSlackChannelId = ''
  @state() private slackStatusMessage = ''
  @state() private slackStatusTone: 'idle' | 'success' | 'error' = 'idle'

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: transparent;
      padding: 18px;
    }

    .layout {
      height: 100%;
      display: grid;
      grid-template-columns: var(--settings-nav-width) minmax(0, 1fr);
      min-height: 0;
      gap: 14px;
    }

    .nav {
      background: var(--glass-bg);
      border: 1px solid var(--border-color);
      border-radius: 24px;
      padding: 14px 10px 12px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      gap: 12px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
    }

    .back-btn {
      width: 100%;
      min-height: var(--control-height);
      border: 1px solid transparent;
      border-radius: 14px;
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
      border-color: var(--border-light);
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
      gap: 5px;
    }

    .nav-item {
      width: 100%;
      min-height: var(--sidebar-row-height);
      border: 1px solid transparent;
      border-radius: 16px;
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
      border-color: var(--row-selected-border);
      box-shadow: var(--shadow-sm);
      color: var(--text-primary);
    }

    .content {
      min-height: 0;
      overflow-y: auto;
      padding: 22px 24px 28px;
      background: var(--glass-bg);
      border: 1px solid var(--border-color);
      border-radius: 26px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
    }

    .top {
      min-height: 78px;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      gap: 10px;
      margin-bottom: 18px;
    }

    .title {
      font-size: clamp(28px, 3vw, 36px);
      font-weight: 640;
      color: var(--text-primary);
      letter-spacing: -0.03em;
    }

    .section {
      margin-top: 14px;
    }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .card {
      border-radius: 20px;
      background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
      overflow: visible;
      padding: 4px;
      border: 1px solid var(--border-light);
    }

    .settings-card {
      border-radius: 20px;
      background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
      padding: 14px;
      display: grid;
      gap: 14px;
      border: 1px solid var(--border-light);
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 14px 16px;
      border-radius: 18px;
      background: color-mix(in srgb, var(--bg-surface) 78%, transparent);
      border: 1px solid var(--border-light);
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
      background: color-mix(in srgb, var(--bg-hover) 84%, transparent);
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
      background: var(--sidebar-selected);
      color: var(--text-primary);
    }

    .field-grid {
      display: grid;
      gap: 12px;
    }

    .field {
      padding: 14px;
      border-radius: 18px;
      background: color-mix(in srgb, var(--bg-hover) 72%, transparent);
      display: grid;
      gap: 8px;
      border: 1px solid var(--border-light);
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
    this.defaultModelIdDraft = settings.defaultModelId ?? ''
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
    const nextDefaultModelId = this.defaultModelIdDraft.trim()
    const currentDefaultModelId = currentSettings?.defaultModelId ?? ''
    if (nextDefaultModelId !== currentDefaultModelId) {
      patch.defaultModelId = nextDefaultModelId || null
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

  private renderDefaultModelOption(label: string, value: string | null) {
    const active = (this.defaultModelIdDraft.trim() || null) === value
    return html`
      <button
        class="segment ${active ? 'active' : ''}"
        type="button"
        aria-pressed=${active}
        @click=${() => {
          this.defaultModelIdDraft = value ?? ''
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
    const defaultModelLabel = this.defaultModelIdDraft.trim() || 'Claude CLI default'

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

          <div class="field">
            <div class="field-top">
              <div class="field-title">Workspace default Claude model</div>
              <div class="field-status ${this.defaultModelIdDraft.trim() ? 'success' : ''}">${defaultModelLabel}</div>
            </div>
            <div class="field-help">Optional Claude model alias passed as <code>--model</code>. Leave unset to use Claude Code&apos;s own default.</div>
            <div class="field-actions">
              <div class="segmented" role="radiogroup" aria-label="Default Claude model">
                ${this.renderDefaultModelOption('Claude default', null)}
                ${this.renderDefaultModelOption('Sonnet', 'sonnet')}
                ${this.renderDefaultModelOption('Opus', 'opus')}
                ${this.renderDefaultModelOption('Haiku', 'haiku')}
              </div>
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
            <button
              class="nav-item ${this.activeSection === 'integrations' ? 'active' : ''}"
              type="button"
              aria-current=${this.activeSection === 'integrations' ? 'page' : 'false'}
              @click=${() => this.setActiveSection('integrations')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
              <span>Integrations</span>
            </button>
          </div>
        </aside>

        <main class="content">
          <div class="top">
            <h1 class="title">Settings</h1>
          </div>
          ${this.activeSection === 'general'
            ? this.renderGeneralSection()
            : this.activeSection === 'model'
              ? this.renderModelSection()
              : this.renderIntegrationsSection()}
        </main>
      </div>
    `
  }

  // ── Slack / Integrations ───────────────────────────────────────────

  private async loadSlackSettings() {
    this.slackLoading = true
    try {
      const [settings, links, duneChannels] = await Promise.all([
        getSlackSettings(),
        listSlackLinks(),
        listChannels(),
      ])
      this.slackSettings = settings
      this.slackLinks = links
      this.duneChannels = duneChannels

      if (settings.isConnected) {
        try {
          this.slackRemoteChannels = await listSlackRemoteChannels()
        } catch {
          this.slackRemoteChannels = []
        }
      }
    } catch (err) {
      this.slackStatusTone = 'error'
      this.slackStatusMessage = err instanceof Error ? err.message : 'Failed to load Slack settings'
    } finally {
      this.slackLoading = false
    }
  }

  private async saveSlackCredentials() {
    const data: { botToken?: string; appToken?: string } = {}
    if (this.slackBotTokenDraft.trim()) data.botToken = this.slackBotTokenDraft.trim()
    if (this.slackAppTokenDraft.trim()) data.appToken = this.slackAppTokenDraft.trim()
    if (!data.botToken && !data.appToken) return
    try {
      this.slackSettings = await updateSlackSettings(data)
      this.slackBotTokenDraft = ''
      this.slackAppTokenDraft = ''
      this.slackStatusTone = 'success'
      this.slackStatusMessage = 'Connected to Slack.'
      await this.loadSlackSettings()
    } catch (err) {
      this.slackStatusTone = 'error'
      this.slackStatusMessage = err instanceof Error ? err.message : 'Failed to connect'
    }
  }

  private copySlackManifest() {
    const manifest = JSON.stringify({
      display_information: { name: 'Dune' },
      features: {
        app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
        bot_user: { display_name: 'Dune', always_online: true },
      },
      oauth_config: {
        scopes: {
          bot: ['channels:history', 'channels:read', 'chat:write', 'chat:write.customize', 'users:read', 'app_mentions:read', 'im:history'],
        },
      },
      settings: {
        event_subscriptions: { bot_events: ['app_mention', 'message.channels'] },
        socket_mode_enabled: true,
      },
    }, null, 2)
    navigator.clipboard.writeText(manifest)
    this.slackStatusTone = 'success'
    this.slackStatusMessage = 'Manifest copied to clipboard.'
  }

  private async handleDisconnectSlack() {
    try {
      await disconnectSlack()
      this.slackSettings = { isConnected: false, teamId: null, teamName: null, botUserId: null, installedAt: null }
      this.slackLinks = []
      this.slackRemoteChannels = []
      this.slackStatusTone = 'success'
      this.slackStatusMessage = 'Slack disconnected.'
    } catch (err) {
      this.slackStatusTone = 'error'
      this.slackStatusMessage = err instanceof Error ? err.message : 'Failed to disconnect'
    }
  }

  private async handleCreateLink() {
    if (!this.slackLinkDuneChannelId || !this.slackLinkSlackChannelId) return
    const slackCh = this.slackRemoteChannels.find(c => c.id === this.slackLinkSlackChannelId)
    try {
      await createSlackLink({
        duneChannelId: this.slackLinkDuneChannelId,
        slackChannelId: this.slackLinkSlackChannelId,
        slackChannelName: slackCh?.name || this.slackLinkSlackChannelId,
      })
      this.slackLinkDuneChannelId = ''
      this.slackLinkSlackChannelId = ''
      this.slackLinks = await listSlackLinks()
    } catch (err) {
      this.slackStatusTone = 'error'
      this.slackStatusMessage = err instanceof Error ? err.message : 'Failed to create link'
    }
  }

  private async handleDeleteLink(id: string) {
    try {
      await deleteSlackLink(id)
      this.slackLinks = await listSlackLinks()
    } catch (err) {
      this.slackStatusTone = 'error'
      this.slackStatusMessage = err instanceof Error ? err.message : 'Failed to delete link'
    }
  }

  private renderIntegrationsSection() {
    if (!this.slackSettings && !this.slackLoading) {
      void this.loadSlackSettings()
    }

    const connected = this.slackSettings?.isConnected ?? false

    return html`
      <section class="section">
        <h2 class="section-title">Slack</h2>
        <div class="settings-card">
          <div class="field">
            <div class="field-top">
              <div class="field-title">Connection</div>
              <div class="field-status ${connected ? 'success' : ''}">${connected ? `Connected to ${this.slackSettings?.teamName || 'workspace'}` : 'Not connected'}</div>
            </div>
            <div class="field-help">Connect to a Slack workspace to bridge messages between Dune channels and Slack channels.</div>

            ${!connected ? html`
              <div class="field-help">
                1. <a href="https://api.slack.com/apps" target="_blank" rel="noopener">Create a Slack app</a> (use
                <button class="btn" type="button" style="display:inline;min-height:auto;padding:2px 6px;font-size:inherit;" @click=${() => this.copySlackManifest()}>Copy Manifest</button>
                for quick setup)
                <br>2. Install it to your workspace
                <br>3. Paste the tokens below
              </div>
              <div class="field-grid">
                <div class="field">
                  <div class="field-top">
                    <div class="field-title">Bot Token</div>
                  </div>
                  <div class="field-help">From: Install App → Bot User OAuth Token</div>
                  <input class="text-input" type="password" placeholder="xoxb-..." autocomplete="off"
                    .value=${this.slackBotTokenDraft}
                    @input=${(e: Event) => { this.slackBotTokenDraft = (e.target as HTMLInputElement).value }}
                  />
                </div>
                <div class="field">
                  <div class="field-top">
                    <div class="field-title">App Token (optional)</div>
                  </div>
                  <div class="field-help">Enables receiving Slack messages in Dune. From: Basic Information → App-Level Tokens</div>
                  <input class="text-input" type="password" placeholder="xapp-..." autocomplete="off"
                    .value=${this.slackAppTokenDraft}
                    @input=${(e: Event) => { this.slackAppTokenDraft = (e.target as HTMLInputElement).value }}
                  />
                </div>
              </div>
              <div class="field-actions">
                <button class="btn primary" type="button"
                  .disabled=${!this.slackBotTokenDraft.trim()}
                  @click=${() => void this.saveSlackCredentials()}
                >Connect</button>
              </div>
            ` : html`
              <div class="field-actions">
                <button class="btn" type="button"
                  @click=${() => void this.handleDisconnectSlack()}
                >Disconnect</button>
                <button class="btn" type="button"
                  @click=${() => void this.loadSlackSettings()}
                >Refresh</button>
              </div>

              ${!this.slackSettings?.hasAppToken ? html`
                <div class="field">
                  <div class="field-top">
                    <div class="field-title">App Token (optional)</div>
                  </div>
                  <div class="field-help">Enables receiving Slack messages in Dune. From: Basic Information → App-Level Tokens</div>
                  <input class="text-input" type="password" placeholder="xapp-..." autocomplete="off"
                    .value=${this.slackAppTokenDraft}
                    @input=${(e: Event) => { this.slackAppTokenDraft = (e.target as HTMLInputElement).value }}
                  />
                  <div class="field-actions">
                    <button class="btn primary" type="button"
                      .disabled=${!this.slackAppTokenDraft.trim()}
                      @click=${() => void this.saveSlackCredentials()}
                    >Save token</button>
                  </div>
                </div>
              ` : nothing}
            `}
          </div>

          ${connected ? html`
            <div class="field">
              <div class="field-title">Channel Links</div>
              <div class="field-help">Link Dune channels to Slack channels for bidirectional messaging.</div>

              ${this.slackLinks.length > 0 ? html`
                ${this.slackLinks.map(link => html`
                  <div class="row">
                    <div class="row-copy">
                      <div class="row-label">${this.duneChannels.find(c => c.id === link.duneChannelId)?.name || link.duneChannelId} ↔ #${link.slackChannelName}</div>
                      <p class="row-sub">${link.direction}</p>
                    </div>
                    <button class="btn" type="button" @click=${() => void this.handleDeleteLink(link.id)}>Unlink</button>
                  </div>
                `)}
              ` : nothing}

              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select class="text-input" style="flex:1;min-width:120px;"
                  .value=${this.slackLinkDuneChannelId}
                  @change=${(e: Event) => { this.slackLinkDuneChannelId = (e.target as HTMLSelectElement).value }}
                >
                  <option value="">Dune channel...</option>
                  ${this.duneChannels.map(ch => html`<option value=${ch.id}>${ch.name}</option>`)}
                </select>
                <select class="text-input" style="flex:1;min-width:120px;"
                  .value=${this.slackLinkSlackChannelId}
                  @change=${(e: Event) => { this.slackLinkSlackChannelId = (e.target as HTMLSelectElement).value }}
                >
                  <option value="">Slack channel...</option>
                  ${this.slackRemoteChannels.map(ch => html`<option value=${ch.id}>#${ch.name}</option>`)}
                </select>
                <button class="btn primary" type="button"
                  .disabled=${!this.slackLinkDuneChannelId || !this.slackLinkSlackChannelId}
                  @click=${() => void this.handleCreateLink()}
                >Link</button>
              </div>
            </div>
          ` : nothing}

          ${this.slackLoading ? html`<div class="feedback">Loading Slack settings...</div>` : nothing}
          ${this.slackStatusMessage ? html`
            <div class="feedback ${this.slackStatusTone === 'success' ? 'success' : ''} ${this.slackStatusTone === 'error' ? 'error' : ''}">
              ${this.slackStatusMessage}
            </div>
          ` : nothing}
        </div>
      </section>
    `
  }
}
