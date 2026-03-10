import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state as litState, query } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Agent, AgentLogEntry, MemoryFile, SelectedModelProvider } from '@dune/shared'
import * as api from '../../services/api-client.js'
import { uiPreferences } from '../../state/ui-preferences.js'
import '../layout/codex-composer.js'
import type {
  CodexComposer,
  CodexComposerAddAction,
  CodexComposerAddActionDetail,
  CodexComposerKeydownDetail,
} from '../layout/codex-composer.js'
import './agent-mounts-panel.js'

const STATUS_LABELS: Record<string, string> = {
  idle: 'Online',
  starting: 'Starting...',
  thinking: 'Thinking...',
  responding: 'Responding...',
  error: 'Error',
  stopping: 'Saving memories...',
  stopped: 'Offline',
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'var(--success)',
  starting: 'var(--accent)',
  thinking: 'var(--warning)',
  responding: 'var(--warning)',
  error: 'var(--error)',
  stopping: 'var(--accent)',
  stopped: 'var(--text-muted)',
}

const AGENT_COMPOSER_ADD_ACTIONS: CodexComposerAddAction[] = [
  { id: 'mount-local-dir', label: 'Mount local dir' },
]

type MemorySort = 'name' | 'updated' | 'size'
type MemoryPane = 'files' | 'editor'
type HostExecApprovalMode = Agent['hostExecApprovalMode']

const DEFAULT_MEMORY_FILES_WIDTH_PX = 280
const MEMORY_FILES_MIN_WIDTH_PX = 220
const MEMORY_FILES_MAX_WIDTH_PX = 460
const MEMORY_EDITOR_MIN_WIDTH_PX = 320
const MEMORY_SPLITTER_TRACK_PX = 6
const MEMORY_RESIZE_STEP_PX = 16
const MEMORY_RESIZE_STEP_FAST_PX = 32
const MEMORY_MOBILE_BREAKPOINT_PX = 980
const HOST_EXEC_APPROVAL_OPTIONS: Array<{ value: HostExecApprovalMode; label: string }> = [
  { value: 'approval-required', label: 'Require approval' },
  { value: 'dangerously-skip', label: 'Dangerously skip permissions' },
]

type AgentViewSnapshot = {
  memoryOpen: boolean
  memoryPane: MemoryPane
  memoryFilesPaneWidthPx: number
  memoryQuery: string
  memorySort: MemorySort
  memorySelectedPath: string | null
  memoryFileContent: string
  memoryFileOriginal: string
  memoryFiles: MemoryFile[]
  memoryCreating: boolean
  memoryNewFileName: string
  memoryDeleteConfirm: string | null
}

@customElement('agent-chat-view')
export class AgentChatView extends LitElement {
  @property({ type: Object }) agent!: Agent
  @property({ type: Array }) entries: AgentLogEntry[] = []
  @property({ attribute: false }) selectedModelProvider: SelectedModelProvider | null = null
  @litState() private expandedIds = new Set<string>()
  @litState() private sending = false
  @litState() private showModelSelectionPrompt = false
  @litState() private memoryOpen = false
  @litState() private memoryFiles: MemoryFile[] = []
  @litState() private memoryLoading = false
  @litState() private memorySelectedPath: string | null = null
  @litState() private memoryFileContent = ''
  @litState() private memoryFileOriginal = ''
  @litState() private memoryFileLoading = false
  @litState() private memorySaving = false
  @litState() private memoryCreating = false
  @litState() private memoryNewFileName = ''
  @litState() private memoryDeleteConfirm: string | null = null
  @litState() private memoryQuery = ''
  @litState() private memorySort: MemorySort = 'updated'
  @litState() private memoryPane: MemoryPane = 'files'
  @litState() private memoryFilesPaneWidthPx = DEFAULT_MEMORY_FILES_WIDTH_PX
  @litState() private memoryResizeActive = false
  @litState() private mountPopoverOpen = false
  @litState() private hostExecApprovalConfirmOpen = false
  @litState() private hostExecApprovalDraft: HostExecApprovalMode | null = null
  @litState() private hostExecApprovalSaving = false

