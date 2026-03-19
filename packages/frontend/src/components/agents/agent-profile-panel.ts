import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, query as queryEl, state as litState } from 'lit/decorators.js'
import type { Agent, Channel, AgentLogEntry } from '@dune/shared'
import * as api from '../../services/rpc.js'
import { uiPreferences } from '../../state/ui-preferences.js'
import './agent-todo-panel.js'
import './agent-log-viewer.js'

const STATUS_LABELS: Record<string, string> = {
  idle: 'Active',
  starting: 'Starting...',
  thinking: 'Thinking...',
  responding: 'Responding...',
  error: 'Error',
  stopping: 'Saving memories...',
  stopped: 'Stopped',
}

const AVATAR_COLORS = ['#0f9a90', '#0ea5e9', '#3b82f6', '#6d28d9', '#ef4444', '#f97316', '#10b981', '#64748b']
const LOG_WRAP_MODE_STORAGE_KEY = 'dune.ui.agentLogs.wrapMode'
const DEFAULT_INSPECTOR_WIDTH_PX = 520
const INSPECTOR_MIN_WIDTH_PX = 360
const INSPECTOR_MAX_WIDTH_PX = 760
const INSPECTOR_VIEWPORT_GUTTER_PX = 24
const INSPECTOR_RESIZE_STEP_PX = 16
const INSPECTOR_RESIZE_STEP_FAST_PX = 32
const INSPECTOR_RESIZE_DESKTOP_QUERY = '(min-width: 761px)'

type SkillInfo = { name: string; description: string; preview: string; scripts: string[]; markdown: string }

@customElement('agent-profile-panel')
export class AgentProfilePanel extends LitElement {
  @property({ type: Object }) agent: Agent | null = null
  @property({ type: Array }) channels: Channel[] = []
  @property({ type: Object }) screen: { guiHttpPort: number; guiHttpsPort: number } | null = null
  @property({ type: Array }) logs: AgentLogEntry[] = []
  @property({ type: Boolean }) logsLoading = false
  @property({ type: Boolean }) logsLoadingOlder = false
  @property({ type: Boolean }) logsHasMore = false
  @litState() private subscriptions: string[] = []
  @litState() private activeTab: 'profile' | 'todos' | 'skills' | 'logs' | 'computer' = 'profile'
  @litState() private expanded = false
  @litState() private logsAutoFollow = true
  @litState() private logsWrapMode: 'nowrap' | 'wrap' = 'nowrap'
  @litState() private inspectorWidthPx = DEFAULT_INSPECTOR_WIDTH_PX
  @litState() private inspectorResizeActive = false
  @queryEl('.tab-content') private tabContentEl?: HTMLElement
  private pendingLogsPrependAnchor: { scrollTop: number; scrollHeight: number; firstEntryId: string | null } | null = null

  // Editable fields
  @litState() private editingName = false
  @litState() private editName = ''
  @litState() private editPersonality = ''
  @litState() private personalityDirty = false
  @litState() private editColor = ''
  @litState() private editRole: Agent['role'] = 'follower'
  @litState() private editWorkMode: Agent['workMode'] = 'normal'
  @litState() private editModelIdOverride: Agent['modelIdOverride'] = null
  @litState() private saving = false

  // Skills tab
  @litState() private skills: SkillInfo[] = []
  @litState() private skillsLoaded = false
  @litState() private expandedSkillDocs = new Set<string>()

