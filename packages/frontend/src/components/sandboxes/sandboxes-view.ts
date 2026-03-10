import { LitElement, css, html } from 'lit'
import { customElement, property, state as litState } from 'lit/decorators.js'
import { virtualize } from '@lit-labs/virtualizer/virtualize.js'
import type {
  Agent,
  BoxCreateRequest,
  BoxResource,
  ExecEvent,
  ExecResource,
  FileDownloadResponse,
  HostImportRequest,
  SandboxFsEntry,
  SandboxFsReadResponse,
} from '@dune/shared'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import * as api from '../../services/api-client.js'

type SandboxTab = 'overview' | 'execs' | 'files' | 'terminal'
type SandboxDurability = 'ephemeral' | 'persistent'
type FsDialogMode = 'upload' | 'new-file' | 'new-folder' | 'rename' | 'import-host' | null

type FsTreeNode = {
  path: string
  name: string
  loaded: boolean
  loading: boolean
  expanded: boolean
  error: string
  children: string[]
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

@customElement('sandboxes-view')
export class SandboxesView extends LitElement {
  @property({ type: Array }) agents: Agent[] = []

  @litState() private query = ''
  @litState() private boxes: BoxResource[] = []
  @litState() private loading = false
  @litState() private errorMessage = ''
  @litState() private selectedBoxId: string | null = null

  @litState() private createOpen = false
  @litState() private creating = false
  @litState() private createError = ''
  @litState() private createName = ''
  @litState() private createImage = 'ghcr.io/boxlite-ai/boxlite-skillbox:0.1.0'
  @litState() private createDurability: SandboxDurability = 'persistent'
  @litState() private createAutoRemove = false
  @litState() private createWorkingDir = '/workspace'
  @litState() private createCpu = 2
  @litState() private createMemoryMib = 2048
  @litState() private createDiskGb = 10
  @litState() private createGuestPort = 3000
  @litState() private createShareAgents = new Set<string>()
  @litState() private createHostImportPath = ''
  @litState() private createHostImportDest = '/workspace'

  @litState() private detailTab: SandboxTab = 'overview'
  @litState() private updateError = ''
  @litState() private updateName = ''
  @litState() private updateDurability: SandboxDurability = 'persistent'

  @litState() private execCommand = 'echo sandbox-ready'
  @litState() private execRunning = false
  @litState() private execs: ExecResource[] = []
  @litState() private selectedExecId: string | null = null
  @litState() private execEvents: ExecEvent[] = []
  @litState() private execError = ''

  @litState() private fileUploadPath = '/workspace/hello.txt'
  @litState() private fileUploadContent = 'Hello from Dune sandbox.\n'
  @litState() private fileDownloadPath = '/workspace/hello.txt'
  @litState() private fileDownloadResult: FileDownloadResponse | null = null
  @litState() private fileError = ''
  @litState() private fileInfo = ''
  @litState() private hostImportPath = ''
  @litState() private hostImportDest = '/workspace'
  @litState() private fsCurrentPath = '/workspace'
  @litState() private fsEntries: SandboxFsEntry[] = []
  @litState() private fsSelectedPath: string | null = null
  @litState() private fsIncludeHidden = false
  @litState() private fsSearch = ''
  @litState() private fsLoading = false
  @litState() private fsInitializedBoxId: string | null = null
  @litState() private fsPreview: SandboxFsReadResponse | null = null
  @litState() private fsPreviewText = ''
  @litState() private fsPreviewError = ''
  @litState() private fsNodes = new Map<string, FsTreeNode>()
  @litState() private fsActionError = ''
  @litState() private fsActionInfo = ''
  @litState() private fsDialogMode: FsDialogMode = null
  @litState() private fsDialogPrimaryPath = ''
  @litState() private fsDialogSecondaryPath = ''
  @litState() private fsDialogContent = ''
  @litState() private fsActionBusy = false

  @litState() private terminalError = ''
  @litState() private terminalConnected = false

  private terminalSocket: WebSocket | null = null
  private terminalInstance: Terminal | null = null
  private terminalFitAddon: FitAddon | null = null
  private pollTimer?: ReturnType<typeof setInterval>
  private refreshInFlight = false

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: var(--bg-primary);
    }

    .shell {
      height: 100%;
      overflow: auto;
      padding: 14px 18px 24px;
    }

    .page {
      max-width: 1100px;
      margin: 0 auto;
      min-height: 100%;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      min-height: var(--header-height);
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .refresh-btn {
      border: none;
      border-radius: 11px;
      height: 36px;
      padding: 0 10px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      transition: background var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
    }

    .refresh-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .refresh-btn svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .search-wrap {
      position: relative;
      width: min(310px, 100%);
    }

    .search-wrap svg {
      position: absolute;
      left: 11px;
      top: 50%;
      width: 14px;
      height: 14px;
      stroke: var(--text-muted);
      stroke-width: 2;
      fill: none;
      transform: translateY(-50%);
      pointer-events: none;
    }

    .search {
      width: 100%;
      height: 36px;
      border: 1px solid color-mix(in srgb, var(--text-muted) 22%, transparent);
      border-radius: 11px;
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 0 12px 0 32px;
      font-size: 14px;
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }

    .search:focus {
      border-color: color-mix(in srgb, var(--accent) 48%, transparent);
      background: var(--bg-surface);
    }

    .search::placeholder {
      color: var(--text-muted);
    }

    .new-btn {
      border: none;
      border-radius: 11px;
      height: 36px;
      padding: 0 14px;
      background: var(--text-primary);
      color: var(--bg-primary);
      font-size: 14px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      transition: opacity var(--transition-fast), transform var(--transition-fast);
    }

    .new-btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }

    .new-btn svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      flex-shrink: 0;
    }

    .heading {
      margin-bottom: 20px;
    }

    .title {
      font-size: clamp(56px, 5.5vw, 64px);
      line-height: 0.97;
      letter-spacing: -0.04em;
      font-weight: 620;
      color: var(--text-primary);
    }

    .subtitle {
      margin-top: 8px;
      font-size: 15px;
      color: var(--text-secondary);
      font-weight: 520;
      line-height: 1.3;
    }

    .subtitle a {
      color: var(--accent);
      text-decoration: none;
    }

    .subtitle a:hover {
      opacity: 0.86;
    }

    .error {
      margin-bottom: 10px;
      color: var(--error);
      font-size: 13px;
      line-height: 1.4;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 16px;
    }

    .card {
      border: 1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);
      border-radius: 16px;
      background: color-mix(in srgb, var(--bg-primary) 95%, transparent);
      min-height: 104px;
      padding: 13px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
      cursor: pointer;
    }

    .card:hover {
      border-color: color-mix(in srgb, var(--text-muted) 30%, transparent);
      background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }

    .card-icon {
      width: 38px;
      height: 38px;
      border-radius: 11px;
      background: color-mix(in srgb, var(--bg-hover) 74%, transparent);
      color: var(--text-primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .card-icon svg {
      width: 17px;
      height: 17px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }

    .card-main {
      min-width: 0;
    }

    .card-title {
      font-size: 22px;
      line-height: 1;
      font-weight: 620;
      letter-spacing: -0.03em;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-sub {
      margin-top: 4px;
      font-size: 14px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .meta {
      margin-top: 7px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--text-muted);
    }

    .chip {
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: var(--bg-hover);
      color: var(--text-secondary);
    }

    .chip.running {
      background: color-mix(in srgb, var(--success) 16%, transparent);
      color: var(--success);
    }

    .chip.error {
      background: color-mix(in srgb, var(--error) 16%, transparent);
      color: var(--error);
    }

    .chip.readonly {
      background: color-mix(in srgb, var(--warning) 20%, transparent);
      color: var(--warning);
    }

    .action {
      border: none;
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: transparent;
      color: var(--text-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), color var(--transition-fast);
      flex-shrink: 0;
    }

    .action:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .action svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }

    .empty {
      border-radius: 14px;
      border: 1px dashed color-mix(in srgb, var(--text-muted) 26%, transparent);
      color: var(--text-muted);
      font-size: 14px;
      padding: 20px;
      text-align: center;
      background: color-mix(in srgb, var(--bg-surface) 85%, transparent);
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: 130;
      background: rgba(15, 23, 42, 0.42);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal {
      width: min(640px, 92vw);
      max-height: min(90vh, 860px);
      overflow: auto;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-lg);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .modal-title {
      font-size: 20px;
      font-weight: 620;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field.full {
      grid-column: 1 / -1;
    }

    .label {
      font-size: 12px;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .input,
    .textarea,
    .select {
      width: 100%;
      border: 1px solid color-mix(in srgb, var(--text-muted) 22%, transparent);
      border-radius: 10px;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 13px;
      min-height: 34px;
      padding: 7px 10px;
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }

    .input:focus,
    .textarea:focus,
    .select:focus {
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
      background: var(--bg-surface);
    }

    .textarea {
      resize: vertical;
      min-height: 92px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.45;
    }

    .inline-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .check-grid {
      border: 1px solid color-mix(in srgb, var(--text-muted) 18%, transparent);
      border-radius: 10px;
      padding: 10px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 10px;
      max-height: 120px;
      overflow: auto;
      background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
    }

    .check-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
      margin-top: 2px;
    }

    .btn {
      border: none;
      border-radius: 10px;
      height: 34px;
      padding: 0 12px;
      font-size: 13px;
      font-weight: 600;
      transition: opacity var(--transition-fast), transform var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
    }

    .btn:hover {
      transform: translateY(-1px);
    }

    .btn.muted {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .btn.primary {
      background: var(--text-primary);
      color: var(--bg-primary);
    }

    .btn.warn {
      background: color-mix(in srgb, var(--error) 14%, transparent);
      color: var(--error);
    }

    .btn:disabled {
      opacity: 0.52;
      cursor: default;
      transform: none;
    }

    .detail {
      width: min(980px, 96vw);
      max-height: min(90vh, 900px);
      border: none;
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-lg);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      overflow: hidden;
    }

    .detail-head {
      padding: 12px 14px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--text-muted) 16%, transparent);
      background: var(--bg-primary);
    }

    .detail-title {
      font-size: 26px;
      line-height: 1.1;
      letter-spacing: -0.025em;
      font-weight: 620;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail-sub {
      margin-top: 4px;
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .tabs {
      display: flex;
      gap: 2px;
      padding: 8px 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--text-muted) 14%, transparent);
      background: var(--bg-primary);
    }

    .tab {
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      padding: 7px 9px;
      transition: background var(--transition-fast), color var(--transition-fast);
    }

    .tab:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .tab.active {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .detail-body {
      min-height: 0;
      overflow: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .panel {
      border: 1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg-primary) 96%, transparent);
      padding: 11px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .panel-title {
      font-size: 13px;
      font-weight: 620;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .overview-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .overview-item {
      border-radius: 10px;
      padding: 8px;
      background: color-mix(in srgb, var(--bg-surface) 85%, transparent);
      border: 1px solid color-mix(in srgb, var(--text-muted) 12%, transparent);
    }

    .overview-key {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 700;
    }

    .overview-value {
      margin-top: 4px;
      font-size: 13px;
      color: var(--text-primary);
      word-break: break-word;
    }

    .exec-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 190px;
      overflow: auto;
    }

    .exec-row {
      border: 1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);
      border-radius: 9px;
      background: color-mix(in srgb, var(--bg-surface) 74%, transparent);
      padding: 8px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }

    .exec-row:hover {
      border-color: color-mix(in srgb, var(--text-muted) 28%, transparent);
      background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
    }

    .exec-row.active {
      border-color: color-mix(in srgb, var(--accent) 35%, transparent);
      background: color-mix(in srgb, var(--accent) 9%, transparent);
    }

    .exec-command {
      font-size: 12px;
      color: var(--text-primary);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .exec-status {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
    }

    .log {
      border: 1px solid color-mix(in srgb, var(--text-muted) 16%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, var(--bg-surface) 84%, transparent);
      min-height: 160px;
      max-height: 260px;
      overflow: auto;
      padding: 10px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .meta-text {
      font-size: 12px;
      color: var(--text-muted);
    }

    .fs-layout {
      display: grid;
      grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
      gap: 10px;
      min-height: 480px;
    }

    .fs-pane {
      border: 1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, var(--bg-surface) 85%, transparent);
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .fs-pane-head {
      border-bottom: 1px solid color-mix(in srgb, var(--text-muted) 15%, transparent);
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .fs-tree-scroll,
    .fs-main-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 8px;
    }

    .fs-tree-row {
      border: none;
      width: 100%;
      min-height: 30px;
      border-radius: 8px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      text-align: left;
      padding: 0 8px;
    }

    .fs-tree-row:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .fs-tree-row.active {
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--text-primary);
    }

    .fs-tree-toggle {
      width: 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 10px;
      flex-shrink: 0;
    }

    .fs-tree-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .fs-toolbar {
      display: grid;
      grid-template-columns: auto auto auto minmax(160px, 1fr) auto auto auto auto;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }

    .fs-breadcrumb {
      border: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
      border-radius: 8px;
      min-height: 32px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      overflow: auto;
      white-space: nowrap;
      background: var(--bg-primary);
      color: var(--text-secondary);
      font-size: 12px;
    }

    .fs-crumb {
      border: none;
      background: transparent;
      color: inherit;
      font-size: 12px;
      border-radius: 6px;
      padding: 2px 6px;
    }

    .fs-crumb:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .fs-header-row {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) 100px 100px 160px;
      gap: 10px;
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      padding: 0 8px 8px;
      border-bottom: 1px solid color-mix(in srgb, var(--text-muted) 14%, transparent);
      margin-bottom: 8px;
    }

    .fs-row {
      border: none;
      width: 100%;
      min-height: 36px;
      border-radius: 8px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) 100px 100px 160px;
      gap: 10px;
      align-items: center;
      text-align: left;
      padding: 0 8px;
      margin-bottom: 2px;
    }

    .fs-row:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .fs-row.active {
      background: color-mix(in srgb, var(--accent) 13%, transparent);
      color: var(--text-primary);
    }

    .fs-cell-name {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .fs-icon {
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      flex-shrink: 0;
      text-align: center;
    }

    .fs-preview {
      border-top: 1px solid color-mix(in srgb, var(--text-muted) 14%, transparent);
      padding: 8px;
      display: grid;
      gap: 8px;
      min-height: 180px;
    }

    .fs-preview-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .fs-preview-body {
      border: 1px solid color-mix(in srgb, var(--text-muted) 16%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-primary) 95%, transparent);
      min-height: 120px;
      max-height: 260px;
      overflow: auto;
      padding: 8px;
      font-size: 12px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .fs-empty {
      color: var(--text-muted);
      font-size: 12px;
      padding: 14px 8px;
      text-align: center;
    }

    @media (max-width: 1020px) {
      .shell {
        padding: 14px;
      }

      .grid {
        grid-template-columns: 1fr;
      }

      .card-title {
        font-size: 20px;
      }

      .title {
        font-size: 46px;
      }

      .form-grid,
      .inline-row,
      .overview-grid {
        grid-template-columns: 1fr;
      }

      .check-grid {
        grid-template-columns: 1fr;
      }

      .fs-layout {
        grid-template-columns: 1fr;
      }

      .fs-toolbar {
        grid-template-columns: 1fr 1fr;
      }

      .fs-header-row,
      .fs-row {
        grid-template-columns: minmax(0, 1fr) 80px 80px 120px;
      }
    }
  `

  connectedCallback() {
    super.connectedCallback()
    this.startPolling()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.stopPolling()
    this.teardownTerminal()
  }

  private startPolling() {
    this.stopPolling()
    void this.refreshAll()
    this.pollTimer = setInterval(() => {
      void this.refreshAll()
    }, 2000)
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  private get selectedBox(): BoxResource | null {
    if (!this.selectedBoxId) return null
    return this.boxes.find((box) => box.boxId === this.selectedBoxId) || null
  }

  private get filteredBoxes(): BoxResource[] {
    const needle = this.query.trim().toLowerCase()
    if (!needle) return this.boxes
    return this.boxes.filter((box) => {
      const text = [box.name || '', box.boxId, box.status, box.image, box.durability].join(' ').toLowerCase()
      return text.includes(needle)
    })
  }

  private isSystemActor(): boolean {
    return api.getSandboxActorIdentity().actorType === 'system'
  }

  private isReadOnly(box: BoxResource): boolean {
    const actor = api.getSandboxActorIdentity()
    if (actor.actorType === 'system' || actor.actorType === 'human') return false
    return box._dune.readOnly || box._dune.managedByAgent
  }

  private canMutate(box: BoxResource): boolean {
    return !this.isReadOnly(box)
  }

  private formatUpdated(ts: number | null): string {
    if (!ts) return 'Unknown'
    const delta = Date.now() - ts
    if (delta < 60_000) return 'just now'
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
    return `${Math.floor(delta / 86_400_000)}d ago`
  }

  private formatDate(ts: number | null): string {
    if (!ts) return 'n/a'
    return new Date(ts).toLocaleString()
  }

  private closeDetails = () => {
    this.selectedBoxId = null
    this.execs = []
    this.selectedExecId = null
    this.execEvents = []
    this.execError = ''
    this.updateError = ''
    this.fileError = ''
    this.fileInfo = ''
    this.detailTab = 'overview'
    this.fsInitializedBoxId = null
    this.resetFsExplorerState()
    this.teardownTerminal()
  }

  private selectBox(boxId: string) {
    this.selectedBoxId = boxId
    this.detailTab = 'overview'
    this.execError = ''
    this.fileError = ''
    this.fileInfo = ''
    this.terminalError = ''
    this.execs = []
    this.selectedExecId = null
    this.execEvents = []
    this.fsInitializedBoxId = null
    this.resetFsExplorerState()

    const box = this.boxes.find((entry) => entry.boxId === boxId)
    if (box) {
      this.updateName = box.name || ''
      this.updateDurability = box.durability
    }

    this.teardownTerminal()
    void this.refreshExecData()
  }

  private async refreshAll() {
    if (this.refreshInFlight) return
    this.refreshInFlight = true
    this.loading = this.boxes.length === 0

    try {
      const response = await api.listBoxes()
      this.boxes = response.boxes
      this.errorMessage = ''

      if (this.selectedBoxId && !this.boxes.find((box) => box.boxId === this.selectedBoxId)) {
        this.closeDetails()
      }

      if (this.selectedBoxId) {
        await this.refreshExecData()
      }
    } catch (err: any) {
      this.errorMessage = err?.message || 'Failed to load sandboxes'
    } finally {
      this.loading = false
      this.refreshInFlight = false
    }
  }

  private openCreate() {
    this.createOpen = true
    this.createError = ''
    this.createName = ''
    this.createDurability = 'persistent'
    this.createAutoRemove = false
    this.createImage = 'ghcr.io/boxlite-ai/boxlite-skillbox:0.1.0'
    this.createWorkingDir = '/workspace'
    this.createCpu = 2
    this.createMemoryMib = 2048
    this.createDiskGb = 10
    this.createGuestPort = 3000
    this.createShareAgents = new Set<string>()
    this.createHostImportPath = ''
    this.createHostImportDest = '/workspace'
  }

  private closeCreate() {
    if (this.creating) return
    this.createOpen = false
  }

  private toggleShareAgent(agentId: string, checked: boolean) {
    const next = new Set(this.createShareAgents)
    if (checked) next.add(agentId)
    else next.delete(agentId)
    this.createShareAgents = next
  }

  private async handleCreateSandbox() {
    if (this.creating) return
    this.creating = true
    this.createError = ''

    const acl = Array.from(this.createShareAgents).flatMap((agentId) => ([
      { principalType: 'agent' as const, principalId: agentId, permission: 'read' as const },
      { principalType: 'agent' as const, principalId: agentId, permission: 'operate' as const },
    ]))

    const payload: BoxCreateRequest = {
      name: this.createName.trim() || undefined,
      image: this.createImage.trim() || undefined,
      durability: this.createDurability,
      autoRemove: this.createAutoRemove,
      cpus: Number(this.createCpu) || 1,
      memoryMib: Number(this.createMemoryMib) || 512,
      diskSizeGb: Number(this.createDiskGb) || 10,
      workingDir: this.createWorkingDir.trim() || undefined,
      ports: this.createGuestPort > 0
        ? [{ guestPort: Number(this.createGuestPort), protocol: 'tcp' }]
        : [],
      acl,
    }

    try {
      const created = await api.createBox(payload)

      if (this.createHostImportPath.trim()) {
        const req: HostImportRequest = {
          hostPath: this.createHostImportPath.trim(),
          destPath: this.createHostImportDest.trim() || '/workspace',
        }
        await api.importHostPathToBox(created.boxId, req)
      }

      this.createOpen = false
      await this.refreshAll()
      this.selectBox(created.boxId)
    } catch (err: any) {
      this.createError = err?.message || 'Failed to create sandbox'
    } finally {
      this.creating = false
    }
  }

  private async handleSaveOverview() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return
    this.updateError = ''

    try {
      await api.patchBox(box.boxId, {
        name: this.updateName.trim() || '',
        durability: this.updateDurability,
      })
      await this.refreshAll()
    } catch (err: any) {
      this.updateError = err?.message || 'Failed to update sandbox'
    }
  }

  private async handleStartBox() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return
    this.updateError = ''
    try {
      await api.startBox(box.boxId)
      await this.refreshAll()
    } catch (err: any) {
      this.updateError = err?.message || 'Failed to start sandbox'
    }
  }

  private async handleStopBox() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return
    this.updateError = ''
    try {
      await api.stopBox(box.boxId)
      await this.refreshAll()
    } catch (err: any) {
      this.updateError = err?.message || 'Failed to stop sandbox'
    }
  }

  private async handleDeleteBox() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return
    if (!confirm(`Delete sandbox "${box.name || box.boxId}"?`)) return
    this.updateError = ''

    try {
      await api.deleteBox(box.boxId, true)
      this.closeDetails()
      await this.refreshAll()
    } catch (err: any) {
      this.updateError = err?.message || 'Failed to delete sandbox'
    }
  }

  private async refreshExecData(resetEvents = false) {
    const box = this.selectedBox
    if (!box) return
    try {
      const result = await api.listExecs(box.boxId)
      this.execs = result.execs

      if (!this.selectedExecId && this.execs.length > 0) {
        this.selectedExecId = this.execs[0].executionId
        resetEvents = true
      }

      if (this.selectedExecId) {
        const afterSeq = resetEvents || this.execEvents.length === 0
          ? 0
          : this.execEvents[this.execEvents.length - 1].seq
        const events = await api.getExecEvents(box.boxId, this.selectedExecId, afterSeq, 500)

        if (afterSeq === 0) {
          this.execEvents = events
        } else if (events.length > 0) {
          this.execEvents = [...this.execEvents, ...events]
        }
      }

      this.execError = ''
    } catch (err: any) {
      this.execError = err?.message || 'Failed to load executions'
    }
  }

  private async handleRunExec() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return

    const command = this.execCommand.trim()
    if (!command) return

    this.execRunning = true
    this.execError = ''
    try {
      const created = await api.createExec(box.boxId, {
        command: 'bash',
        args: ['-lc', command],
      })
      this.selectedExecId = created.executionId
      this.execEvents = []
      await this.refreshExecData(true)
    } catch (err: any) {
      this.execError = err?.message || 'Failed to run command'
    } finally {
      this.execRunning = false
    }
  }

  private async handleUploadFile() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return
    this.fileError = ''
    this.fileInfo = ''

    try {
      await api.uploadFiles(box.boxId, {
        path: this.fileUploadPath,
        contentBase64: toBase64(this.fileUploadContent),
        overwrite: true,
      })
      this.fileInfo = `Uploaded ${this.fileUploadPath}`
    } catch (err: any) {
      this.fileError = err?.message || 'Failed to upload file'
    }
  }

  private async handleDownloadFile() {
    const box = this.selectedBox
    if (!box) return
    this.fileError = ''
    this.fileInfo = ''

    try {
      const downloaded = await api.downloadFile(box.boxId, this.fileDownloadPath)
      this.fileDownloadResult = downloaded
      this.fileInfo = `Downloaded ${downloaded.path} (${downloaded.size} bytes)`
    } catch (err: any) {
      this.fileError = err?.message || 'Failed to download file'
      this.fileDownloadResult = null
    }
  }

  private async handleHostImport() {
    const box = this.selectedBox
    if (!box || !this.canMutate(box)) return
    this.fileError = ''
    this.fileInfo = ''

    try {
      await api.importHostPathToBox(box.boxId, {
        hostPath: this.hostImportPath,
        destPath: this.hostImportDest,
      })
      this.fileInfo = `Imported ${this.hostImportPath} -> ${this.hostImportDest}`
    } catch (err: any) {
      this.fileError = err?.message || 'Failed to import host path'
    }
  }

  private normalizeFsPath(path: string): string {
    const trimmed = path.trim() || '/'
    if (!trimmed.startsWith('/')) return `/${trimmed}`
    return trimmed === '/' ? '/' : trimmed.replace(/\/+$/, '')
  }

  private fsName(path: string): string {
    const normalized = this.normalizeFsPath(path)
    if (normalized === '/') return '/'
    return normalized.split('/').pop() || normalized
  }

  private fsParent(path: string): string | null {
    const normalized = this.normalizeFsPath(path)
    if (normalized === '/') return null
    const segments = normalized.split('/').filter(Boolean)
    if (segments.length <= 1) return '/'
    return `/${segments.slice(0, -1).join('/')}`
  }

  private fsPathChain(path: string): string[] {
    const normalized = this.normalizeFsPath(path)
    if (normalized === '/') return ['/']
    const out = ['/']
    const parts = normalized.split('/').filter(Boolean)
    let cursor = ''
    for (const part of parts) {
      cursor = `${cursor}/${part}`
      out.push(cursor)
    }
    return out
  }

  private withFsNodes(mutator: (next: Map<string, FsTreeNode>) => void) {
    const next = new Map(this.fsNodes)
    mutator(next)
    this.fsNodes = next
  }

  private ensureFsNode(path: string) {
    const normalized = this.normalizeFsPath(path)
    if (this.fsNodes.has(normalized)) return
    this.withFsNodes((next) => {
      next.set(normalized, {
        path: normalized,
        name: this.fsName(normalized),
        loaded: false,
        loading: false,
        expanded: normalized === '/',
        error: '',
        children: [],
      })
    })
  }

  private resetFsExplorerState() {
    this.fsCurrentPath = '/workspace'
    this.fsEntries = []
    this.fsSelectedPath = null
    this.fsIncludeHidden = false
    this.fsSearch = ''
    this.fsLoading = false
    this.fsPreview = null
    this.fsPreviewText = ''
    this.fsPreviewError = ''
    this.fsActionError = ''
    this.fsActionInfo = ''
    this.fsDialogMode = null
    this.fsDialogPrimaryPath = ''
    this.fsDialogSecondaryPath = ''
    this.fsDialogContent = ''
    this.fsActionBusy = false
    this.fsNodes = new Map()
    this.ensureFsNode('/')
  }

  private async loadFsNode(path: string): Promise<void> {
    const box = this.selectedBox
    if (!box) return
    const normalized = this.normalizeFsPath(path)
    this.ensureFsNode(normalized)
    this.withFsNodes((next) => {
      const node = next.get(normalized)
      if (!node) return
      node.loading = true
      node.error = ''
    })
    try {
      const result = await api.listSandboxFs(box.boxId, normalized, {
        includeHidden: this.fsIncludeHidden,
        limit: 2000,
      })
      const childDirs = result.entries
        .filter((entry) => entry.type === 'directory')
        .map((entry) => this.normalizeFsPath(entry.path))
        .sort((a, b) => a.localeCompare(b))

      this.withFsNodes((next) => {
        const node = next.get(normalized)
        if (!node) return
        node.loading = false
        node.loaded = true
        node.children = childDirs
        for (const childPath of childDirs) {
          if (!next.has(childPath)) {
            next.set(childPath, {
              path: childPath,
              name: this.fsName(childPath),
              loaded: false,
              loading: false,
              expanded: false,
              error: '',
              children: [],
            })
          }
        }
      })
    } catch (err: any) {
      this.withFsNodes((next) => {
        const node = next.get(normalized)
        if (!node) return
        node.loading = false
        node.error = err?.message || 'Failed to load folder tree'
      })
    }
  }

  private async ensureFsTreePath(path: string) {
    const chain = this.fsPathChain(path)
    for (let i = 0; i < chain.length; i += 1) {
      const current = chain[i]
      this.ensureFsNode(current)
      this.withFsNodes((next) => {
        const node = next.get(current)
        if (!node) return
        node.expanded = true
      })
      if (i < chain.length - 1) {
        const node = this.fsNodes.get(current)
        if (!node?.loaded && !node?.loading) {
          // eslint-disable-next-line no-await-in-loop
          await this.loadFsNode(current)
        }
      }
    }
  }

  private async loadFsPath(path: string): Promise<void> {
    const box = this.selectedBox
    if (!box) return
    const normalized = this.normalizeFsPath(path)
    this.fsLoading = true
    this.fsActionError = ''
    try {
      const result = await api.listSandboxFs(box.boxId, normalized, {
        includeHidden: this.fsIncludeHidden,
        limit: 2000,
      })
      this.fsCurrentPath = result.path
      this.fsEntries = result.entries
      this.fsSelectedPath = null
      this.fsPreview = null
      this.fsPreviewText = ''
      this.fsPreviewError = ''
      await this.ensureFsTreePath(result.path)
      await this.loadFsNode(result.path)
    } finally {
      this.fsLoading = false
    }
  }

  private async ensureFsInitialized(force = false) {
    const box = this.selectedBox
    if (!box) return
    if (!force && this.fsInitializedBoxId === box.boxId) return
    this.fsInitializedBoxId = box.boxId
    this.resetFsExplorerState()
    try {
      await this.loadFsPath('/workspace')
    } catch (err: any) {
      if (err?.message === 'path_not_found' || err?.message === 'not_directory') {
        await this.loadFsPath('/')
      } else {
        this.fsActionError = err?.message || 'Failed to initialize file browser'
      }
    }
  }

  private get filteredFsEntries(): SandboxFsEntry[] {
    const needle = this.fsSearch.trim().toLowerCase()
    if (!needle) return this.fsEntries
    return this.fsEntries.filter((entry) => `${entry.name} ${entry.path}`.toLowerCase().includes(needle))
  }

  private get selectedFsEntry(): SandboxFsEntry | null {
    if (!this.fsSelectedPath) return null
    return this.fsEntries.find((entry) => entry.path === this.fsSelectedPath) || null
  }

  private isTextPreview(path: string, mimeType: string | null): boolean {
    if (mimeType?.startsWith('text/')) return true
    if (mimeType && [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-sh',
      'application/x-yaml',
      'application/yaml',
    ].includes(mimeType)) return true
    return /\.(txt|md|json|yaml|yml|toml|ini|cfg|conf|ts|tsx|js|jsx|css|html|sh|py|go|rs|java|sql|xml)$/i.test(path)
  }

  private async loadFsPreview(path: string) {
    const box = this.selectedBox
    if (!box) return
    this.fsPreviewError = ''
    try {
      const preview = await api.readSandboxFsFile(box.boxId, path, 1024 * 1024)
      this.fsPreview = preview
      if (this.isTextPreview(path, preview.mimeType)) {
        try {
          this.fsPreviewText = fromBase64(preview.contentBase64)
        } catch {
          this.fsPreviewText = '[binary file]'
        }
      } else {
        this.fsPreviewText = `[binary file] ${preview.size} bytes`
      }
    } catch (err: any) {
      this.fsPreview = null
      this.fsPreviewText = ''
      this.fsPreviewError = err?.message || 'Failed to load file preview'
    }
  }

  private async handleFsSelectEntry(entry: SandboxFsEntry) {
    this.fsSelectedPath = entry.path
    if (entry.type === 'file') {
      await this.loadFsPreview(entry.path)
    } else {
      this.fsPreview = null
      this.fsPreviewText = ''
      this.fsPreviewError = ''
    }
  }

  private async handleFsOpenEntry(entry: SandboxFsEntry) {
    if (entry.type === 'directory') {
      await this.loadFsPath(entry.path)
      return
    }
    await this.handleFsSelectEntry(entry)
  }

  private async handleFsTreeNavigate(path: string) {
    await this.loadFsPath(path)
  }

  private async handleFsToggleNode(path: string) {
    this.ensureFsNode(path)
    const node = this.fsNodes.get(path)
    const nextExpanded = !node?.expanded
    this.withFsNodes((next) => {
      const target = next.get(path)
      if (!target) return
      target.expanded = nextExpanded
    })
    if (nextExpanded) {
      const refreshed = this.fsNodes.get(path)
      if (!refreshed?.loaded && !refreshed?.loading) {
        await this.loadFsNode(path)
      }
    }
  }

  private async handleFsGoUp() {
    const parent = this.fsParent(this.fsCurrentPath)
    if (!parent) return
    await this.loadFsPath(parent)
  }

  private async handleFsRefresh() {
    await this.loadFsPath(this.fsCurrentPath)
  }

  private async handleFsToggleHidden(event: Event) {
    this.fsIncludeHidden = (event.target as HTMLInputElement).checked
    this.fsNodes = new Map()
    this.ensureFsNode('/')
    await this.loadFsPath(this.fsCurrentPath)
  }

  private fsPathToBreadcrumb(path: string): Array<{ label: string; path: string }> {
    const chain = this.fsPathChain(path)
    return chain.map((entry) => ({
      label: entry === '/' ? '/' : this.fsName(entry),
      path: entry,
    }))
  }

  private base64ToBytes(value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  private async handleFsDownloadSelected() {
    const box = this.selectedBox
    const selected = this.selectedFsEntry
    if (!box || !selected || selected.type !== 'file') return
    try {
      const file = await api.downloadFile(box.boxId, selected.path)
      const blob = new Blob([this.base64ToBytes(file.contentBase64)], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = selected.name
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      this.fsActionInfo = `Downloaded ${selected.path}`
      this.fsActionError = ''
    } catch (err: any) {
      this.fsActionError = err?.message || 'Failed to download file'
      this.fsActionInfo = ''
    }
  }

  private openFsDialog(mode: FsDialogMode) {
    const selected = this.selectedFsEntry
    this.fsDialogMode = mode
    this.fsActionError = ''
    this.fsActionInfo = ''
    this.fsDialogContent = ''
    if (mode === 'upload' || mode === 'new-file') {
      this.fsDialogPrimaryPath = selected?.type === 'directory'
        ? `${selected.path}/new-file.txt`
        : `${this.fsCurrentPath}/new-file.txt`
      this.fsDialogContent = ''
    } else if (mode === 'new-folder') {
      this.fsDialogPrimaryPath = selected?.type === 'directory'
        ? `${selected.path}/new-folder`
        : `${this.fsCurrentPath}/new-folder`
    } else if (mode === 'rename') {
      this.fsDialogPrimaryPath = selected?.path || ''
      this.fsDialogSecondaryPath = selected?.path
        ? `${this.fsParent(selected.path) || '/'}${this.fsParent(selected.path) === '/' ? '' : '/'}renamed-${selected.name}`
        : ''
    } else if (mode === 'import-host') {
      this.fsDialogPrimaryPath = ''
      this.fsDialogSecondaryPath = this.fsCurrentPath
    }
  }

  private closeFsDialog() {
    if (this.fsActionBusy) return
    this.fsDialogMode = null
  }

  private async submitFsDialog() {
    const box = this.selectedBox
    if (!box || !this.fsDialogMode) return
    this.fsActionBusy = true
    this.fsActionError = ''
    this.fsActionInfo = ''
    try {
      if (this.fsDialogMode === 'upload' || this.fsDialogMode === 'new-file') {
        await api.uploadFiles(box.boxId, {
          path: this.normalizeFsPath(this.fsDialogPrimaryPath),
          contentBase64: toBase64(this.fsDialogContent),
          overwrite: true,
        })
        this.fsActionInfo = `Saved ${this.normalizeFsPath(this.fsDialogPrimaryPath)}`
      } else if (this.fsDialogMode === 'new-folder') {
        await api.mkdirSandboxFsPath(box.boxId, {
          path: this.normalizeFsPath(this.fsDialogPrimaryPath),
          recursive: true,
        })
        this.fsActionInfo = `Created folder ${this.normalizeFsPath(this.fsDialogPrimaryPath)}`
      } else if (this.fsDialogMode === 'rename') {
        await api.moveSandboxFsPath(box.boxId, {
          fromPath: this.normalizeFsPath(this.fsDialogPrimaryPath),
          toPath: this.normalizeFsPath(this.fsDialogSecondaryPath),
          overwrite: false,
        })
        this.fsActionInfo = `Renamed ${this.normalizeFsPath(this.fsDialogPrimaryPath)}`
      } else if (this.fsDialogMode === 'import-host') {
        await api.importHostPathToBox(box.boxId, {
          hostPath: this.fsDialogPrimaryPath.trim(),
          destPath: this.normalizeFsPath(this.fsDialogSecondaryPath || this.fsCurrentPath),
        })
        this.fsActionInfo = `Imported host path into ${this.normalizeFsPath(this.fsDialogSecondaryPath || this.fsCurrentPath)}`
      }
      this.fsDialogMode = null
      await this.loadFsPath(this.fsCurrentPath)
    } catch (err: any) {
      this.fsActionError = err?.message || 'Filesystem action failed'
    } finally {
      this.fsActionBusy = false
    }
  }

  private async handleFsDeleteSelected() {
    const box = this.selectedBox
    const selected = this.selectedFsEntry
    if (!box || !selected) return
    if (!confirm(`Delete "${selected.path}"?`)) return
    this.fsActionError = ''
    this.fsActionInfo = ''
    try {
      await api.deleteSandboxFsPath(box.boxId, selected.path, false)
      this.fsActionInfo = `Deleted ${selected.path}`
      await this.loadFsPath(this.fsCurrentPath)
      return
    } catch (err: any) {
      if (err?.message === 'dir_not_empty') {
        if (!confirm(`"${selected.path}" is not empty. Delete recursively?`)) return
        try {
          await api.deleteSandboxFsPath(box.boxId, selected.path, true)
          this.fsActionInfo = `Deleted ${selected.path} recursively`
          await this.loadFsPath(this.fsCurrentPath)
          return
        } catch (errRecursive: any) {
          this.fsActionError = errRecursive?.message || 'Failed to delete recursively'
          return
        }
      }
      this.fsActionError = err?.message || 'Failed to delete path'
    }
  }

  private async handleFilesTabEnter() {
    await this.ensureFsInitialized()
  }

  private teardownTerminal() {
    if (this.terminalSocket) {
      try { this.terminalSocket.close() } catch {}
      this.terminalSocket = null
    }
    if (this.terminalInstance) {
      this.terminalInstance.dispose()
      this.terminalInstance = null
    }
    this.terminalFitAddon = null
    this.terminalConnected = false
  }

  private handleTerminalConnect() {
    const box = this.selectedBox
    if (!box) return

    this.teardownTerminal()
    this.terminalError = ''

    try {
      const ws = api.terminalBoxWs(box.boxId)
      this.terminalSocket = ws

      ws.onopen = () => {
        this.terminalConnected = true
        this.requestUpdate()

        requestAnimationFrame(() => {
          const container = this.shadowRoot?.querySelector('#terminal-container') as HTMLElement | null
          if (!container) return

          const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
            theme: {
              background: '#1a1a2e',
              foreground: '#e0e0e0',
              cursor: '#e0e0e0',
              selectionBackground: '#3a3a5e',
            },
          })
          const fitAddon = new FitAddon()
          term.loadAddon(fitAddon)
          term.loadAddon(new WebLinksAddon())

          term.open(container)
          fitAddon.fit()

          this.terminalInstance = term
          this.terminalFitAddon = fitAddon

          term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data)
            }
          })

          term.onResize(({ cols, rows }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            }
          })

          const resizeObserver = new ResizeObserver(() => {
            try { fitAddon.fit() } catch {}
          })
          resizeObserver.observe(container)
        })
      }

      ws.onmessage = (event) => {
        if (this.terminalInstance) {
          if (typeof event.data === 'string') {
            this.terminalInstance.write(event.data)
          } else if (event.data instanceof Blob) {
            event.data.text().then((text: string) => {
              this.terminalInstance?.write(text)
            })
          }
        }
      }

      ws.onclose = () => {
        this.terminalConnected = false
        if (this.terminalInstance) {
          this.terminalInstance.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
        }
        this.terminalSocket = null
        this.requestUpdate()
      }

      ws.onerror = () => {
        this.terminalError = 'Terminal websocket error'
        this.terminalConnected = false
        this.requestUpdate()
      }
    } catch (err: any) {
      this.terminalError = err?.message || 'Failed to connect terminal'
    }
  }

  private renderCard(box: BoxResource) {
    const readOnly = this.isReadOnly(box)
    const title = box.name || box.boxId.slice(0, 8)

    return html`
      <article
        class="card"
        data-testid="sandbox-card"
        data-box-id=${box.boxId}
        tabindex="0"
        role="button"
        aria-label=${`Open sandbox ${title}`}
        @click=${() => this.selectBox(box.boxId)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            this.selectBox(box.boxId)
          }
        }}
      >
        <span class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5l9 5v9l-9 5-9-5v-9l9-5z" stroke-linejoin="round"></path>
            <path d="M12 21.5v-9M3 7.5l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </span>
        <div class="card-main">
          <div class="card-title">${title}</div>
          <div class="card-sub">${box.image}</div>
          <div class="meta">
            <span class="chip ${box.status}">${box.status}</span>
            <span class="chip">${box.durability}</span>
            ${readOnly ? html`<span class="chip readonly">read only</span>` : ''}
            <span>Updated ${this.formatUpdated(box.updatedAt)}</span>
          </div>
        </div>
        <button class="action" type="button" title="Open sandbox" @click=${(e: Event) => {
          e.stopPropagation()
          this.selectBox(box.boxId)
        }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12h16M12 4v16" stroke-linecap="round"></path>
          </svg>
        </button>
      </article>
    `
  }

  private renderOverviewTab(box: BoxResource) {
    const readOnly = this.isReadOnly(box)

    return html`
      <section class="panel">
        <div class="panel-title">Overview</div>
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-key">Box ID</div>
            <div class="overview-value">${box.boxId}</div>
          </div>
          <div class="overview-item">
            <div class="overview-key">Status</div>
            <div class="overview-value">${box.status}</div>
          </div>
          <div class="overview-item">
            <div class="overview-key">Durability</div>
            <div class="overview-value">${box.durability}</div>
          </div>
          <div class="overview-item">
            <div class="overview-key">Image</div>
            <div class="overview-value">${box.image}</div>
          </div>
          <div class="overview-item">
            <div class="overview-key">Started</div>
            <div class="overview-value">${this.formatDate(box.startedAt)}</div>
          </div>
          <div class="overview-item">
            <div class="overview-key">Stopped</div>
            <div class="overview-value">${this.formatDate(box.stoppedAt)}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">Edit</div>
        ${this.updateError ? html`<div class="error">${this.updateError}</div>` : ''}
        <label class="field">
          <span class="label">Name</span>
          <input class="input" .value=${this.updateName} @input=${(e: Event) => {
            this.updateName = (e.target as HTMLInputElement).value
          }} ?disabled=${readOnly} />
        </label>
        <label class="field">
          <span class="label">Durability</span>
          <select class="select" .value=${this.updateDurability} @change=${(e: Event) => {
            this.updateDurability = (e.target as HTMLSelectElement).value as SandboxDurability
          }} ?disabled=${readOnly}>
            <option value="persistent">persistent</option>
            <option value="ephemeral">ephemeral</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click=${this.handleSaveOverview} ?disabled=${readOnly}>Save changes</button>
        </div>
      </section>
    `
  }

  private renderExecsTab(box: BoxResource) {
    const readOnly = this.isReadOnly(box)

    return html`
      <section class="panel">
        <div class="panel-title">Run Command</div>
        ${this.execError ? html`<div class="error">${this.execError}</div>` : ''}
        <label class="field">
          <span class="label">Command</span>
          <input
            class="input"
            .value=${this.execCommand}
            @input=${(e: Event) => { this.execCommand = (e.target as HTMLInputElement).value }}
            placeholder="pnpm test"
            ?disabled=${readOnly}
          />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click=${this.handleRunExec} ?disabled=${readOnly || this.execRunning}>Run</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">Executions</div>
        ${this.execs.length === 0
          ? html`<div class="meta-text">No executions yet.</div>`
          : html`<div class="exec-list">
              ${this.execs.map((exec) => html`
                <button
                  class="exec-row ${this.selectedExecId === exec.executionId ? 'active' : ''}"
                  type="button"
                  @click=${() => {
                    this.selectedExecId = exec.executionId
                    this.execEvents = []
                    void this.refreshExecData(true)
                  }}
                >
                  <div class="exec-command">${exec.command} ${exec.args.join(' ')}</div>
                  <div class="exec-status">${exec.status}</div>
                </button>
              `)}
            </div>`}
      </section>

      <section class="panel">
        <div class="panel-title">Events</div>
        <div class="log">${this.execEvents.length > 0
          ? this.execEvents.map((event) => `[${event.seq}] ${event.eventType}: ${event.data}`).join('\n')
          : 'No events yet.'}</div>
      </section>
    `
  }

  private renderFsEntryRow(entry: SandboxFsEntry) {
    return html`
      <button
        class="fs-row ${this.fsSelectedPath === entry.path ? 'active' : ''}"
        data-testid="fs-row"
        data-path=${entry.path}
        type="button"
        @click=${() => { void this.handleFsSelectEntry(entry) }}
        @dblclick=${() => { void this.handleFsOpenEntry(entry) }}
      >
        <span class="fs-cell-name" title=${entry.path}>
          <span class="fs-icon">${entry.type === 'directory' ? 'D' : entry.type === 'file' ? 'F' : '•'}</span>
          <span>${entry.name}</span>
        </span>
        <span>${entry.type}</span>
        <span>${entry.size == null ? '-' : `${entry.size}`}</span>
        <span>${entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '-'}</span>
      </button>
    `
  }

  private renderFsTreeNode(path: string, depth = 0): unknown {
    const node = this.fsNodes.get(path)
    if (!node) return ''
    const isActive = this.fsCurrentPath === path
    const hasChildren = node.children.length > 0
    const showToggle = node.loading || hasChildren || !node.loaded

    return html`
      <div>
        <button
          class="fs-tree-row ${isActive ? 'active' : ''}"
          data-testid="fs-tree-row"
          data-path=${path}
          type="button"
          style=${`padding-left:${6 + depth * 14}px;`}
          @click=${() => { void this.handleFsTreeNavigate(path) }}
          @dblclick=${() => { void this.handleFsToggleNode(path) }}
          title=${path}
        >
          <span class="fs-tree-toggle">
            ${showToggle ? (node.loading ? '…' : node.expanded ? '▾' : '▸') : ''}
          </span>
          <span class="fs-tree-name">${node.name}</span>
        </button>
        ${node.error ? html`<div class="meta-text" style=${`padding-left:${20 + depth * 14}px;`}>${node.error}</div>` : ''}
        ${node.expanded
          ? node.children.map((childPath) => this.renderFsTreeNode(childPath, depth + 1))
          : ''}
      </div>
    `
  }

  private renderFsDialog(readOnly: boolean): unknown {
    if (!this.fsDialogMode) return ''
    const title = this.fsDialogMode === 'upload'
      ? 'Upload File'
      : this.fsDialogMode === 'new-file'
        ? 'Create File'
        : this.fsDialogMode === 'new-folder'
          ? 'Create Folder'
          : this.fsDialogMode === 'rename'
            ? 'Rename Path'
            : 'Import Host Path'

    const submitLabel = this.fsDialogMode === 'rename'
      ? 'Rename'
      : this.fsDialogMode === 'new-folder'
        ? 'Create'
        : this.fsDialogMode === 'import-host'
          ? 'Import'
          : 'Save'

    const primaryLabel = this.fsDialogMode === 'import-host' ? 'Host Path' : 'Path'
    const secondaryLabel = this.fsDialogMode === 'rename' ? 'New Path' : 'Destination Path'
    const needsSecondary = this.fsDialogMode === 'rename' || this.fsDialogMode === 'import-host'
    const needsContent = this.fsDialogMode === 'upload' || this.fsDialogMode === 'new-file'
    const disableSubmit = readOnly || this.fsActionBusy || !this.fsDialogPrimaryPath.trim()
      || (needsSecondary && !this.fsDialogSecondaryPath.trim())

    return html`
      <div class="overlay" data-testid="fs-dialog-overlay" @click=${this.closeFsDialog}>
        <div class="modal" data-testid="fs-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modal-title">${title}</div>
          ${this.fsActionError ? html`<div class="error" data-testid="fs-action-error">${this.fsActionError}</div>` : ''}
          <label class="field">
            <span class="label">${primaryLabel}</span>
            <input
              class="input"
              data-testid="fs-dialog-primary"
              .value=${this.fsDialogPrimaryPath}
              @input=${(e: Event) => { this.fsDialogPrimaryPath = (e.target as HTMLInputElement).value }}
              ?disabled=${readOnly || this.fsActionBusy}
            />
          </label>
          ${needsSecondary ? html`
            <label class="field">
              <span class="label">${secondaryLabel}</span>
              <input
                class="input"
                data-testid="fs-dialog-secondary"
                .value=${this.fsDialogSecondaryPath}
                @input=${(e: Event) => { this.fsDialogSecondaryPath = (e.target as HTMLInputElement).value }}
                ?disabled=${readOnly || this.fsActionBusy}
              />
            </label>
          ` : ''}
          ${needsContent ? html`
            <label class="field">
              <span class="label">Content</span>
              <textarea
                class="textarea"
                data-testid="fs-dialog-content"
                .value=${this.fsDialogContent}
                @input=${(e: Event) => { this.fsDialogContent = (e.target as HTMLTextAreaElement).value }}
                ?disabled=${readOnly || this.fsActionBusy}
              ></textarea>
            </label>
          ` : ''}
          <div class="modal-actions">
            <button class="btn muted" data-testid="fs-dialog-cancel" type="button" @click=${this.closeFsDialog} ?disabled=${this.fsActionBusy}>Cancel</button>
            <button class="btn primary" data-testid="fs-dialog-submit" type="button" @click=${this.submitFsDialog} ?disabled=${disableSubmit}>${submitLabel}</button>
          </div>
        </div>
      </div>
    `
  }

  private renderFilesTab(box: BoxResource) {
    const readOnly = this.isReadOnly(box)
    const selected = this.selectedFsEntry
    const breadcrumbs = this.fsPathToBreadcrumb(this.fsCurrentPath)
    const entries = this.filteredFsEntries
    const previewHeadline = this.fsPreview
      ? `${this.fsPreview.path} (${this.fsPreview.size} bytes${this.fsPreview.truncated ? ', preview truncated' : ''})`
      : selected
        ? `${selected.path}${selected.type !== 'file' ? ' (directory)' : ''}`
        : 'No file selected'

    return html`
      <section class="panel" data-testid="sandbox-files-explorer">
        <div class="panel-title">Files Explorer</div>
        ${this.fsActionError ? html`<div class="error" data-testid="fs-action-error">${this.fsActionError}</div>` : ''}
        ${this.fsActionInfo ? html`<div class="meta-text" data-testid="fs-action-info">${this.fsActionInfo}</div>` : ''}

        <div class="fs-toolbar">
          <button class="btn muted" data-testid="fs-up-btn" type="button" @click=${this.handleFsGoUp} ?disabled=${this.fsLoading || this.fsCurrentPath === '/'}>Up</button>
          <button class="btn muted" data-testid="fs-refresh-btn" type="button" @click=${this.handleFsRefresh} ?disabled=${this.fsLoading}>Refresh</button>
          <button class="btn muted" data-testid="fs-download-btn" type="button" @click=${this.handleFsDownloadSelected} ?disabled=${!selected || selected.type !== 'file'}>Download</button>
          <label class="field" style="margin:0;">
            <input class="input" data-testid="fs-search-input" .value=${this.fsSearch} @input=${(e: Event) => { this.fsSearch = (e.target as HTMLInputElement).value }} placeholder="Search current folder" />
          </label>
          <label class="check-item">
            <input data-testid="fs-hidden-toggle" type="checkbox" .checked=${this.fsIncludeHidden} @change=${this.handleFsToggleHidden} />
            <span>Hidden</span>
          </label>
          <select class="select" data-testid="fs-actions-select" @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value
            ;(e.target as HTMLSelectElement).value = ''
            if (value === 'upload') this.openFsDialog('upload')
            if (value === 'new-file') this.openFsDialog('new-file')
            if (value === 'new-folder') this.openFsDialog('new-folder')
            if (value === 'rename') this.openFsDialog('rename')
            if (value === 'import-host') this.openFsDialog('import-host')
          }} ?disabled=${readOnly}>
            <option value="">Actions</option>
            <option value="upload">Upload file</option>
            <option value="new-file">Create file</option>
            <option value="new-folder">Create folder</option>
            <option value="rename">Rename selected</option>
            <option value="import-host">Import host path</option>
          </select>
          <button class="btn warn" data-testid="fs-delete-btn" type="button" @click=${this.handleFsDeleteSelected} ?disabled=${readOnly || !selected}>Delete</button>
          <div class="fs-breadcrumb" data-testid="fs-breadcrumb">
            ${breadcrumbs.map((crumb) => html`
              <button
                class="fs-crumb"
                data-testid="fs-breadcrumb-crumb"
                data-path=${crumb.path}
                type="button"
                @click=${() => { void this.loadFsPath(crumb.path) }}
              >${crumb.label}</button>
            `)}
          </div>
        </div>

        <div class="fs-layout">
          <div class="fs-pane">
            <div class="fs-pane-head">
              <span class="meta-text">Folders</span>
              <button class="btn muted" type="button" @click=${() => { void this.loadFsNode(this.fsCurrentPath) }} ?disabled=${this.fsLoading}>Expand</button>
            </div>
            <div class="fs-tree-scroll">
              ${this.renderFsTreeNode('/')}
            </div>
          </div>

          <div class="fs-pane">
            <div class="fs-pane-head">
              <span class="meta-text">${this.fsCurrentPath}</span>
              <span class="meta-text">${entries.length} item${entries.length === 1 ? '' : 's'}</span>
            </div>
            <div class="fs-main-scroll">
              <div class="fs-header-row">
                <span>Name</span>
                <span>Type</span>
                <span>Size</span>
                <span>Modified</span>
              </div>
              ${entries.length === 0
                ? html`<div class="fs-empty">${this.fsLoading ? 'Loading files...' : 'This folder is empty.'}</div>`
                : entries.length > 120
                  ? virtualize({
                      items: entries,
                      renderItem: (entry: SandboxFsEntry) => this.renderFsEntryRow(entry),
                    })
                  : entries.map((entry) => this.renderFsEntryRow(entry))}
            </div>
            <div class="fs-preview">
              <div class="fs-preview-head" data-testid="fs-preview-head">
                <span>${previewHeadline}</span>
                ${selected?.type === 'file'
                  ? html`<button class="btn muted" type="button" @click=${() => { void this.loadFsPreview(selected.path) }}>Reload preview</button>`
                  : ''}
              </div>
              ${this.fsPreviewError
                ? html`<div class="error">${this.fsPreviewError}</div>`
                : html`<div class="fs-preview-body" data-testid="fs-preview-body">${this.fsPreviewText || 'Select a file to preview its content.'}</div>`}
            </div>
          </div>
        </div>
      </section>
      ${this.renderFsDialog(readOnly)}
    `
  }

  private renderTerminalTab(box: BoxResource) {
    return html`
      <section class="panel" style="display:flex;flex-direction:column;height:100%;min-height:400px;">
        <div class="panel-title">Terminal</div>
        ${this.terminalError ? html`<div class="error">${this.terminalError}</div>` : ''}
        <div class="modal-actions" style="justify-content:flex-start;margin-bottom:8px;">
          ${this.terminalConnected
            ? html`<button class="btn muted" type="button" @click=${() => this.teardownTerminal()}>Disconnect</button>`
            : html`<button class="btn primary" type="button" @click=${this.handleTerminalConnect}>Connect</button>`}
        </div>
        <div id="terminal-container" style="flex:1;min-height:300px;background:#1a1a2e;border-radius:6px;overflow:hidden;"></div>
      </section>
    `
  }

  render() {
    const selected = this.selectedBox
    const filtered = this.filteredBoxes

    return html`
      <div class="shell">
        <div class="page">
          <div class="toolbar">
            <button class="refresh-btn" type="button" @click=${this.refreshAll} ?disabled=${this.loading}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
              <span>Refresh</span>
            </button>
            <label class="search-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" stroke-linecap="round"></path>
              </svg>
              <input class="search" type="search" .value=${this.query} @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value }} placeholder="Search sandboxes" />
            </label>
            <button class="new-btn" type="button" @click=${this.openCreate}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke-linecap="round"></path>
              </svg>
              <span>New sandbox</span>
            </button>
          </div>

          <header class="heading">
            <h1 class="title">Sandboxes</h1>
            <p class="subtitle">Manage sandbox runtimes. <a href="https://docs.boxlite.ai/boxrun" target="_blank" rel="noopener noreferrer">Learn more</a></p>
          </header>

          ${this.errorMessage ? html`<div class="error">${this.errorMessage}</div>` : ''}

          ${filtered.length === 0
            ? html`<div class="empty">${this.loading ? 'Loading sandboxes...' : 'No sandboxes yet.'}</div>`
            : html`<div class="grid">${filtered.map((box) => this.renderCard(box))}</div>`}
        </div>
      </div>

      ${this.createOpen ? html`
        <div class="overlay" @click=${this.closeCreate}>
          <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal-title">New Sandbox</div>
            ${this.createError ? html`<div class="error">${this.createError}</div>` : ''}

            <div class="form-grid">
              <label class="field full">
                <span class="label">Name</span>
                <input class="input" .value=${this.createName} @input=${(e: Event) => { this.createName = (e.target as HTMLInputElement).value }} placeholder="Optional" />
              </label>

              <label class="field full">
                <span class="label">Image</span>
                <input class="input" .value=${this.createImage} @input=${(e: Event) => { this.createImage = (e.target as HTMLInputElement).value }} />
              </label>

              <label class="field">
                <span class="label">Durability</span>
                <select class="select" .value=${this.createDurability} @change=${(e: Event) => { this.createDurability = (e.target as HTMLSelectElement).value as SandboxDurability }}>
                  <option value="persistent">persistent</option>
                  <option value="ephemeral">ephemeral</option>
                </select>
              </label>

              <label class="field">
                <span class="label">Working Dir</span>
                <input class="input" .value=${this.createWorkingDir} @input=${(e: Event) => { this.createWorkingDir = (e.target as HTMLInputElement).value }} />
              </label>

              <div class="field full">
                <span class="label">CPU / Memory MiB / Disk GB</span>
                <div class="inline-row">
                  <input class="input" type="number" min="1" .value=${String(this.createCpu)} @input=${(e: Event) => { this.createCpu = Number((e.target as HTMLInputElement).value) }} />
                  <input class="input" type="number" min="128" .value=${String(this.createMemoryMib)} @input=${(e: Event) => { this.createMemoryMib = Number((e.target as HTMLInputElement).value) }} />
                  <input class="input" type="number" min="1" .value=${String(this.createDiskGb)} @input=${(e: Event) => { this.createDiskGb = Number((e.target as HTMLInputElement).value) }} />
                </div>
              </div>

              <label class="field">
                <span class="label">Expose Guest Port</span>
                <input class="input" type="number" min="1" .value=${String(this.createGuestPort)} @input=${(e: Event) => { this.createGuestPort = Number((e.target as HTMLInputElement).value) }} />
              </label>

              <label class="field">
                <span class="label">Auto Remove</span>
                <select class="select" .value=${this.createAutoRemove ? 'true' : 'false'} @change=${(e: Event) => { this.createAutoRemove = (e.target as HTMLSelectElement).value === 'true' }}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </label>

              <div class="field full">
                <span class="label">Share With Agents</span>
                <div class="check-grid">
                  ${this.agents.length === 0
                    ? html`<div class="meta-text">No agents available.</div>`
                    : this.agents.map((agent) => html`
                        <label class="check-item">
                          <input type="checkbox" .checked=${this.createShareAgents.has(agent.id)} @change=${(e: Event) => this.toggleShareAgent(agent.id, (e.target as HTMLInputElement).checked)} />
                          <span>${agent.name}</span>
                        </label>
                      `)}
                </div>
              </div>

              <label class="field full">
                <span class="label">Import Host Path (Optional)</span>
                <input class="input" .value=${this.createHostImportPath} @input=${(e: Event) => { this.createHostImportPath = (e.target as HTMLInputElement).value }} placeholder="/absolute/path/on/backend/host" />
              </label>

              <label class="field full">
                <span class="label">Import Destination</span>
                <input class="input" .value=${this.createHostImportDest} @input=${(e: Event) => { this.createHostImportDest = (e.target as HTMLInputElement).value }} placeholder="/workspace" />
              </label>
            </div>

            <div class="modal-actions">
              <button class="btn muted" type="button" @click=${this.closeCreate} ?disabled=${this.creating}>Cancel</button>
              <button class="btn primary" type="button" @click=${this.handleCreateSandbox} ?disabled=${this.creating}>Create sandbox</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${selected ? html`
        <div class="overlay" data-testid="sandbox-detail-overlay" @click=${this.closeDetails}>
          <div class="detail" data-testid="sandbox-detail-modal" @click=${(e: Event) => e.stopPropagation()}>
            <div class="detail-head">
              <div>
                <div class="detail-title">${selected.name || selected.boxId.slice(0, 8)}</div>
                <div class="detail-sub">${selected.boxId} · ${selected.image}</div>
              </div>

              <div class="detail-actions">
                <span class="chip ${selected.status}">${selected.status}</span>
                <span class="chip">${selected.durability}</span>
                ${this.isReadOnly(selected) ? html`<span class="chip readonly">read only</span>` : ''}
                <button class="btn muted" type="button" @click=${this.handleStartBox} ?disabled=${!this.canMutate(selected) || selected.status === 'running'}>Start</button>
                <button class="btn muted" type="button" @click=${this.handleStopBox} ?disabled=${!this.canMutate(selected) || selected.status !== 'running'}>Stop</button>
                <button class="btn warn" type="button" @click=${this.handleDeleteBox} ?disabled=${!this.canMutate(selected)}>Delete</button>
                <button class="btn muted" type="button" @click=${this.closeDetails}>Close</button>
              </div>
            </div>

            <div class="tabs">
              <button class="tab ${this.detailTab === 'overview' ? 'active' : ''}" type="button" @click=${() => { this.detailTab = 'overview' }}>Overview</button>
              <button class="tab ${this.detailTab === 'execs' ? 'active' : ''}" type="button" @click=${() => { this.detailTab = 'execs'; void this.refreshExecData(true) }}>Execs</button>
              <button class="tab ${this.detailTab === 'files' ? 'active' : ''}" data-testid="sandbox-tab-files" type="button" @click=${() => { this.detailTab = 'files'; void this.handleFilesTabEnter() }}>Files</button>
              <button class="tab ${this.detailTab === 'terminal' ? 'active' : ''}" type="button" @click=${() => { this.detailTab = 'terminal' }}>Terminal</button>
            </div>

            <div class="detail-body">
              ${this.detailTab === 'overview' ? this.renderOverviewTab(selected) : ''}
              ${this.detailTab === 'execs' ? this.renderExecsTab(selected) : ''}
              ${this.detailTab === 'files' ? this.renderFilesTab(selected) : ''}
              ${this.detailTab === 'terminal' ? this.renderTerminalTab(selected) : ''}
            </div>
          </div>
        </div>
      ` : ''}
    `
  }
}