  @query('.conversation') private scrollContainer!: HTMLElement
  @query('codex-composer') private composerEl!: CodexComposer
  private userScrolledUp = false
  private previousAgentId: string | null = null
  private readonly viewByAgentId = new Map<string, AgentViewSnapshot>()
  private memoryResizePointerId: number | null = null
  private memoryResizeStartX = 0
  private memoryResizeStartWidth = DEFAULT_MEMORY_FILES_WIDTH_PX
  private memoryResizeListenersBound = false

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-elevated);
      position: relative;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      border-bottom: none;
      background: var(--bg-primary);
      min-height: var(--header-height);
      gap: 10px;
      flex-shrink: 0;
    }

    .header-main {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
      flex: 1;
    }
    .header-avatar {
      width: var(--control-height);
      height: var(--control-height);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      color: white;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform var(--transition-fast), filter var(--transition-fast);
    }
    .header-avatar:hover {
      transform: none;
      filter: brightness(0.96);
    }
    .header-info {
      flex: 1;
      min-width: 0;
    }
    .header-name {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.2;
    }
    .header-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.thinking {
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    /* ── Conversation ── */
    .conversation {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      min-height: 0;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 12px;
      color: var(--text-muted);
    }
    .empty-avatar {
      width: 56px;
      height: 56px;
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 600;
      color: white;
    }
    .empty-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .empty-subtitle {
      font-size: 13px;
      max-width: 360px;
      text-align: center;
      line-height: 1.5;
    }

    /* ── System entries (received, etc.) ── */
    .entry-system {
      display: flex;
      justify-content: center;
      padding: 5px 12px;
    }
    .system-pill {
      background: color-mix(in srgb, var(--bg-hover) 84%, white 16%);
      border-radius: 999px;
      border: none;
      padding: 4px 12px;
      font-size: 12px;
      color: var(--text-muted);
      font-style: italic;
      max-width: 600px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Thinking indicator ── */
    .entry-thinking {
      display: flex;
      gap: 12px;
      padding: 7px 12px;
      max-width: 820px;
    }
    .thinking-dots {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 0;
    }
    .thinking-dots span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: thinking-bounce 1.4s ease-in-out infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes thinking-bounce {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    /* ── Text entries (assistant response) ── */
    .entry-text {
      display: flex;
      gap: 12px;
      padding: 7px 12px;
      max-width: 820px;
    }
    .entry-avatar {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: white;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .entry-text-body {
      flex: 1;
      min-width: 0;
    }
    .entry-text-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 2px;
    }
    .entry-text-content {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-primary);
      word-break: break-word;
    }
    .entry-text-content p { margin: 0 0 8px 0; }
    .entry-text-content p:last-child { margin-bottom: 0; }
    .entry-text-content code {
      background: var(--bg-code);
      color: var(--error);
      padding: 2px 5px;
      border-radius: 4px;
      border: none;
      font-family: var(--font-mono);
      font-size: 13px;
    }
    .entry-text-content pre {
      background: var(--bg-code);
      padding: 14px 16px;
      border-radius: 8px;
      border: none;
      overflow-x: auto;
      margin: 8px 0;
    }
    .entry-text-content pre code {
      background: none;
      border: none;
      color: var(--text-primary);
      padding: 0;
    }

    .chat-app-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      border-radius: 999px;
      background: var(--accent);
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      padding: 3px 10px;
      cursor: pointer;
      transition: background var(--transition-fast), transform var(--transition-fast);
      vertical-align: middle;
      margin: 0 2px;
      line-height: 1.4;
    }
    .chat-app-btn:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }

    /* ── Tool call / Tool result (collapsible cards) ── */
    .entry-tool {
      padding: 4px 12px 4px 48px;
    }
    .tool-card {
      border-radius: var(--radius);
      border: none;
      overflow: hidden;
      max-width: 720px;
      background: var(--bg-surface);
    }
    .tool-card.tool-use {
      background: color-mix(in srgb, var(--warning) 12%, var(--bg-surface));
    }
    .tool-card.tool-result {
      background: color-mix(in srgb, var(--accent-soft) 55%, var(--bg-surface));
    }
    .tool-card.tool-error {
      background: color-mix(in srgb, var(--error) 12%, var(--bg-surface));
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: color-mix(in srgb, var(--bg-hover) 80%, white 20%);
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast);
    }
    .tool-header:hover {
      background: var(--bg-code);
    }
    .tool-chevron {
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.15s;
      flex-shrink: 0;
      width: 12px;
    }
    .tool-chevron.open {
      transform: rotate(90deg);
    }
    .tool-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      color: var(--text-secondary);
    }
    .tool-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-label-type {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 6px;
      border-radius: 3px;
      color: white;
      flex-shrink: 0;
      border-radius: 999px;
    }
    .tool-body {
      padding: 0;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease, padding 0.2s ease;
    }
    .tool-body.open {
      padding: 10px 12px;
      max-height: 400px;
      overflow-y: auto;
    }
    .tool-code {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-all;
    }
    .tool-code.error {
      color: var(--error);
    }

    /* ── Result stats ── */
    .entry-result {
      padding: 5px 12px 5px 48px;
    }
    .result-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 0;
      border-top: none;
      max-width: 720px;
      flex-wrap: wrap;
    }
    .result-stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      border: none;
      border-radius: 999px;
      padding: 4px 9px;
      background: var(--bg-hover);
    }
    .result-label {
      color: var(--text-muted);
    }
    .result-value {
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }

    /* ── Error entries ── */
    .entry-error {
      padding: 5px 12px 5px 48px;
    }
    .error-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: color-mix(in srgb, var(--error) 12%, transparent);
      border: none;
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 13px;
      color: var(--error);
      font-weight: 600;
      max-width: 720px;
    }

    .error-pill svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    /* ── User message (Slack-style, left-aligned) ── */
    .entry-user {
      display: flex;
      gap: 12px;
      padding: 7px 12px;
      max-width: 820px;
    }
    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: white;
      flex-shrink: 0;
      margin-top: 2px;
      background: var(--accent);
    }
    .entry-user-body {
      flex: 1;
      min-width: 0;
    }
    .entry-user-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 2px;
    }
    .entry-user-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .entry-user-time {
      font-size: 11px;
      color: var(--text-muted);
    }
    .entry-user-content {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-primary);
      word-break: break-word;
    }

    /* ── Channel input (inbox card) ── */
    .entry-channel-input {
      padding: 4px 12px;
    }
    .channel-card {
      border-radius: 8px;
      border: none;
      background: color-mix(in srgb, var(--accent-soft) 55%, var(--bg-surface));
      overflow: hidden;
      max-width: 720px;
    }
    .channel-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-hover);
      cursor: pointer;
      user-select: none;
      transition: background 0.1s;
    }
    .channel-card-header:hover {
      background: var(--bg-code);
    }
    .channel-card-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    .channel-card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }
    .channel-card-count {
      font-size: 11px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .channel-card-body {
      padding: 0;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease, padding 0.2s ease;
    }
    .channel-card-body.open {
      padding: 8px 12px;
      max-height: 400px;
      overflow-y: auto;
    }
    .channel-msg {
      padding: 3px 0;
      font-size: 13px;
      line-height: 1.4;
    }
    .channel-msg-author {
      font-weight: 600;
      color: var(--text-primary);
    }
    .channel-msg-content {
      color: var(--text-secondary);
    }

    /* ── Unknown entries ── */
    .entry-unknown {
      padding: 4px 12px 4px 48px;
    }
    .unknown-code {
      background: var(--bg-code);
      border: none;
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      max-width: 720px;
      color: var(--text-primary);
    }

    /* ── Input area ── */
    .input-area {
      padding: 4px 0 6px;
      flex-shrink: 0;
      background: var(--bg-primary);
    }

    .input-guard {
      width: var(--composer-main-ratio);
      margin: 0 auto 8px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--warning) 10%, var(--bg-surface));
      color: var(--text-primary);
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .input-guard-copy {
      font-size: var(--text-secondary-size);
      line-height: 1.4;
      color: var(--text-secondary);
    }

    .input-guard-btn {
      border: none;
      border-radius: var(--radius-sm);
      min-height: 30px;
      padding: 0 10px;
      background: var(--bg-hover);
      color: var(--text-primary);
      font-size: var(--text-secondary-size);
      font-weight: 600;
    }

    .composer-shell {
      position: relative;
      width: var(--composer-main-ratio);
      margin-inline: auto;
    }

    .composer-aux-btn {
      border: none;
      border-radius: 999px;
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-meta-size);
      padding: 7px 11px;
      min-height: var(--composer-submit-size);
      line-height: 1;
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
      font-weight: 600;
      white-space: nowrap;
    }

    .composer-aux-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .composer-aux-btn.success {
      color: var(--success);
    }

    .composer-aux-btn.success:hover {
      background: color-mix(in srgb, var(--success) 12%, transparent);
    }

    .composer-aux-btn.danger {
      color: var(--error);
    }

    .composer-aux-btn.danger:hover {
      background: color-mix(in srgb, var(--error) 12%, transparent);
    }

    .composer-aux-select-wrap {
      display: inline-flex;
      align-items: center;
      min-height: var(--composer-submit-size);
    }

    .composer-aux-select {
      border: none;
      border-radius: 999px;
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-meta-size);
      padding: 7px 32px 7px 11px;
      min-height: var(--composer-submit-size);
      line-height: 1;
      cursor: pointer;
      font-weight: 600;
      appearance: none;
      background-image:
        linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
        linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
      background-position:
        calc(100% - 18px) calc(50% - 2px),
        calc(100% - 13px) calc(50% - 2px);
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
      transition: background-color var(--transition-fast), color var(--transition-fast);
    }

    .composer-aux-select:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }

    .composer-aux-select:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .composer-aux-select:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .host-exec-policy-popover {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 80;
      width: min(360px, 100%);
      border-radius: 16px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-md);
      padding: 14px;
      display: grid;
      gap: 10px;
    }

    .host-exec-policy-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .host-exec-policy-copy {
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-secondary);
    }

    .host-exec-policy-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .host-exec-policy-btn {
      border: none;
      border-radius: 999px;
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      padding: 8px 12px;
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .host-exec-policy-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .host-exec-policy-btn.primary {
      background: color-mix(in srgb, var(--error) 14%, var(--bg-surface));
      color: var(--error);
    }

    .host-exec-policy-btn.primary:hover {
      background: color-mix(in srgb, var(--error) 20%, var(--bg-surface));
    }

    .host-exec-policy-btn:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .mount-popover {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 70;
    }

    /* ── Memory panel ── */
    .memory-overlay {
      position: absolute;
      inset: 0;
      z-index: 100;
      background: var(--bg-primary);
    }

    .memory-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      gap: var(--space-sm);
      padding: 10px 12px;
    }

    .memory-toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      flex-wrap: wrap;
    }

    .memory-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin-right: 4px;
    }

    .memory-toolbar-spacer {
      flex: 1;
      min-width: 0;
    }

    .memory-search {
      flex: 1;
      min-width: 220px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: var(--text-secondary-size);
    }

    .memory-sort {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: var(--text-secondary-size);
    }

    .memory-btn {
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: var(--text-secondary-size);
      padding: 8px 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .memory-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .memory-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .memory-btn.primary {
      background: var(--accent);
      color: #fff;
    }

    .memory-btn.primary:hover {
      background: var(--accent-hover);
      color: #fff;
    }

    .memory-pane-toggle {
      display: none;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
    }

    .memory-pane-btn {
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      padding: 5px 9px;
      cursor: pointer;
    }

    .memory-pane-btn.active {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .memory-content {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(220px, var(--memory-files-width, 280px)) 6px minmax(320px, 1fr);
      gap: 0;
    }

    .memory-files-pane,
    .memory-editor-pane {
      background: var(--bg-surface);
      border-radius: var(--radius);
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .memory-pane-head {
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-shrink: 0;
    }

    .memory-files-head {
      align-items: flex-start;
      justify-content: flex-start;
      flex-direction: column;
      gap: 2px;
    }

    .memory-resizer {
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

    .memory-resizer::before {
      content: '';
      width: 2px;
      height: 38px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--border-primary) 72%, transparent);
      transition: background var(--transition-fast), height var(--transition-fast);
    }

    .memory-resizer:hover::before,
    .memory-resizer.active::before {
      background: color-mix(in srgb, var(--accent) 55%, var(--border-primary));
      height: 48px;
    }

    .memory-resizer:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .memory-pane-label {
      font-size: var(--text-meta-size);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .memory-pane-meta {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
    }

    .memory-new-file {
      padding: 0 12px 10px;
    }

    .memory-new-input {
      width: 100%;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
      box-sizing: border-box;
    }

    .memory-new-input:focus {
      box-shadow: 0 0 0 2px var(--focus-ring);
    }

    .memory-file-table {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      padding: 0 12px 12px;
    }

    .memory-file-table-head,
    .memory-file-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(130px, 0.54fr) minmax(72px, 0.26fr) 28px;
      column-gap: 10px;
      align-items: center;
    }

    .memory-file-table.hide-date .memory-file-table-head,
    .memory-file-table.hide-date .memory-file-row {
      grid-template-columns: minmax(0, 1fr) minmax(60px, 0.24fr) 28px;
    }

    .memory-file-table-head {
      border-top: 1px solid color-mix(in srgb, var(--border-primary) 70%, transparent);
      padding: 9px 8px 7px;
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 600;
      flex-shrink: 0;
    }

    .memory-file-list {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 2px 0 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .memory-file-entry {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .memory-file-row {
      border-radius: var(--radius-sm);
      background: transparent;
      padding: 8px;
      min-height: 34px;
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .memory-file-row:hover {
      background: var(--bg-hover);
    }

    .memory-file-row.active {
      background: var(--bg-hover);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
    }

    .memory-file-row:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .memory-col-name {
      min-width: 0;
      text-align: left;
    }

    .memory-col-date,
    .memory-col-size {
      text-align: right;
      white-space: nowrap;
      color: var(--text-muted);
      font-size: 11px;
    }

    .memory-col-action {
      justify-self: end;
    }

    .memory-file-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .memory-file-date,
    .memory-file-size {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .memory-file-delete {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: var(--radius-xs);
      background: transparent;
      color: var(--text-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
    }

    .memory-file-delete:hover {
      color: var(--error);
      background: color-mix(in srgb, var(--error) 10%, transparent);
    }

    .memory-file-delete:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .memory-file-delete svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }

    .memory-delete-confirm {
      margin: 0 8px 4px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--error) 10%, transparent);
      font-size: 11px;
      color: var(--error);
    }

    .memory-delete-confirm span {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .memory-delete-btn {
      border: none;
      border-radius: 6px;
      background: transparent;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
    }

    .memory-delete-yes {
      color: var(--error);
    }

    .memory-delete-yes:hover {
      color: #fff;
      background: var(--error);
    }

    .memory-delete-no {
      color: var(--text-secondary);
    }

    .memory-delete-no:hover {
      background: var(--bg-hover);
    }

    .memory-editor-head {
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .memory-editor-title-wrap {
      min-width: 0;
      flex: 1;
    }

    .memory-editor-filename {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .memory-editor-path {
      margin-top: 2px;
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .memory-dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      flex-shrink: 0;
    }

    .memory-editor-meta {
      font-size: 11px;
      color: var(--text-muted);
      text-align: right;
      white-space: nowrap;
    }

    .memory-editor-body {
      flex: 1;
      min-height: 0;
      padding: 0 12px 12px;
      display: flex;
    }

    .memory-textarea {
      flex: 1;
      width: 100%;
      min-height: 0;
      resize: none;
      outline: none;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.6;
      font-family: var(--font-mono);
      box-sizing: border-box;
    }

    .memory-textarea:focus {
      box-shadow: 0 0 0 2px var(--focus-ring);
    }

    .memory-search:focus,
    .memory-sort:focus,
    .memory-pane-btn:focus-visible,
    .memory-btn:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .memory-empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 13px;
      padding: 20px;
      text-align: center;
    }

    .memory-empty-icon {
      font-size: 32px;
      opacity: 0.4;
    }

    @media (max-width: 980px) {
      .memory-pane-toggle {
        display: inline-flex;
      }

      .memory-file-table-head,
      .memory-file-row {
        grid-template-columns: minmax(0, 1fr) minmax(118px, 0.52fr) minmax(64px, 0.24fr) 26px;
        column-gap: 8px;
      }

      .memory-content {
        grid-template-columns: minmax(0, 1fr);
      }

      .memory-resizer {
        display: none;
      }

      .memory-files-pane,
      .memory-editor-pane {
        display: none;
      }

      .memory-content.show-files .memory-files-pane {
        display: flex;
      }

      .memory-content.show-editor .memory-editor-pane {
        display: flex;
      }
    }

    @media (max-width: 760px) {
      .input-area {
        padding-bottom: 6px;
      }

      .composer-shell {
        width: calc(100% - 20px);
      }

      .input-guard {
        width: calc(100% - 20px);
      }

      .memory-shell {
        padding: 8px 10px;
      }

      .memory-search {
        min-width: 100%;
      }
    }

  `

  private createDefaultViewSnapshot(): AgentViewSnapshot {
    return {
      memoryOpen: false,
      memoryPane: 'files',
      memoryFilesPaneWidthPx: DEFAULT_MEMORY_FILES_WIDTH_PX,
      memoryQuery: '',
      memorySort: 'updated',
      memorySelectedPath: null,
      memoryFileContent: '',
      memoryFileOriginal: '',
      memoryFiles: [],
      memoryCreating: false,
      memoryNewFileName: '',
      memoryDeleteConfirm: null,
    }
  }

  private captureViewSnapshot(): AgentViewSnapshot {
    return {
      memoryOpen: this.memoryOpen,
      memoryPane: this.memoryPane,
      memoryFilesPaneWidthPx: this.memoryFilesPaneWidthPx,
      memoryQuery: this.memoryQuery,
      memorySort: this.memorySort,
      memorySelectedPath: this.memorySelectedPath,
      memoryFileContent: this.memoryFileContent,
      memoryFileOriginal: this.memoryFileOriginal,
      memoryFiles: [...this.memoryFiles],
      memoryCreating: this.memoryCreating,
      memoryNewFileName: this.memoryNewFileName,
      memoryDeleteConfirm: this.memoryDeleteConfirm,
    }
  }

  private applyViewSnapshot(snapshot: AgentViewSnapshot) {
    const normalizedMemoryOpen = snapshot.memoryOpen
    const normalizedDeleteConfirm = snapshot.memoryDeleteConfirm && snapshot.memoryFiles.some((file) => file.path === snapshot.memoryDeleteConfirm)
      ? snapshot.memoryDeleteConfirm
      : null

    this.memoryOpen = normalizedMemoryOpen
    this.memoryPane = snapshot.memoryPane
    this.memoryFilesPaneWidthPx = this.clampMemoryFilesPaneWidth(snapshot.memoryFilesPaneWidthPx)
    this.memoryQuery = snapshot.memoryQuery
    this.memorySort = snapshot.memorySort
    this.memorySelectedPath = snapshot.memorySelectedPath
    this.memoryFileContent = snapshot.memoryFileContent
    this.memoryFileOriginal = snapshot.memoryFileOriginal
    this.memoryFiles = [...snapshot.memoryFiles]
    this.memoryCreating = snapshot.memoryCreating
    this.memoryNewFileName = snapshot.memoryNewFileName
    this.memoryDeleteConfirm = normalizedDeleteConfirm
    this.memoryLoading = false
    this.memoryFileLoading = false
    this.memorySaving = false
  }

  private persistAgentView(agentId: string) {
    this.viewByAgentId.set(agentId, this.captureViewSnapshot())
  }

  private restoreAgentView(agentId: string) {
    const existing = this.viewByAgentId.get(agentId)
    if (existing) {
      this.applyViewSnapshot(existing)
      return
    }
    const defaults = this.createDefaultViewSnapshot()
    const persistedWidth = uiPreferences.getAgentMemoryPaneWidth(agentId)
    defaults.memoryFilesPaneWidthPx = this.clampMemoryFilesPaneWidth(persistedWidth ?? DEFAULT_MEMORY_FILES_WIDTH_PX)
    this.applyViewSnapshot(defaults)
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('pointerdown', this.handleWindowPointerDown, { capture: true })
  }

  disconnectedCallback() {
    this.finishMemoryResize()
    window.removeEventListener('pointerdown', this.handleWindowPointerDown, { capture: true })
    super.disconnectedCallback()
  }

  private readonly handleWindowPointerDown = (event: PointerEvent) => {
    if (!this.mountPopoverOpen) return
    const mountPopover = this.shadowRoot?.querySelector('.mount-popover')
    if (!mountPopover) {
      this.mountPopoverOpen = false
      return
    }
    const path = event.composedPath()
    if (!path.includes(mountPopover as EventTarget)) this.mountPopoverOpen = false
  }

  private isMemoryDesktopLayout(): boolean {
    return window.matchMedia(`(min-width: ${MEMORY_MOBILE_BREAKPOINT_PX + 1}px)`).matches
  }

  private getMemoryContentWidth(): number | null {
    const content = this.shadowRoot?.querySelector<HTMLElement>('.memory-content')
    if (!content) return null
    return content.getBoundingClientRect().width
  }

  private getMemoryFilesPaneEffectiveMax(containerWidth = this.getMemoryContentWidth()): number {
    if (containerWidth == null || !Number.isFinite(containerWidth)) return MEMORY_FILES_MAX_WIDTH_PX
    const editorBound = Math.floor(containerWidth - MEMORY_EDITOR_MIN_WIDTH_PX - MEMORY_SPLITTER_TRACK_PX)
    return Math.max(MEMORY_FILES_MIN_WIDTH_PX, Math.min(MEMORY_FILES_MAX_WIDTH_PX, editorBound))
  }

  private clampMemoryFilesPaneWidth(width: number, containerWidth = this.getMemoryContentWidth()): number {
    if (!Number.isFinite(width)) return DEFAULT_MEMORY_FILES_WIDTH_PX
    const min = MEMORY_FILES_MIN_WIDTH_PX
    const max = this.getMemoryFilesPaneEffectiveMax(containerWidth)
    if (width < min) return min
    if (width > max) return max
    return Math.round(width)
  }

  private persistMemoryFilesPaneWidth() {
    const nextWidth = this.clampMemoryFilesPaneWidth(this.memoryFilesPaneWidthPx)
    this.memoryFilesPaneWidthPx = nextWidth
    if (!this.agent?.id) return
    uiPreferences.setAgentMemoryPaneWidth(this.agent.id, nextWidth)
    this.persistAgentView(this.agent.id)
  }

  private bindMemoryResizeListeners() {
    if (this.memoryResizeListenersBound) return
    this.memoryResizeListenersBound = true
    window.addEventListener('pointermove', this.handleMemoryResizePointerMove)
    window.addEventListener('pointerup', this.handleMemoryResizePointerEnd)
    window.addEventListener('pointercancel', this.handleMemoryResizePointerEnd)
  }

  private unbindMemoryResizeListeners() {
    if (!this.memoryResizeListenersBound) return
    this.memoryResizeListenersBound = false
    window.removeEventListener('pointermove', this.handleMemoryResizePointerMove)
    window.removeEventListener('pointerup', this.handleMemoryResizePointerEnd)
    window.removeEventListener('pointercancel', this.handleMemoryResizePointerEnd)
  }

  private finishMemoryResize() {
    const wasActive = this.memoryResizeActive
    this.memoryResizeActive = false
    this.memoryResizePointerId = null
    this.unbindMemoryResizeListeners()
    if (wasActive) this.persistMemoryFilesPaneWidth()
  }

  private readonly handleMemoryResizePointerMove = (event: PointerEvent) => {
    if (!this.memoryResizeActive) return
    if (this.memoryResizePointerId !== null && event.pointerId !== this.memoryResizePointerId) return
    const deltaX = event.clientX - this.memoryResizeStartX
    const width = this.memoryResizeStartWidth + deltaX
    this.memoryFilesPaneWidthPx = this.clampMemoryFilesPaneWidth(width)
  }

  private readonly handleMemoryResizePointerEnd = (event: PointerEvent) => {
    if (!this.memoryResizeActive) return
    if (this.memoryResizePointerId !== null && event.pointerId !== this.memoryResizePointerId) return
    this.finishMemoryResize()
  }

  private handleMemoryResizePointerDown(event: PointerEvent) {
    if (!this.isMemoryDesktopLayout()) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement | null
    if (handle?.setPointerCapture) {
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // Continue using window listeners if pointer capture is unavailable.
      }
    }
    this.memoryResizeActive = true
    this.memoryResizePointerId = event.pointerId
    this.memoryResizeStartX = event.clientX
    this.memoryResizeStartWidth = this.clampMemoryFilesPaneWidth(this.memoryFilesPaneWidthPx)
    this.bindMemoryResizeListeners()
  }

  private handleMemoryResizeKeydown(event: KeyboardEvent) {
    if (!this.isMemoryDesktopLayout()) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? MEMORY_RESIZE_STEP_FAST_PX : MEMORY_RESIZE_STEP_PX
    const delta = event.key === 'ArrowLeft' ? -step : step
    this.memoryFilesPaneWidthPx = this.clampMemoryFilesPaneWidth(this.memoryFilesPaneWidthPx + delta)
    this.persistMemoryFilesPaneWidth()
  }

  protected willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed)
    if (!changed.has('agent')) return

    const previousAgent = changed.get('agent') as Agent | undefined
    if (
      previousAgent?.id !== this.agent?.id
      || previousAgent?.hostExecApprovalMode !== this.agent?.hostExecApprovalMode
    ) {
      this.hostExecApprovalConfirmOpen = false
      this.hostExecApprovalDraft = null
      this.hostExecApprovalSaving = false
    }

    if (this.memoryResizeActive) {
      this.memoryResizeActive = false
      this.memoryResizePointerId = null
      this.unbindMemoryResizeListeners()
    }

    const nextAgentId = this.agent?.id || null
    const previousAgentId = previousAgent?.id || this.previousAgentId
    this.mountPopoverOpen = false

    if (previousAgentId === nextAgentId) {
      this.previousAgentId = nextAgentId
      return
    }

    if (previousAgentId) this.persistAgentView(previousAgentId)

    if (nextAgentId) {
      this.restoreAgentView(nextAgentId)
      if (this.memoryOpen) {
        const showLoadingState = this.memoryFiles.length === 0
        if (showLoadingState) this.memoryLoading = true
        void this.refreshMemoryFiles(nextAgentId).finally(() => {
          if (!showLoadingState) return
          if (this.agent.id === nextAgentId) this.memoryLoading = false
        })
      }
    }
    else this.applyViewSnapshot(this.createDefaultViewSnapshot())

    this.previousAgentId = nextAgentId
  }

  private toggleExpand(id: string) {
    const next = new Set(this.expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.expandedIds = next
  }

  private handleScroll() {
    if (!this.scrollContainer) return
    const { scrollTop, scrollHeight, clientHeight } = this.scrollContainer
    this.userScrolledUp = scrollHeight - scrollTop - clientHeight > 50
  }

  updated(changed: Map<string, unknown>) {
    super.updated(changed)
    if (changed.has('entries') && !this.userScrolledUp && this.scrollContainer) {
      requestAnimationFrame(() => {
        if (this.scrollContainer) {
          this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight
        }
      })
    }
    if (changed.has('selectedModelProvider') && this.selectedModelProvider) {
      this.showModelSelectionPrompt = false
    }
  }

  private renderMarkdown(text: string) {
    const raw = marked.parse(text, { async: false }) as string
    let sanitized = DOMPurify.sanitize(raw, {
      ADD_TAGS: ['button'],
      ADD_ATTR: ['data-app-slug'],
    })
    // Replace [app:slug] with clickable buttons
    sanitized = sanitized.replace(
      /\[app:([a-z0-9_-]+)\]/gi,
      '<button class="chat-app-btn" data-app-slug="$1">\u25B6 $1</button>',
    )
    return unsafeHTML(sanitized)
  }

  private get memoryDirty(): boolean {
    return this.memoryFileContent !== this.memoryFileOriginal
  }

  private get selectedMemoryFile(): MemoryFile | null {
    if (!this.memorySelectedPath) return null
    return this.memoryFiles.find(file => file.path === this.memorySelectedPath) || null
  }

  private get filesOnlyMemoryFiles(): MemoryFile[] {
    return this.memoryFiles.filter((file) => this.isListableMemoryFile(file.path))
  }

  private get filteredMemoryFiles(): MemoryFile[] {
    const needle = this.memoryQuery.trim().toLowerCase()
    const filtered = this.filesOnlyMemoryFiles.filter((file) => {
      if (!needle) return true
      const path = this.normalizeMemoryPath(file.path)
      const name = this.getMemoryFileName(path)
      return `${path} ${name}`.toLowerCase().includes(needle)
    })

    filtered.sort((a, b) => {
      if (this.memorySort === 'updated') {
        const delta = b.modifiedAt - a.modifiedAt
        if (delta !== 0) return delta
      } else if (this.memorySort === 'size') {
        const delta = b.size - a.size
        if (delta !== 0) return delta
      } else {
        const nameDelta = this.getMemoryFileName(a.path).localeCompare(this.getMemoryFileName(b.path))
        if (nameDelta !== 0) return nameDelta
      }
      return this.normalizeMemoryPath(a.path).localeCompare(this.normalizeMemoryPath(b.path))
    })

    return filtered
  }

  private normalizeMemoryPath(path: string): string {
    return path.replace(/\\/g, '/').trim()
  }

  private getMemoryFileName(path: string): string {
    const normalized = this.normalizeMemoryPath(path)
    const name = normalized.split('/').pop()
    return name && name.length > 0 ? name : normalized
  }

  private isListableMemoryFile(path: string): boolean {
    const normalized = this.normalizeMemoryPath(path)
    if (!normalized || normalized.endsWith('/')) return false
    const name = this.getMemoryFileName(normalized)
    return Boolean(name && name !== '.' && name !== '..')
  }

  private formatMemorySize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  private formatMemoryDate(ts: number): string {
    return new Date(ts).toLocaleString()
  }

  private async refreshMemoryFiles(agentId = this.agent.id) {
    try {
      const files = await api.listMemoryFiles(agentId)
      if (this.agent.id !== agentId) return
      this.memoryFiles = files
    } catch {
      if (this.agent.id !== agentId) return
      this.memoryFiles = []
    }
  }

  private handleToggleAgent() {
    this.dispatchEvent(new CustomEvent('toggle-agent', {
      detail: this.agent.id,
      bubbles: true, composed: true,
    }))
  }

  private handleCancelStart() {
    this.dispatchEvent(new CustomEvent('cancel-start', {
      detail: this.agent.id,
      bubbles: true, composed: true,
    }))
  }

  private handleOpenProfile() {
    this.dispatchEvent(new CustomEvent('open-agent-profile', {
      detail: this.agent.id,
      bubbles: true, composed: true,
    }))
  }

  private handleConversationClick(e: Event) {
    const target = e.target as HTMLElement
    if (!target.classList?.contains('chat-app-btn')) return
    const slug = target.dataset.appSlug
    if (!slug) return
    this.dispatchEvent(new CustomEvent('open-miniapp', {
      detail: { slug, agentId: this.agent.id },
      bubbles: true,
      composed: true,
    }))
  }

  private handleComposerKeydown(e: CustomEvent<CodexComposerKeydownDetail>) {
    const keyboardEvent = e.detail.event
    if (keyboardEvent.key === 'Escape' && this.mountPopoverOpen) {
      keyboardEvent.preventDefault()
      this.mountPopoverOpen = false
      return
    }
    const wantsSend = keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey
    if (wantsSend) {
      keyboardEvent.preventDefault()
      this.handleSend()
    }
  }

  private handleComposerAddAction(e: CustomEvent<CodexComposerAddActionDetail>) {
    if (e.detail.id === 'mount-local-dir') {
      this.mountPopoverOpen = true
    }
  }

  private handleMountPopoverKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    this.mountPopoverOpen = false
  }

  private get hostExecApprovalValue(): HostExecApprovalMode {
    return this.hostExecApprovalDraft ?? this.agent.hostExecApprovalMode
  }

  private handleHostExecApprovalChange(event: Event) {
    const nextMode = (event.target as HTMLSelectElement).value as HostExecApprovalMode
    if (nextMode === this.agent.hostExecApprovalMode) {
      this.hostExecApprovalConfirmOpen = false
      this.hostExecApprovalDraft = null
      return
    }
    if (nextMode === 'dangerously-skip') {
      this.hostExecApprovalDraft = nextMode
      this.hostExecApprovalConfirmOpen = true
      return
    }
    this.hostExecApprovalConfirmOpen = false
    this.hostExecApprovalDraft = null
    void this.saveHostExecApprovalMode(nextMode)
  }

  private cancelHostExecApprovalConfirm() {
    if (this.hostExecApprovalSaving) return
    this.hostExecApprovalConfirmOpen = false
    this.hostExecApprovalDraft = null
  }

  private confirmHostExecApprovalChange() {
    if (this.hostExecApprovalDraft !== 'dangerously-skip') return
    void this.saveHostExecApprovalMode(this.hostExecApprovalDraft)
  }

  private async saveHostExecApprovalMode(nextMode: HostExecApprovalMode) {
    if (!this.agent || this.hostExecApprovalSaving) return
    if (nextMode === this.agent.hostExecApprovalMode) {
      this.hostExecApprovalConfirmOpen = false
      this.hostExecApprovalDraft = null
      return
    }

    this.hostExecApprovalSaving = true
    try {
      const updated = await api.updateAgent(this.agent.id, { hostExecApprovalMode: nextMode })
      this.dispatchEvent(new CustomEvent('agent-updated', {
        detail: updated,
        bubbles: true,
        composed: true,
      }))
      this.hostExecApprovalConfirmOpen = false
      this.hostExecApprovalDraft = null
    } catch (err) {
      console.error('Failed to update host exec approval mode:', err)
      this.hostExecApprovalConfirmOpen = false
      this.hostExecApprovalDraft = null
    } finally {
      this.hostExecApprovalSaving = false
    }
  }

  private async handleSend() {
    const content = this.composerEl?.value?.trim()
    if (!content || this.sending) return
    if (!this.selectedModelProvider) {
      this.showModelSelectionPrompt = true
      this.composerEl.focusInput()
      return
    }
    this.mountPopoverOpen = false
    this.sending = true
    this.composerEl.value = ''
    this.composerEl.focusInput()
    try {
      this.dispatchEvent(new CustomEvent('send-dm', {
        detail: { agentId: this.agent.id, content },
        bubbles: true, composed: true,
      }))
    } finally {
      this.sending = false
    }
  }

  private handleOpenModelSettings() {
    this.dispatchEvent(new CustomEvent<{ section: 'model' }>('open-settings', {
      detail: { section: 'model' },
      bubbles: true,
      composed: true,
    }))
  }

  private async handleOpenMemory() {
    const agentId = this.agent.id
    this.memoryOpen = true
    this.memoryLoading = true
    this.memoryPane = 'files'
    this.memorySelectedPath = null
    this.memoryFileContent = ''
    this.memoryFileOriginal = ''
    this.memoryCreating = false
    this.memoryDeleteConfirm = null
    this.memoryQuery = ''
    await this.refreshMemoryFiles(agentId)
    if (this.agent.id !== agentId) return
    this.memoryLoading = false
  }

  private async handleCloseMemory() {
    if (this.memoryDirty) {
      if (!confirm('You have unsaved changes. Close anyway?')) return
    }
    this.finishMemoryResize()
    this.memoryOpen = false
  }

  private async handleSelectFile(path: string) {
    if (this.memorySelectedPath === path) return
    if (this.memoryDirty) {
      if (!confirm('You have unsaved changes. Switch files?')) return
    }
    const agentId = this.agent.id
    this.memorySelectedPath = path
    this.memoryPane = 'editor'
    this.memoryFileLoading = true
    try {
      const { content } = await api.readMemoryFile(agentId, path)
      if (this.agent.id !== agentId || this.memorySelectedPath !== path) return
      this.memoryFileContent = content
      this.memoryFileOriginal = content
    } catch {
      if (this.agent.id !== agentId || this.memorySelectedPath !== path) return
      this.memoryFileContent = ''
      this.memoryFileOriginal = ''
    } finally {
      if (this.agent.id === agentId && this.memorySelectedPath === path) {
        this.memoryFileLoading = false
      }
    }
  }

  private async handleSaveMemory() {
    if (!this.memorySelectedPath) return
    const agentId = this.agent.id
    const path = this.memorySelectedPath
    const content = this.memoryFileContent
    this.memorySaving = true
    try {
      await api.writeMemoryFile(agentId, path, content)
      if (this.agent.id !== agentId || this.memorySelectedPath !== path) return
      this.memoryFileOriginal = content
      // Refresh file list (sizes may have changed)
      await this.refreshMemoryFiles(agentId)
    } catch { /* ignore */ }
    finally {
      if (this.agent.id === agentId) this.memorySaving = false
    }
  }

  private handleMemoryKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      this.handleSaveMemory()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      this.handleCloseMemory()
    }
  }

  private handleMemoryPaneSwitch(pane: 'files' | 'editor') {
    this.memoryPane = pane
  }

  private handleMemorySearchInput(e: Event) {
    this.memoryQuery = (e.target as HTMLInputElement).value
  }

  private handleMemorySortChange(e: Event) {
    this.memorySort = (e.target as HTMLSelectElement).value as typeof this.memorySort
  }

  private handleMemoryRefresh() {
    this.refreshMemoryFiles(this.agent.id)
  }

  private handleMemoryFileCardKeydown(e: KeyboardEvent, path: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.handleSelectFile(path)
    }
  }

  private handleStartCreate() {
    this.memoryCreating = true
    this.memoryPane = 'files'
    this.memoryNewFileName = ''
    requestAnimationFrame(() => {
      this.shadowRoot?.querySelector<HTMLInputElement>('.memory-new-input')?.focus()
    })
  }

  private async handleCreateFile() {
    const agentId = this.agent.id
    let name = this.memoryNewFileName.trim()
    if (!name) { this.memoryCreating = false; return }
    if (!name.endsWith('.md')) name += '.md'
    try {
      await api.createMemoryFile(agentId, name)
      if (this.agent.id !== agentId) return
      await this.refreshMemoryFiles(agentId)
      if (this.agent.id !== agentId) return
      this.memoryCreating = false
      await this.handleSelectFile(name)
    } catch (err: any) {
      if (this.agent.id !== agentId) return
      if (err.message?.includes('409')) alert('File already exists')
    }
  }

  private handleNewFileKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); this.handleCreateFile() }
    if (e.key === 'Escape') { e.preventDefault(); this.memoryCreating = false }
  }

  private async handleDeleteFile(path: string) {
    const agentId = this.agent.id
    try {
      await api.deleteMemoryFile(agentId, path)
      if (this.agent.id !== agentId) return
      await this.refreshMemoryFiles(agentId)
      if (this.agent.id !== agentId) return
      if (this.memorySelectedPath === path) {
        this.memorySelectedPath = null
        this.memoryFileContent = ''
        this.memoryFileOriginal = ''
        this.memoryPane = 'files'
      }
    } catch { /* ignore */ }
    if (this.agent.id === agentId) this.memoryDeleteConfirm = null
  }

  private renderEntry(entry: AgentLogEntry, isLast = false) {
    const d = entry.data as Record<string, any>
    const isOpen = this.expandedIds.has(entry.id)

    switch (entry.type) {
      case 'thinking':
        // Only show if this is the last entry AND agent is actively thinking/responding
        if (!isLast) return nothing
        if (this.agent.status !== 'thinking' && this.agent.status !== 'responding') return nothing
        return html`
          <div class="entry-thinking">
            <div class="entry-avatar" style="background: ${this.agent.avatarColor}">${this.agent.name.charAt(0).toUpperCase()}</div>
            <div class="thinking-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        `

      case 'system':
        return html`
          <div class="entry-system">
            <div class="system-pill" title=${d.message || ''}>${d.message || ''}</div>
          </div>
        `

      case 'text':
        return html`
          <div class="entry-text">
            <div class="entry-avatar" style="background: ${this.agent.avatarColor}">${this.agent.name.charAt(0).toUpperCase()}</div>
            <div class="entry-text-body">
              <div class="entry-text-name">${this.agent.name}</div>
              <div class="entry-text-content">${this.renderMarkdown(d.text || '')}</div>
            </div>
          </div>
        `

      case 'tool_use':
        return html`
          <div class="entry-tool">
            <div class="tool-card tool-use">
              <div class="tool-header" @click=${() => this.toggleExpand(entry.id)}>
                <span class="tool-chevron ${isOpen ? 'open' : ''}">▶</span>
                <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14.5 6.5a4.3 4.3 0 1 0 3 3l-3.3 3.3a1 1 0 0 1-1.4 0l-1.4-1.4a1 1 0 0 1 0-1.4l3.3-3.3a4.3 4.3 0 0 0-.2-.2Z" stroke-linecap="round" stroke-linejoin="round"></path>
                  <path d="M5 19l4-4" stroke-linecap="round"></path>
                </svg>
                <span class="tool-label">${d.toolName || 'unknown'}</span>
                <span class="tool-label-type" style="background: var(--warning)">Tool Call</span>
              </div>
              <div class="tool-body ${isOpen ? 'open' : ''}">
                <div class="tool-code">${JSON.stringify(d.input, null, 2)}</div>
              </div>
            </div>
          </div>
        `

      case 'tool_result':
        return html`
          <div class="entry-tool">
            <div class="tool-card ${d.isError ? 'tool-error' : 'tool-result'}">
              <div class="tool-header" @click=${() => this.toggleExpand(entry.id)}>
                <span class="tool-chevron ${isOpen ? 'open' : ''}">▶</span>
                ${d.isError
                  ? html`
                    <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="8"></circle>
                      <path d="M9.5 9.5l5 5m0-5-5 5" stroke-linecap="round"></path>
                    </svg>
                  `
                  : html`
                    <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 4h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke-linejoin="round"></path>
                      <path d="M14 4v4h4" stroke-linejoin="round"></path>
                    </svg>
                  `}
                <span class="tool-label">${d.isError ? 'Error Result' : 'Result'}</span>
                <span class="tool-label-type" style="background: ${d.isError ? 'var(--error)' : 'var(--accent)'}">${d.isError ? 'Error' : 'Output'}</span>
              </div>
              <div class="tool-body ${isOpen ? 'open' : ''}">
                <div class="tool-code ${d.isError ? 'error' : ''}">${d.content || ''}</div>
              </div>
            </div>
          </div>
        `

      case 'result':
        return html`
          <div class="entry-result">
            <div class="result-bar">
              ${d.durationMs != null ? html`
                <div class="result-stat">
                  <span class="result-label">Duration</span>
                  <span class="result-value">${(d.durationMs / 1000).toFixed(1)}s</span>
                </div>
              ` : nothing}
              ${d.numTurns != null ? html`
                <div class="result-stat">
                  <span class="result-label">Turns</span>
                  <span class="result-value">${d.numTurns}</span>
                </div>
              ` : nothing}
              ${d.totalCostUsd != null ? html`
                <div class="result-stat">
                  <span class="result-label">Cost</span>
                  <span class="result-value">$${d.totalCostUsd.toFixed(4)}</span>
                </div>
              ` : nothing}
            </div>
          </div>
        `

      case 'user_message': {
        const time = new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        return html`
          <div class="entry-user">
            <div class="user-avatar">Y</div>
            <div class="entry-user-body">
              <div class="entry-user-header">
                <span class="entry-user-name">You</span>
                <span class="entry-user-time">${time}</span>
              </div>
              <div class="entry-user-content">${d.content || ''}</div>
            </div>
          </div>
        `
      }

      case 'channel_input': {
        const channels = (d.channels || []) as Array<{ name: string; messages: Array<{ author: string; content: string }> }>
        return html`
          ${channels.map(ch => {
            const cardId = `${entry.id}-${ch.name}`
            const cardOpen = this.expandedIds.has(cardId) || ch.messages.length <= 3
            return html`
              <div class="entry-channel-input">
                <div class="channel-card">
                  <div class="channel-card-header" @click=${() => this.toggleExpand(cardId)}>
                    <span class="tool-chevron ${cardOpen ? 'open' : ''}">▶</span>
                    <span class="channel-card-icon">#</span>
                    <span class="channel-card-name">${ch.name}</span>
                    <span class="channel-card-count">${ch.messages.length} message${ch.messages.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div class="channel-card-body ${cardOpen ? 'open' : ''}">
                    ${ch.messages.map(msg => html`
                      <div class="channel-msg">
                        <span class="channel-msg-author">${msg.author}:</span>
                        <span class="channel-msg-content"> ${msg.content}</span>
                      </div>
                    `)}
                  </div>
                </div>
              </div>
            `
          })}
        `
      }

      case 'error':
        return html`
          <div class="entry-error">
            <div class="error-pill">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8v5m0 3h.01M10.3 4.9 3.7 16.4a2 2 0 0 0 1.7 3h13.2a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0Z" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
              <span>${d.message || 'Unknown error'}</span>
            </div>
          </div>
        `

      default:
        return html`
          <div class="entry-unknown">
            <div class="unknown-code">${JSON.stringify(d, null, 2)}</div>
          </div>
        `
    }
  }

  render() {
    if (!this.agent) return nothing

    const initial = this.agent.name.charAt(0).toUpperCase()
    const statusColor = STATUS_COLORS[this.agent.status] || 'var(--text-muted)'
    const statusLabel = STATUS_LABELS[this.agent.status] || this.agent.status
    const isStopped = this.agent.status === 'stopped'
    const isStarting = this.agent.status === 'starting'
    const isAnimated = this.agent.status === 'thinking' || this.agent.status === 'responding' || isStarting
    const inputDisabled = isStopped || isStarting || this.sending
    const memoryContentWidth = this.getMemoryContentWidth()
    const memoryFilesWidth = this.clampMemoryFilesPaneWidth(this.memoryFilesPaneWidthPx, memoryContentWidth)
    const memoryFilesMax = this.getMemoryFilesPaneEffectiveMax(memoryContentWidth)
    const showMemoryDateColumn = memoryFilesWidth >= 320

    return html`
      <div class="header">
        <div class="header-main">
          <div class="header-avatar" style="background: ${this.agent.avatarColor}" @click=${this.handleOpenProfile} title="View profile">
            ${initial}
          </div>
          <div class="header-info">
            <div class="header-name">${this.agent.name}</div>
            <div class="header-status">
              <span class="status-dot ${isAnimated ? 'thinking' : ''}" style="background: ${statusColor}"></span>
              ${statusLabel}
            </div>
          </div>
        </div>
      </div>

      <div class="conversation" @scroll=${this.handleScroll} @click=${this.handleConversationClick}>
        ${this.entries.length === 0
          ? html`
            <div class="empty-state">
              <div class="empty-avatar" style="background: ${this.agent.avatarColor}">${initial}</div>
              <div class="empty-title">${this.agent.name}</div>
              <div class="empty-subtitle">
                ${isStopped
                  ? 'This agent is offline. Start it to begin a conversation.'
                  : isStarting
                    ? 'Agent is starting up...'
                    : 'No activity yet. Send a message or wait for channel activity.'}
              </div>
            </div>
          `
          : this.entries.map((e, i) => this.renderEntry(e, i === this.entries.length - 1))
        }
      </div>

      <div class="input-area">
        ${this.showModelSelectionPrompt
          ? html`
              <div class="input-guard" role="status" aria-live="polite">
                <div class="input-guard-copy">Set a model in Settings &gt; Model first.</div>
                <button class="input-guard-btn" type="button" @click=${this.handleOpenModelSettings}>
                  Open Settings
                </button>
              </div>
            `
          : nothing}
        <div class="composer-shell">
          ${this.mountPopoverOpen ? html`
            <div class="mount-popover" @keydown=${this.handleMountPopoverKeydown}>
              <agent-mounts-panel
                .agentId=${this.agent.id}
                .agentRunning=${this.agent.status !== 'stopped'}
              ></agent-mounts-panel>
            </div>
          ` : nothing}
          ${this.hostExecApprovalConfirmOpen ? html`
            <div class="host-exec-policy-popover" role="dialog" aria-label="Confirm dangerous host exec policy">
              <div class="host-exec-policy-title">Enable dangerous host exec mode?</div>
              <div class="host-exec-policy-copy">
                Future host exec requests for ${this.agent.name} will run without human approval. Existing pending host exec requests for this agent will also auto-approve immediately.
              </div>
              <div class="host-exec-policy-actions">
                <button
                  class="host-exec-policy-btn"
                  type="button"
                  ?disabled=${this.hostExecApprovalSaving}
                  @click=${this.cancelHostExecApprovalConfirm}
                >Cancel</button>
                <button
                  class="host-exec-policy-btn primary"
                  type="button"
                  ?disabled=${this.hostExecApprovalSaving}
                  @click=${this.confirmHostExecApprovalChange}
                >${this.hostExecApprovalSaving ? 'Saving...' : 'Enable'}</button>
              </div>
            </div>
          ` : nothing}
          <codex-composer
            .placeholder=${isStarting ? 'Agent is starting...' : `Message ${this.agent.name}...`}
            ?disabled=${inputDisabled}
            .sending=${this.sending}
            .addActions=${AGENT_COMPOSER_ADD_ACTIONS}
            @composer-keydown=${this.handleComposerKeydown}
            @composer-add-action=${this.handleComposerAddAction}
            @composer-send=${this.handleSend}
          >
            ${isStopped
              ? html`<button slot="footer-controls" class="composer-aux-btn success" type="button" @click=${this.handleToggleAgent}>Start</button>`
              : isStarting
                ? html`<button slot="footer-controls" class="composer-aux-btn danger" type="button" @click=${this.handleCancelStart}>Cancel</button>`
                : html`<button slot="footer-controls" class="composer-aux-btn danger" type="button" @click=${this.handleToggleAgent}>Stop</button>`
            }
            <button slot="footer-controls" class="composer-aux-btn" type="button" @click=${this.handleOpenMemory} title="View agent memory">
              Memory
            </button>
            <div slot="footer-controls" class="composer-aux-select-wrap">
              <select
                class="composer-aux-select"
                .value=${this.hostExecApprovalValue}
                ?disabled=${this.hostExecApprovalSaving}
                @change=${this.handleHostExecApprovalChange}
                title="Host exec approval mode"
                aria-label="Host exec approval mode"
              >
                ${HOST_EXEC_APPROVAL_OPTIONS.map((option) => html`
                  <option value=${option.value}>${option.label}</option>
                `)}
              </select>
            </div>
          </codex-composer>
        </div>
      </div>

      ${this.memoryOpen ? html`
        <div class="memory-overlay" @keydown=${(e: KeyboardEvent) => this.handleMemoryKeydown(e)}>
          <div class="memory-shell">
            <div class="memory-toolbar">
              <span class="memory-title">Agent Memory</span>
              <div class="memory-pane-toggle">
                <button
                  class="memory-pane-btn ${this.memoryPane === 'files' ? 'active' : ''}"
                  type="button"
                  @click=${() => this.handleMemoryPaneSwitch('files')}
                >Files</button>
                <button
                  class="memory-pane-btn ${this.memoryPane === 'editor' ? 'active' : ''}"
                  type="button"
                  @click=${() => this.handleMemoryPaneSwitch('editor')}
                >Editor</button>
              </div>
              <span class="memory-toolbar-spacer"></span>
              <input
                class="memory-search"
                type="search"
                .value=${this.memoryQuery}
                @input=${this.handleMemorySearchInput}
                placeholder="Search memory files..."
              />
              <select class="memory-sort" .value=${this.memorySort} @change=${this.handleMemorySortChange}>
                <option value="updated">Recently updated</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
              <button class="memory-btn" type="button" @click=${this.handleMemoryRefresh}>Refresh</button>
              <button class="memory-btn" type="button" @click=${this.handleStartCreate}>+ New</button>
              <button class="memory-btn" type="button" @click=${this.handleCloseMemory}>Close</button>
            </div>

            ${this.memoryLoading ? html`
              <div class="memory-empty-state">Loading memory files...</div>
            ` : html`
              <div
                class="memory-content ${this.memoryPane === 'files' ? 'show-files' : 'show-editor'}"
                style=${`--memory-files-width: ${memoryFilesWidth}px;`}
              >
                <section class="memory-files-pane">
                  <div class="memory-pane-head memory-files-head">
                    <span class="memory-pane-label">Files</span>
                    <span class="memory-pane-meta">${this.filteredMemoryFiles.length} shown</span>
                  </div>

                  ${this.memoryCreating ? html`
                    <div class="memory-new-file">
                      <input
                        class="memory-new-input"
                        placeholder="filename.md"
                        .value=${this.memoryNewFileName}
                        @input=${(e: Event) => { this.memoryNewFileName = (e.target as HTMLInputElement).value }}
                        @keydown=${(e: KeyboardEvent) => this.handleNewFileKeydown(e)}
                        @blur=${() => { if (!this.memoryNewFileName.trim()) this.memoryCreating = false }}
                      />
                    </div>
                  ` : nothing}

                  <div class="memory-file-table ${showMemoryDateColumn ? '' : 'hide-date'}">
                    <div class="memory-file-table-head">
                      <span class="memory-col-name">Name</span>
                      ${showMemoryDateColumn ? html`<span class="memory-col-date">Date Modified</span>` : nothing}
                      <span class="memory-col-size">Size</span>
                      <span class="memory-col-action" aria-hidden="true"></span>
                    </div>
                    <div class="memory-file-list">
                      ${this.filteredMemoryFiles.length === 0
                        ? html`
                          <div class="memory-empty-state">
                            ${this.filesOnlyMemoryFiles.length === 0
                              ? 'No memory files yet. Create one to get started.'
                              : 'No files match your search.'}
                          </div>
                        `
                        : this.filteredMemoryFiles.map(f => html`
                          <div class="memory-file-entry">
                            <div
                              class="memory-file-row ${this.memorySelectedPath === f.path ? 'active' : ''}"
                              tabindex="0"
                              role="button"
                              title=${f.path}
                              @click=${() => this.handleSelectFile(f.path)}
                              @keydown=${(e: KeyboardEvent) => this.handleMemoryFileCardKeydown(e, f.path)}
                            >
                              <span class="memory-col-name memory-file-name" title=${f.path}>${this.getMemoryFileName(f.path)}</span>
                              ${showMemoryDateColumn ? html`
                                <span class="memory-col-date memory-file-date">${this.formatMemoryDate(f.modifiedAt)}</span>
                              ` : nothing}
                              <span class="memory-col-size memory-file-size">${this.formatMemorySize(f.size)}</span>
                              <button
                                class="memory-file-delete"
                                type="button"
                                aria-label=${`Delete ${this.getMemoryFileName(f.path)}`}
                                title=${`Delete ${this.getMemoryFileName(f.path)}`}
                                @click=${(e: Event) => { e.stopPropagation(); this.memoryDeleteConfirm = f.path }}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"></path>
                                </svg>
                              </button>
                            </div>
                            ${this.memoryDeleteConfirm === f.path ? html`
                              <div class="memory-delete-confirm">
                                <span>Delete this file?</span>
                                <button class="memory-delete-btn memory-delete-yes" type="button" @click=${() => this.handleDeleteFile(f.path)}>Yes</button>
                                <button class="memory-delete-btn memory-delete-no" type="button" @click=${() => { this.memoryDeleteConfirm = null }}>No</button>
                              </div>
                            ` : nothing}
                          </div>
                        `)}
                    </div>
                  </div>
                </section>

                <button
                  class="memory-resizer ${this.memoryResizeActive ? 'active' : ''}"
                  type="button"
                  role="separator"
                  aria-label="Resize files pane"
                  aria-orientation="vertical"
                  aria-valuemin=${String(MEMORY_FILES_MIN_WIDTH_PX)}
                  aria-valuemax=${String(memoryFilesMax)}
                  aria-valuenow=${String(memoryFilesWidth)}
                  tabindex="0"
                  @pointerdown=${this.handleMemoryResizePointerDown}
                  @keydown=${this.handleMemoryResizeKeydown}
                ></button>

                <section class="memory-editor-pane">
                  ${this.memorySelectedPath ? html`
                    <div class="memory-editor-head">
                      <div class="memory-editor-title-wrap">
                        <div class="memory-editor-filename">${this.memorySelectedPath.split('/').pop() || this.memorySelectedPath}</div>
                        <div class="memory-editor-path">${this.memorySelectedPath}</div>
                      </div>
                      ${this.memoryDirty ? html`<div class="memory-dirty-dot" title="Unsaved changes"></div>` : nothing}
                      <span class="memory-editor-meta">
                        ${this.selectedMemoryFile?.modifiedAt ? this.formatMemoryDate(this.selectedMemoryFile.modifiedAt) : ''}
                      </span>
                      <button
                        class="memory-btn primary"
                        type="button"
                        ?disabled=${!this.memoryDirty || this.memorySaving}
                        @click=${this.handleSaveMemory}
                      >${this.memorySaving ? 'Saving...' : 'Save'}</button>
                    </div>
                    <div class="memory-editor-body">
                      ${this.memoryFileLoading ? html`
                        <div class="memory-empty-state">Loading file...</div>
                      ` : html`
                        <textarea
                          class="memory-textarea"
                          .value=${this.memoryFileContent}
                          @input=${(e: Event) => { this.memoryFileContent = (e.target as HTMLTextAreaElement).value }}
                          placeholder="Empty file"
                        ></textarea>
                      `}
                    </div>
                  ` : html`
                    <div class="memory-empty-state">
                      <div class="memory-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                          <path d="M3.5 1A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5v-8A1.5 1.5 0 0012.5 4H10V2.5A1.5 1.5 0 008.5 1h-5zM10 4V2.5A.5.5 0 008.5 2h-5a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-8a.5.5 0 00-.5-.5H10z"/>
                        </svg>
                      </div>
                      ${this.filesOnlyMemoryFiles.length === 0
                        ? 'No memory files yet. The agent will create files as it learns, or you can create one.'
                        : 'Select a file to view and edit its contents.'}
                      <button class="memory-btn" type="button" @click=${() => this.handleMemoryPaneSwitch('files')}>Browse Files</button>
                    </div>
                  `}
                </section>
              </div>
            `}
          </div>
        </div>
      ` : nothing}
    `
  }
}