  // System prompt viewer
  @litState() private showSystemPrompt = false
  @litState() private systemPrompt = ''
  @litState() private systemPromptLoading = false
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
      width: min(520px, 42vw);
      height: 100%;
      max-height: none;
      background: var(--sheet-bg);
      border: 1px solid var(--border-color);
      border-radius: 30px 0 0 30px;
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 0.25s ease, height 0.25s ease, max-width 0.25s ease, max-height 0.25s ease, border-radius 0.2s ease;
    }

    .modal.resize-active {
      transition: height 0.25s ease, max-width 0.25s ease, max-height 0.25s ease, border-radius 0.2s ease;
    }

    .modal.computer {
      height: 85vh;
      width: min(94vw, calc((85vh - 120px) * 4 / 3 + 52px));
      border-radius: 28px;
      margin: auto 12px auto auto;
      align-self: center;
    }

    .modal.fullscreen {
      height: 100vh;
      width: min(100vw, calc((100vh - 100px) * 4 / 3 + 48px));
      max-width: 100vw;
      max-height: 100vh;
      border-radius: 0;
    }

    /* System prompt overlay */
    .modal.prompt-view {
      width: min(800px, 92vw);
      height: 85vh;
      border-radius: 28px;
      margin: auto 12px auto auto;
      align-self: center;
    }

    .modal-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 18px 18px 12px;
      transition: padding 0.25s ease;
    }

    .modal.computer .modal-header {
      padding: 10px 12px 9px;
      gap: 12px;
    }

    .avatar {
      width: 64px;
      height: 64px;
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 30px;
      font-weight: 600;
      color: white;
      flex-shrink: 0;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
      transition: width 0.25s ease, height 0.25s ease, font-size 0.25s ease, border-radius 0.2s ease;
      cursor: pointer;
      position: relative;
    }

    .modal.computer .avatar {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      font-size: 18px;
    }

    .color-picker {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }

    .role-picker {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 6px;
    }

    .role-option {
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color, #334155);
      background: var(--bg-elevated);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
    }

    .role-option.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
    }

    .role-option-title {
      font-size: 13px;
      font-weight: 600;
    }

    .role-option-copy {
      margin-top: 4px;
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .color-swatch {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all var(--transition-fast);
      padding: 0;
      background: none;
    }

    .color-swatch:hover {
      transform: scale(1.15);
    }

    .color-swatch.selected {
      border-color: white;
      box-shadow: 0 0 0 2px var(--accent);
    }

    .header-info {
      flex: 1;
      min-width: 0;
    }
    .agent-name {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: font-size 0.25s ease;
      cursor: pointer;
    }

    .agent-name:hover {
      color: var(--accent);
    }

    .name-input {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      background: var(--bg-surface);
      border: 1px solid var(--accent);
      border-radius: var(--radius-sm);
      padding: 2px 6px;
      width: 100%;
      outline: none;
    }

    .modal.computer .agent-name {
      font-size: 15px;
    }
    .agent-status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .modal.computer .agent-status {
      margin-top: 2px;
      font-size: 12px;
    }

    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }

    .status-idle { background: var(--success); }

    .status-starting {
      background: var(--accent);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .status-thinking,
    .status-responding {
      background: var(--warning);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .status-error { background: var(--error); }
    .status-stopped { background: var(--text-muted); opacity: 0.5; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .header-buttons {
      display: flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
    }

    .close-btn,
    .expand-btn {
      width: 30px;
      height: 30px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast);
    }

    .close-btn:hover,
    .expand-btn:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .close-btn svg,
    .expand-btn svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .actions-row {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      transition: all 0.25s ease;
    }

    .modal.computer .actions-row {
      display: none;
    }

    .action-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-surface);
      border: none;
      border-radius: var(--radius-sm);
      padding: 6px 11px;
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

    .action-btn.primary {
      background: var(--accent);
      color: white;
    }

    .action-btn.primary:hover {
      opacity: 0.9;
    }

    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .action-icon {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .tab-bar {
      display: flex;
      padding: 0 12px;
      gap: 2px;
    }

    .tab {
      background: none;
      border: none;
      border-bottom: none;
      padding: 9px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .tab:hover {
      color: var(--text-primary);
    }

    .tab.active {
      background: var(--bg-hover);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
    }

    .tab-content {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      padding-top: 4px;
    }

    .logs-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .logs-actions-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .logs-wrap-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--bg-elevated) 65%, #0b1220);
    }

    .logs-wrap-btn {
      border: none;
      border-radius: calc(var(--radius-sm) - 2px);
      padding: 4px 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      background: transparent;
      cursor: pointer;
    }

    .logs-wrap-btn:hover {
      color: var(--text-primary);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }

    .logs-wrap-btn.active {
      color: #dbeafe;
      background: color-mix(in srgb, #0b1220 64%, var(--accent));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent);
    }

    .logs-meta {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .jump-latest-wrap {
      position: sticky;
      bottom: 12px;
      margin: 0 12px 10px;
      display: flex;
      justify-content: flex-end;
      pointer-events: none;
      z-index: 1;
    }

    .jump-latest-btn {
      pointer-events: auto;
      border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
      border-radius: 999px;
      padding: 6px 10px;
      background: color-mix(in srgb, #0b1220 70%, var(--accent));
      color: #dbeafe;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-mono);
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(2, 6, 23, 0.35);
    }

    .jump-latest-btn:hover {
      background: color-mix(in srgb, #172554 65%, var(--accent));
    }

    .section-card {
      margin: 8px 12px;
      border-radius: var(--radius);
      padding: 11px;
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
      line-height: 1.55;
      margin: 0;
    }

    .personality-textarea {
      width: 100%;
      min-height: 80px;
      resize: vertical;
      font-size: 14px;
      font-family: inherit;
      color: var(--text-primary);
      background: var(--bg-elevated);
      border: 1px solid var(--border-color, #334155);
      border-radius: var(--radius-sm);
      padding: 8px;
      line-height: 1.55;
      outline: none;
      box-sizing: border-box;
    }

    .personality-textarea:focus {
      border-color: var(--accent);
    }

    .save-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }

    .channel-item {
      font-size: 13px;
      color: var(--text-secondary);
      padding: 3px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .channel-remove-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 4px;
      font-size: 11px;
      border-radius: var(--radius-sm);
    }

    .channel-remove-btn:hover {
      color: var(--error);
      background: color-mix(in srgb, var(--error) 8%, transparent);
    }

    .empty {
      font-size: 13px;
      color: var(--text-muted);
      font-style: italic;
      margin: 0;
    }

    /* Skills tab */
    .skill-card {
      margin: 8px 12px;
      border-radius: var(--radius);
      padding: 11px;
      background: var(--bg-surface);
    }

    .skill-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }

    .skill-desc {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.4;
      margin-bottom: 6px;
    }

    .skill-preview {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 8px;
    }

    .skill-scripts {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }

    .script-tag {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-elevated);
      padding: 2px 7px;
      border-radius: 10px;
      font-family: monospace;
    }

    .skill-info-banner {
      margin: 8px 12px;
      padding: 8px 11px;
      background: color-mix(in srgb, var(--accent) 8%, transparent);
      border-radius: var(--radius-sm);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .skill-viewer-btn {
      border: none;
      background: var(--bg-elevated);
      color: var(--text-primary);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .skill-viewer-btn:hover {
      background: var(--bg-hover);
    }

    .skill-markdown {
      margin-top: 8px;
      max-height: 220px;
      overflow: auto;
      background: var(--bg-elevated);
      border-radius: var(--radius-sm);
      padding: 10px;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* System prompt modal */
    .prompt-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-elevated);
      display: flex;
      flex-direction: column;
      z-index: 10;
    }

    .prompt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--bg-surface);
    }

    .prompt-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .prompt-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
    }

    .prompt-text {
      font-size: 13px;
      font-family: monospace;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
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
        width: min(620px, 92vw);
        height: auto;
        max-height: 88vh;
        border-radius: 24px;
      }

      .modal-header {
        padding: 14px 14px 12px;
      }

      .actions-row {
        padding: 10px;
      }

      .tab-bar {
        padding: 0 10px;
      }

      .section-card,
      .skill-card {
        margin-left: 10px;
        margin-right: 10px;
      }
    }
  `

  connectedCallback() {
    super.connectedCallback()
    this._keyHandler = this.handleKeydown.bind(this)
    document.addEventListener('keydown', this._keyHandler)
    this.logsWrapMode = this.readLogsWrapMode()
    this.inspectorWidthPx = this.clampInspectorWidth(uiPreferences.getInspectorWidth() ?? DEFAULT_INSPECTOR_WIDTH_PX)
    uiPreferences.addEventListener('change', this.uiPreferenceChangeHandler)
    window.addEventListener('resize', this.windowResizeHandler)
  }

  disconnectedCallback() {
    this.finishInspectorResize()
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler)
    }
    uiPreferences.removeEventListener('change', this.uiPreferenceChangeHandler)
    window.removeEventListener('resize', this.windowResizeHandler)
    super.disconnectedCallback()
  }

  private _keyHandler: ((e: KeyboardEvent) => void) | null = null

  private readLogsWrapMode(): 'nowrap' | 'wrap' {
    if (typeof window === 'undefined') return 'nowrap'
    try {
      const value = window.localStorage.getItem(LOG_WRAP_MODE_STORAGE_KEY)
      return value === 'wrap' ? 'wrap' : 'nowrap'
    } catch {
      return 'nowrap'
    }
  }

  private writeLogsWrapMode(mode: 'nowrap' | 'wrap') {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LOG_WRAP_MODE_STORAGE_KEY, mode)
    } catch {
      // Ignore storage failures.
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('agent') && this.agent) {
      this.activeTab = 'profile'
      this.expanded = false
      this.logsAutoFollow = true
      this.editingName = false
      this.editPersonality = this.agent.personality
      this.editColor = this.agent.avatarColor
      this.editRole = this.agent.role
      this.editWorkMode = this.agent.workMode
      this.editModelIdOverride = this.agent.modelIdOverride
      this.personalityDirty = false
      this.showSystemPrompt = false
      this.skillsLoaded = false
      this.expandedSkillDocs = new Set<string>()
      this.loadSubscriptions()
    }

    if ((changed.has('activeTab') || changed.has('showSystemPrompt')) && this.inspectorResizeActive && !this.isResizableInspectorLayout()) {
      this.finishInspectorResize()
    }

    if (changed.has('logsLoadingOlder') && !this.logsLoadingOlder && !changed.has('logs')) {
      this.pendingLogsPrependAnchor = null
    }

    if ((changed.has('activeTab') || changed.has('logs')) && this.activeTab === 'logs') {
      this.updateComplete.then(() => {
        const container = this.tabContentEl
        if (!container) return
        if (changed.has('activeTab')) {
          container.scrollTop = container.scrollHeight
          this.logsAutoFollow = true
          return
        }

        if (changed.has('logs') && this.pendingLogsPrependAnchor) {
          const firstEntryId = this.logs[0]?.id ?? null
          const didPrepend = firstEntryId !== this.pendingLogsPrependAnchor.firstEntryId
          if (didPrepend) {
            const delta = container.scrollHeight - this.pendingLogsPrependAnchor.scrollHeight
            container.scrollTop = this.pendingLogsPrependAnchor.scrollTop + Math.max(0, delta)
            this.pendingLogsPrependAnchor = null
            this.handleTabContentScroll()
            return
          }
        }

        if (this.logsAutoFollow) {
          container.scrollTop = container.scrollHeight
        }
      })
    }
  }

  private async loadSubscriptions() {
    if (!this.agent) return
    try {
      this.subscriptions = await api.getAgentSubscriptions(this.agent.id)
    } catch {
      this.subscriptions = []
    }
  }

  private async loadSkills() {
    if (!this.agent || this.skillsLoaded) return
    try {
      this.skills = await api.getAgentSkills(this.agent.id)
    } catch {
      this.skills = []
    } finally {
      this.skillsLoaded = true
    }
  }

  private handleToggle() {
    if (!this.agent) return
    this.dispatchEvent(new CustomEvent('toggle-agent', {
      detail: this.agent.id, bubbles: true, composed: true,
    }))
  }

  private handleDelete() {
    if (!this.agent) return
    if (!confirm(`Delete agent "${this.agent.name}"? This cannot be undone.`)) return
    this.dispatchEvent(new CustomEvent('delete-agent', {
      detail: this.agent.id, bubbles: true, composed: true,
    }))
  }

  private handleTabSwitch(tab: 'profile' | 'todos' | 'skills' | 'logs' | 'computer') {
    if (tab !== 'computer') {
      this.expanded = false
    }
    this.activeTab = tab
    if (tab === 'computer' && this.agent) {
      this.dispatchEvent(new CustomEvent('load-agent-screen', {
        detail: this.agent.id, bubbles: true, composed: true,
      }))
    }
    if (tab === 'skills') {
      this.loadSkills()
    }
  }

  private handleTabContentScroll() {
    if (this.activeTab !== 'logs') return
    const container = this.tabContentEl
    if (!container) return
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    this.logsAutoFollow = distanceToBottom <= 48
  }

  private handleClose() {
    this.expanded = false
    this.showSystemPrompt = false
    this.dispatchEvent(new CustomEvent('close-profile', {
      bubbles: true, composed: true,
    }))
  }

  private handleBackdropClick(e: Event) {
    if ((e.target as HTMLElement).classList.contains('backdrop')) {
      this.handleClose()
    }
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.showSystemPrompt) {
        this.showSystemPrompt = false
      } else if (this.expanded) {
        this.expanded = false
      } else {
        this.handleClose()
      }
    }
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
    return window.matchMedia(INSPECTOR_RESIZE_DESKTOP_QUERY).matches && !this.showSystemPrompt && this.activeTab !== 'computer'
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

  private toggleExpand() {
    this.expanded = !this.expanded
  }

  // ── Editing handlers ──────────────────────────────────────────────

  private startEditName() {
    if (!this.agent) return
    this.editName = this.agent.name
    this.editingName = true
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.name-input') as HTMLInputElement
      input?.focus()
      input?.select()
    })
  }

  private async saveName() {
    if (!this.agent || !this.editName.trim()) return
    this.editingName = false
    if (this.editName.trim() !== this.agent.name) {
      await this.saveField({ name: this.editName.trim() })
    }
  }

  private handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.saveName()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      this.editingName = false
    }
  }

  private handlePersonalityInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement
    this.editPersonality = textarea.value
    this.personalityDirty = this.editPersonality !== this.agent?.personality
  }

  private async savePersonality() {
    if (!this.agent || !this.personalityDirty) return
    await this.saveField({ personality: this.editPersonality })
    this.personalityDirty = false
  }

  private async selectColor(color: string) {
    if (!this.agent || color === this.editColor) return
    this.editColor = color
    await this.saveField({ avatarColor: color })
  }

  private async selectRole(role: Agent['role']) {
    if (!this.agent || role === this.editRole) return
    this.editRole = role
    await this.saveField({ role })
  }

  private async selectWorkMode(workMode: Agent['workMode']) {
    if (!this.agent || workMode === this.editWorkMode) return
    this.editWorkMode = workMode
    await this.saveField({ workMode })
  }

  private async selectModelIdOverride(modelIdOverride: Agent['modelIdOverride']) {
    if (!this.agent || modelIdOverride === this.editModelIdOverride) return
    this.editModelIdOverride = modelIdOverride
    await this.saveField({ modelIdOverride })
  }

  private formatRoleLabel(role: Agent['role']): string {
    return role === 'leader' ? 'Leader' : 'Follower'
  }

  private formatWorkModeLabel(workMode: Agent['workMode']): string {
    return workMode === 'plan-first' ? 'Plan First' : 'Normal'
  }

  private formatModelOverrideLabel(modelIdOverride: Agent['modelIdOverride']): string {
    return modelIdOverride || 'Workspace default'
  }

  private async saveField(data: Partial<{
    name: string
    personality: string
    role: Agent['role']
    workMode: Agent['workMode']
    modelIdOverride: Agent['modelIdOverride']
    avatarColor: string
  }>) {
    if (!this.agent) return
    this.saving = true
    try {
      const updated = await api.updateAgent(this.agent.id, data)
      // Dispatch event so parent can refresh agent list
      this.dispatchEvent(new CustomEvent('agent-updated', {
        detail: updated, bubbles: true, composed: true,
      }))
    } catch (err) {
      console.error('Failed to update agent:', err)
    } finally {
      this.saving = false
    }
  }

  private async handleViewSystemPrompt() {
    if (!this.agent) return
    this.systemPromptLoading = true
    this.showSystemPrompt = true
    try {
      const result = await api.getAgentSystemPrompt(this.agent.id)
      this.systemPrompt = result.prompt
    } catch {
      this.systemPrompt = '(Failed to load system prompt)'
    } finally {
      this.systemPromptLoading = false
    }
  }

  private async handleUnsubscribe(channelId: string) {
    if (!this.agent) return
    try {
      await api.unsubscribeAgentFromChannel(channelId, this.agent.id)
      this.subscriptions = this.subscriptions.filter(id => id !== channelId)
    } catch (err) {
      console.error('Failed to unsubscribe:', err)
    }
  }

  private formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  }

  private getModalClass(): string {
    const classes = ['modal']
    if (this.showSystemPrompt) {
      classes.push('prompt-view')
    } else if (this.activeTab === 'computer') {
      classes.push('computer')
      if (this.expanded) classes.push('fullscreen')
    }
    return classes.join(' ')
  }

  private renderProfileTab() {
    const a = this.agent!
    const channelNames = this.subscriptions
      .map(id => {
        const ch = this.channels.find(c => c.id === id)
        return ch ? { id, name: ch.name } : null
      })
      .filter(Boolean) as Array<{ id: string; name: string }>

    return html`
      <div class="section-card">
        <div class="section-title">Role</div>
        <div class="role-picker">
          ${[
            { id: 'leader', title: 'Leader', copy: 'Plans next steps and keeps nextPlan current.' },
            { id: 'follower', title: 'Follower', copy: 'Preserves the original request and tracks progress.' },
          ].map(role => html`
            <button
              class="role-option ${role.id === this.editRole ? 'selected' : ''}"
              @click=${() => this.selectRole(role.id as Agent['role'])}
              ?disabled=${this.saving}
            >
              <div class="role-option-title">${role.title}</div>
              <div class="role-option-copy">${role.copy}</div>
            </button>
          `)}
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">Work Mode</div>
        <div class="role-picker">
          ${[
            { id: 'plan-first', title: 'Plan First', copy: 'Inspect the state and build a concrete plan before multi-step work.' },
            { id: 'normal', title: 'Normal', copy: 'Act directly once enough context has been gathered.' },
          ].map(mode => html`
            <button
              class="role-option ${mode.id === this.editWorkMode ? 'selected' : ''}"
              @click=${() => this.selectWorkMode(mode.id as Agent['workMode'])}
              ?disabled=${this.saving}
            >
              <div class="role-option-title">${mode.title}</div>
              <div class="role-option-copy">${mode.copy}</div>
            </button>
          `)}
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">Claude Model</div>
        <div class="role-picker">
          ${[
            { id: null, title: 'Inherit', copy: 'Use the workspace default Claude model.' },
            { id: 'opus', title: 'Opus', copy: 'Use the Opus alias for this agent.' },
            { id: 'sonnet', title: 'Sonnet', copy: 'Use the Sonnet alias for this agent.' },
            { id: 'haiku', title: 'Haiku', copy: 'Use the Haiku alias for this agent.' },
          ].map(model => html`
            <button
              class="role-option ${model.id === this.editModelIdOverride ? 'selected' : ''}"
              @click=${() => this.selectModelIdOverride(model.id as Agent['modelIdOverride'])}
              ?disabled=${this.saving}
            >
              <div class="role-option-title">${model.title}</div>
              <div class="role-option-copy">${model.copy}</div>
            </button>
          `)}
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">Avatar Color</div>
        <div class="color-picker">
          ${AVATAR_COLORS.map(c => html`
            <button
              class="color-swatch ${c === this.editColor ? 'selected' : ''}"
              style="background: ${c}"
              @click=${() => this.selectColor(c)}
            ></button>
          `)}
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">Personality</div>
        <textarea
          class="personality-textarea"
          .value=${this.editPersonality}
          @input=${this.handlePersonalityInput}
        ></textarea>
        ${this.personalityDirty ? html`
          <div class="save-row">
            <button class="action-btn" @click=${() => { this.editPersonality = a.personality; this.personalityDirty = false }}>Cancel</button>
            <button class="action-btn primary" @click=${this.savePersonality} ?disabled=${this.saving}>Save</button>
          </div>
        ` : nothing}
      </div>

      <div class="section-card">
        <div class="section-title">Created</div>
        <p class="section-content">${this.formatDate(a.createdAt)}</p>
      </div>

      <div class="section-card">
        <div class="section-title">Current Role</div>
        <p class="section-content">${this.formatRoleLabel(a.role)}</p>
      </div>

      <div class="section-card">
        <div class="section-title">Current Work Mode</div>
        <p class="section-content">${this.formatWorkModeLabel(a.workMode)}</p>
      </div>

      <div class="section-card">
        <div class="section-title">Current Claude Model</div>
        <p class="section-content">${this.formatModelOverrideLabel(a.modelIdOverride)}</p>
      </div>

      <div class="section-card">
        <div class="section-title">Channels</div>
        ${channelNames.length > 0
          ? channelNames.map(ch => html`
            <div class="channel-item">
              <span># ${ch.name}</span>
              <button class="channel-remove-btn" @click=${() => this.handleUnsubscribe(ch.id)} title="Unsubscribe">✕</button>
            </div>
          `)
          : html`<p class="empty">No channels</p>`
        }
      </div>

      <div class="section-card">
        <button class="action-btn" @click=${this.handleViewSystemPrompt}>
          <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M14 2v6h6M16 13H8m8 4H8m2-8H8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          <span>View System Prompt</span>
        </button>
      </div>
    `
  }

  private renderSkillsTab() {
    if (!this.skillsLoaded) {
      return html`<div class="section-card"><p class="empty">Loading skills...</p></div>`
    }

    if (this.skills.length === 0) {
      return html`<div class="section-card"><p class="empty">No skills available.</p></div>`
    }

    return html`
      <div class="skill-info-banner">
        All skills are shared across agents. Skills provide communication, sandbox, miniapp, and team management capabilities.
      </div>
      ${this.skills.map(skill => html`
        <div class="skill-card">
          <div class="skill-name">${skill.name}</div>
          ${skill.description ? html`<div class="skill-desc">${skill.description}</div>` : nothing}
          <div class="skill-preview">${skill.preview || skill.description || 'No preview available.'}</div>
          ${skill.scripts.length > 0 ? html`
            <div class="skill-scripts">
              ${skill.scripts.map(s => html`<span class="script-tag">${s}</span>`)}
            </div>
          ` : nothing}
          <button class="skill-viewer-btn" @click=${() => this.toggleSkillDoc(skill.name)}>
            ${this.expandedSkillDocs.has(skill.name) ? 'Hide SKILL.md' : 'View SKILL.md'}
          </button>
          ${this.expandedSkillDocs.has(skill.name)
            ? html`<pre class="skill-markdown">${skill.markdown || '(SKILL.md not found)'}</pre>`
            : nothing}
        </div>
      `)}
    `
  }

  private toggleSkillDoc(skillName: string) {
    const next = new Set(this.expandedSkillDocs)
    if (next.has(skillName)) {
      next.delete(skillName)
    } else {
      next.add(skillName)
    }
    this.expandedSkillDocs = next
  }

  private handleLoadOlderLogs() {
    if (!this.agent || this.logsLoadingOlder || !this.logsHasMore) return
    const container = this.tabContentEl
    if (container) {
      this.pendingLogsPrependAnchor = {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        firstEntryId: this.logs[0]?.id ?? null,
      }
    }
    this.dispatchEvent(new CustomEvent('load-agent-logs-older', {
      detail: this.agent.id,
      bubbles: true,
      composed: true,
    }))
  }

  private handleJumpToLatest() {
    const container = this.tabContentEl
    if (!container) return
    container.scrollTop = container.scrollHeight
    this.logsAutoFollow = true
  }

  private setLogsWrapMode(mode: 'nowrap' | 'wrap') {
    if (this.logsWrapMode === mode) return
    this.logsWrapMode = mode
    this.writeLogsWrapMode(mode)
  }

  private renderLogsTab() {
    if (this.logsLoading && this.logs.length === 0) {
      return html`<div class="section-card"><p class="empty">Loading logs...</p></div>`
    }

    return html`
      <div class="section-card logs-actions">
        <div class="logs-actions-left">
          <button class="action-btn" @click=${this.handleLoadOlderLogs} ?disabled=${!this.logsHasMore || this.logsLoadingOlder}>
            ${this.logsLoadingOlder ? 'Loading older logs...' : this.logsHasMore ? 'Load older logs' : 'All logs loaded'}
          </button>
          <div class="logs-wrap-toggle" role="group" aria-label="Log wrapping mode">
            <button
              class="logs-wrap-btn ${this.logsWrapMode === 'nowrap' ? 'active' : ''}"
              @click=${() => this.setLogsWrapMode('nowrap')}
            >No-wrap</button>
            <button
              class="logs-wrap-btn ${this.logsWrapMode === 'wrap' ? 'active' : ''}"
              @click=${() => this.setLogsWrapMode('wrap')}
            >Wrap</button>
          </div>
        </div>
        <span class="logs-meta">${this.logs.length} entries</span>
      </div>
      <agent-log-viewer .entries=${this.logs} .wrapLines=${this.logsWrapMode === 'wrap'}></agent-log-viewer>
      ${!this.logsAutoFollow && this.logs.length > 0 ? html`
        <div class="jump-latest-wrap">
          <button class="jump-latest-btn" @click=${this.handleJumpToLatest}>
            Jump to latest
          </button>
        </div>
      ` : nothing}
    `
  }

  private renderSystemPromptOverlay() {
    return html`
      <div class="prompt-overlay">
        <div class="prompt-header">
          <span class="prompt-title">System Prompt</span>
          <button class="close-btn" @click=${() => { this.showSystemPrompt = false }}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
        <div class="prompt-body">
          ${this.systemPromptLoading
            ? html`<p class="empty">Loading...</p>`
            : html`<pre class="prompt-text">${this.systemPrompt}</pre>`
          }
        </div>
      </div>
    `
  }

  render() {
    const a = this.agent
    if (!a) return html``

    const initial = a.name.charAt(0).toUpperCase()
    const statusLabel = STATUS_LABELS[a.status] || a.status
    const isStopped = a.status === 'stopped'
    const displayColor = this.editColor || a.avatarColor
    const inspectorResizable = this.isResizableInspectorLayout()
    const inspectorWidth = this.clampInspectorWidth(this.inspectorWidthPx)
    const inspectorWidthMax = this.getInspectorWidthEffectiveMax()
    const modalClass = [this.getModalClass(), this.inspectorResizeActive ? 'resize-active' : ''].filter(Boolean).join(' ')
    const modalStyle = inspectorResizable ? `width:${inspectorWidth}px;` : ''
    const modalContent = this.showSystemPrompt ? this.renderSystemPromptOverlay() : html`
      <div class="modal-header">
        <div class="avatar" style="background: ${displayColor}">${initial}</div>
        <div class="header-info">
          ${this.editingName ? html`
            <input
              class="name-input"
              .value=${this.editName}
              @input=${(e: Event) => { this.editName = (e.target as HTMLInputElement).value }}
              @keydown=${this.handleNameKeydown}
              @blur=${this.saveName}
            />
          ` : html`
            <div class="agent-name" @click=${this.startEditName} title="Click to edit name">${a.name}</div>
          `}
          <div class="agent-status">
            <span class="status-dot status-${a.status}"></span>
            <span>${statusLabel}</span>
          </div>
        </div>
        <div class="header-buttons">
          ${this.activeTab === 'computer' ? html`
            <button class="expand-btn" @click=${this.toggleExpand} title=${this.expanded ? 'Exit fullscreen' : 'Fullscreen'}>
              ${this.expanded
                ? html`
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 9H4V4m11 5h5V4M9 15H4v5m11-5h5v5" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                `
                : html`
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                `}
            </button>
          ` : ''}
          <button class="close-btn" @click=${this.handleClose} aria-label="Close agent profile">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="actions-row">
        <button class="action-btn" @click=${this.handleToggle}>
          ${isStopped
            ? html`
              <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6v12l10-6-10-6Z" stroke-linejoin="round"></path>
              </svg>
            `
            : html`
              <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 7h3v10H8zm5 0h3v10h-3z" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            `}
          <span>${isStopped ? 'Start' : 'Stop'}</span>
        </button>
        <button class="action-btn danger" @click=${this.handleDelete}>
          <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M10 11v6m4-6v6M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 .92h8a1 1 0 0 0 1-.92L20 7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          <span>Delete</span>
        </button>
      </div>

      <div class="tab-bar">
        <button class="tab ${this.activeTab === 'profile' ? 'active' : ''}" @click=${() => this.handleTabSwitch('profile')}>Profile</button>
        <button class="tab ${this.activeTab === 'todos' ? 'active' : ''}" @click=${() => this.handleTabSwitch('todos')}>Todos</button>
        <button class="tab ${this.activeTab === 'skills' ? 'active' : ''}" @click=${() => this.handleTabSwitch('skills')}>Skills</button>
        <button class="tab ${this.activeTab === 'logs' ? 'active' : ''}" @click=${() => this.handleTabSwitch('logs')}>Logs</button>
        <button class="tab ${this.activeTab === 'computer' ? 'active' : ''}" @click=${() => this.handleTabSwitch('computer')}>Computer</button>
      </div>

      <div class="tab-content" @scroll=${this.handleTabContentScroll}>
        ${this.activeTab === 'profile' ? this.renderProfileTab()
          : this.activeTab === 'todos' ? html`<div class="section-card"><agent-todo-panel .agentId=${a.id}></agent-todo-panel></div>`
          : this.activeTab === 'skills' ? this.renderSkillsTab()
          : this.activeTab === 'logs' ? this.renderLogsTab()
          : html`
            <agent-computer-tab
              .agentId=${a.id}
              .guiHttpPort=${this.screen?.guiHttpPort || 0}
            ></agent-computer-tab>
          `}
      </div>
    `
    const modal = html`
      <div class=${modalClass} style=${modalStyle} data-testid="agent-profile-modal">
        ${modalContent}
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
              data-testid="agent-profile-resizer"
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
