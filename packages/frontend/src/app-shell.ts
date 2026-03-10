import { LitElement, html, css } from 'lit'
import { customElement, query as queryEl } from 'lit/decorators.js'
import { state } from './state/app-state.js'
import { uiPreferences, type ThemeMode } from './state/ui-preferences.js'
import * as api from './services/api-client.js'
import { WsClient } from './services/ws-client.js'
import type { ClaudeSettings, HostCommandRequest, SelectedModelProvider } from '@dune/shared'
import type { CreateAgentDialog } from './components/agents/create-agent-dialog.js'
import type { CreateChannelDialog } from './components/channels/create-channel-dialog.js'
import type { ChannelMembersDialog } from './components/channels/channel-members-dialog.js'
import type { ChannelDetailsPanel } from './components/channels/channel-details-panel.js'
import './components/apps/apps-view.js'

const ADMIN_USER_ID = 'admin'
type SettingsSection = 'general' | 'model'

@customElement('app-shell')
export class AppShell extends LitElement {
  private ws!: WsClient

  @queryEl('create-agent-dialog') agentDialog!: CreateAgentDialog
  @queryEl('create-channel-dialog') channelDialog!: CreateChannelDialog
  @queryEl('channel-members-dialog') membersDialog!: ChannelMembersDialog
  @queryEl('channel-details-panel') detailsPanel!: ChannelDetailsPanel

  private subscriberCount = 0
  private detailsChannelId: string | null = null
  private activeSurface: 'chat' | 'settings' | 'sandboxes' | 'apps' = 'chat'
  private readonly appOpenErrors = new Map<string, string>()
  private dmStatusTokenSeq = 0
  private readonly dmOptimisticStatusTokens = new Map<string, number>()
  private workspaceSyncInFlight: Promise<void> | null = null
  private workspaceSyncQueued = false
  private readonly logLoadPromises = new Map<string, Promise<void>>()
  private readonly logsLoadingAgentIds = new Set<string>()
  private readonly logsLoadingOlderAgentIds = new Set<string>()
  private readonly hostCommandDecisionLoadingIds = new Set<string>()
  private hostApprovalModalOpen = false
  private hostApprovalConfirmRequestId: string | null = null
  private selectedModelProvider: SelectedModelProvider | null = null
  private settingsInitialSection: SettingsSection = 'general'
  private readonly stateChangeHandler = () => this.requestUpdate()
  private readonly uiPreferenceChangeHandler = () => this.requestUpdate()

  static styles = css`
    :host {
      display: block;
      height: 100vh;
      background: var(--app-canvas);
      color: var(--text-primary);
    }

    .app {
      display: grid;
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
      height: 100%;
      min-height: 0;
      background: var(--bg-primary);
    }

    .app.collapsed {
      grid-template-columns: var(--sidebar-width-collapsed) minmax(0, 1fr);
    }

    .app.settings-mode {
      grid-template-columns: minmax(0, 1fr);
    }

    .sidebar-wrap {
      min-height: 0;
      background: var(--sidebar-bg);
      position: relative;
      isolation: isolate;
    }

    .sidebar-wrap::after {
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

    .content-wrap {
      min-height: 0;
      background: var(--bg-primary);
      border-radius: 0;
    }

    sidebar-panel {
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }

    message-area,
    agent-chat-view,
    settings-view,
    sandboxes-view,
    apps-view {
      min-height: 0;
      height: 100%;
      border-radius: 0;
      border: none;
      box-shadow: none;
      background: var(--bg-primary);
      overflow: hidden;
    }

    .host-approvals-fab {
      position: fixed;
      right: 18px;
      bottom: 18px;
      border: none;
      border-radius: var(--radius-sm);
      min-height: 36px;
      padding: 0 12px;
      background: var(--accent);
      color: #fff;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      box-shadow: var(--shadow-lg);
      z-index: 40;
    }

    .host-approvals-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      display: grid;
      place-items: center;
      z-index: 50;
    }

    .host-approvals-modal {
      width: min(920px, 92vw);
      max-height: min(80vh, 720px);
      overflow: auto;
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-lg);
      padding: 14px;
      display: grid;
      gap: 12px;
    }

    .host-approvals-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .host-approvals-title {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
    }

    .host-approvals-list {
      display: grid;
      gap: 10px;
    }

    .host-approvals-item {
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .host-approvals-meta {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
    }

    .host-approvals-command {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: var(--radius-sm);
      background: var(--bg-hover);
      padding: 8px;
      color: var(--text-primary);
    }

    .host-approvals-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .host-approvals-btn {
      border: none;
      border-radius: var(--radius-sm);
      min-height: 32px;
      padding: 0 10px;
      background: var(--bg-hover);
      color: var(--text-primary);
      font-size: var(--text-secondary-size);
      font-weight: 600;
    }

    .host-approvals-btn.primary {
      background: var(--accent);
      color: #fff;
    }

    .host-approvals-btn.danger {
      background: color-mix(in srgb, var(--error) 18%, var(--bg-hover));
      color: var(--text-primary);
    }

    .host-approvals-help {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
    }

    @media (max-width: 767px) {
      .app,
      .app.settings-mode,
      .app.collapsed {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(188px, 34vh) minmax(0, 1fr);
      }

      .sidebar-wrap::after {
        display: none;
      }

      .host-approvals-fab {
        right: 12px;
        bottom: 12px;
      }
    }
  `

  connectedCallback() {
    super.connectedCallback()
    uiPreferences.init()
    state.addEventListener('change', this.stateChangeHandler)
    uiPreferences.addEventListener('change', this.uiPreferenceChangeHandler)
    this.initApp()
  }

  private async initApp() {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${location.host}/ws`
    this.ws = new WsClient(wsUrl)
    state.ws = this.ws

    this.ws.on('message:new', (payload) => {
      state.addMessage(payload)
    })

    this.ws.on('message:update', (payload) => {
      state.updateMessage(payload.id, payload.content, payload.isStreaming)
    })

    this.ws.on('agent:status', (payload) => {
      this.dmOptimisticStatusTokens.delete(payload.agentId)
      state.updateAgentStatus(payload.agentId, payload.status)
    })

    this.ws.on('agent:typing', (payload) => {
      state.setTyping(payload.channelId, payload.agentId, payload.isTyping)
    })

    this.ws.on('agent:log', (payload) => {
      state.appendAgentLogs(payload.agentId, payload.entries)
    })

    this.ws.on('agent:screen', (payload) => {
      state.setAgentScreen(payload.agentId, payload)
    })

    this.ws.on('workspace:invalidate', () => {
      this.queueWorkspaceSync('ws-invalidate')
    })

    this.ws.on('ws:reconnect', () => {
      this.queueWorkspaceSync('ws-reconnect')
      void this.loadPendingHostCommandRequests()
    })

    this.ws.on('host-command:pending', (payload: HostCommandRequest) => {
      state.upsertHostCommandRequest(payload)
      if (payload.status === 'pending') {
        this.hostApprovalModalOpen = true
        this.requestUpdate()
      }
    })

    this.ws.on('host-command:updated', (payload: HostCommandRequest) => {
      state.upsertHostCommandRequest(payload)
      this.syncHostApprovalModalVisibilityFromPendingCount()
      if (payload.requestId === this.hostApprovalConfirmRequestId && payload.status !== 'pending') {
        this.hostApprovalConfirmRequestId = null
      }
    })

    await this.syncWorkspaceData('initial-load')
    await this.loadPendingHostCommandRequests()
  }

  private queueWorkspaceSync(trigger: string) {
    void this.syncWorkspaceData(trigger)
  }

  private async syncWorkspaceData(trigger: string): Promise<void> {
    if (this.workspaceSyncInFlight) {
      this.workspaceSyncQueued = true
      return this.workspaceSyncInFlight
    }

    this.workspaceSyncInFlight = (async () => {
      do {
        this.workspaceSyncQueued = false
        await this.runWorkspaceSync(trigger)
      } while (this.workspaceSyncQueued)
    })().finally(() => {
      this.workspaceSyncInFlight = null
    })

    return this.workspaceSyncInFlight
  }

  private async runWorkspaceSync(trigger: string): Promise<void> {
    const previousSelectedChannelId = state.selectedChannelId

    try {
      const [channels, agents, settingsSummary] = await Promise.all([
        api.listChannels(),
        api.listAgents(),
        api.getClaudeSettings().catch((err) => {
          console.error('Failed to load workspace settings:', err)
          return null
        }),
      ])
      if (settingsSummary) {
        this.selectedModelProvider = settingsSummary.selectedModelProvider
      }
      state.setChannels(channels)
      state.setAgents(agents)
      this.requestUpdate()

      if (this.detailsChannelId && !channels.some(channel => channel.id === this.detailsChannelId)) {
        this.detailsChannelId = null
        this.requestUpdate()
      }

      if (!state.selectedAgentId && !state.selectedChannelId && channels.length > 0) {
        await this.selectChannel(channels[0].id)
        return
      }

      if (state.selectedChannelId) {
        const needsReselect = state.selectedChannelId !== previousSelectedChannelId
          || !state.messages.has(state.selectedChannelId)
        if (needsReselect) {
          await this.selectChannel(state.selectedChannelId)
        }
      } else if (previousSelectedChannelId) {
        this.ws?.unsubscribeChannel(previousSelectedChannelId)
        this.subscriberCount = 0
        this.requestUpdate()
      }
    } catch (e) {
      console.error(`Failed to sync workspace data (${trigger}):`, e)
    }
  }

  private syncHostApprovalModalVisibilityFromPendingCount(): void {
    if (state.pendingHostCommands.length === 0) {
      this.hostApprovalModalOpen = false
      this.hostApprovalConfirmRequestId = null
    }
  }

  private formatHostCommand(request: HostCommandRequest): string {
    const argsPart = request.args.map((arg) => JSON.stringify(arg)).join(' ')
    return [request.command, argsPart].filter(Boolean).join(' ')
  }

  private async loadPendingHostCommandRequests(): Promise<void> {
    try {
      const response = await api.listPendingHostCommandRequestsAdmin()
      state.setPendingHostCommands(response.requests)
      this.syncHostApprovalModalVisibilityFromPendingCount()
      if (response.requests.length === 0 && this.hostApprovalConfirmRequestId) {
        this.hostApprovalConfirmRequestId = null
      }
    } catch (err) {
      console.error('Failed to load pending host commands:', err)
    }
  }

  private openHostApprovalsModal() {
    this.hostApprovalModalOpen = true
    this.requestUpdate()
  }

  private closeHostApprovalsModal() {
    this.hostApprovalModalOpen = false
    this.hostApprovalConfirmRequestId = null
    this.requestUpdate()
  }

  private async decideHostCommand(request: HostCommandRequest, decision: 'approve' | 'reject') {
    if (this.hostCommandDecisionLoadingIds.has(request.requestId)) return

    if (decision === 'approve' && request.scope === 'full-host' && this.hostApprovalConfirmRequestId !== request.requestId) {
      this.hostApprovalConfirmRequestId = request.requestId
      this.requestUpdate()
      return
    }

    this.hostCommandDecisionLoadingIds.add(request.requestId)
    this.requestUpdate()
    try {
      await api.decideHostCommandRequestAdmin(request.requestId, {
        decision,
        elevatedConfirmed: decision === 'approve' ? request.scope === 'full-host' : false,
      })
      this.hostApprovalConfirmRequestId = null
    } catch (err) {
      console.error(`Failed to ${decision} host command request:`, err)
    } finally {
      this.hostCommandDecisionLoadingIds.delete(request.requestId)
      await this.loadPendingHostCommandRequests()
      this.requestUpdate()
    }
  }

  private appErrorKey(agentId: string, slug: string): string {
    return `${agentId}:${slug}`
  }

  private async selectChannel(channelId: string) {
    if (state.selectedChannelId) {
      this.ws?.unsubscribeChannel(state.selectedChannelId)
    }
    this.activeSurface = 'chat'
    state.selectChannel(channelId)
    this.ws?.subscribeChannel(channelId)

    if (!state.messages.has(channelId)) {
      try {
        const messages = await api.getChannelMessages(channelId)
        state.setMessages(channelId, messages)
      } catch (e) {
        console.error('Failed to load messages:', e)
      }
    }

    try {
      const subs = await api.getChannelSubscribers(channelId)
      this.subscriberCount = subs.length
      this.requestUpdate()
    } catch (e) {
      this.subscriberCount = 0
    }
  }

  private async selectAgent(agentId: string) {
    this.activeSurface = 'chat'
    state.selectAgent(agentId)
    await this.ensureAgentLogsLoaded(agentId)
  }

  private async ensureAgentLogsLoaded(agentId: string): Promise<void> {
    if (state.hasAgentLogs(agentId)) return
    const existing = this.logLoadPromises.get(agentId)
    if (existing) {
      await existing
      return
    }

    this.logsLoadingAgentIds.add(agentId)
    this.requestUpdate()
    const loadPromise = (async () => {
      try {
        const page = await api.getAgentLogs(agentId)
        state.setAgentLogsPage(agentId, page.entries, page.nextBeforeSeq)
      } catch (e) {
        console.error('Failed to load agent logs:', e)
      }
    })().finally(() => {
      this.logLoadPromises.delete(agentId)
      this.logsLoadingAgentIds.delete(agentId)
      this.requestUpdate()
    })

    this.logLoadPromises.set(agentId, loadPromise)
    await loadPromise
  }

  private async loadOlderAgentLogs(agentId: string): Promise<void> {
    const beforeSeq = state.getAgentLogsNextBeforeSeq(agentId)
    if (beforeSeq == null || this.logsLoadingOlderAgentIds.has(agentId)) return

    this.logsLoadingOlderAgentIds.add(agentId)
    this.requestUpdate()
    try {
      const page = await api.getAgentLogs(agentId, { beforeSeq })
      state.prependAgentLogs(agentId, page.entries, page.nextBeforeSeq)
    } catch (e) {
      console.error('Failed to load older agent logs:', e)
    } finally {
      this.logsLoadingOlderAgentIds.delete(agentId)
      this.requestUpdate()
    }
  }

  private async handleCreateChannel(e: CustomEvent) {
    try {
      const channel = await api.createChannel(e.detail)
      state.addChannel(channel)
      this.channelDialog?.close()
      await this.selectChannel(channel.id)
      this.queueWorkspaceSync('crud-success:create-channel')
    } catch (err: any) {
      const msg = err?.message?.includes('409') ? 'A channel with that name already exists' : 'Failed to create channel'
      this.channelDialog?.showError(msg)
      this.queueWorkspaceSync('crud-error-recover:create-channel')
    }
  }

  private async handleCreateAgent(e: CustomEvent) {
    try {
      const agent = await api.createAgent(e.detail)
      state.addAgent(agent)
      state.updateAgentStatus(agent.id, 'starting')
      await api.startAgent(agent.id)
      // Backend broadcasts agent:status 'idle' via WS when truly ready
      if (state.selectedChannelId) {
        await api.subscribeAgentToChannel(state.selectedChannelId, agent.id)
      }
      this.queueWorkspaceSync('crud-success:create-agent')
    } catch (e) {
      console.error('Failed to create agent:', e)
      this.queueWorkspaceSync('crud-error-recover:create-agent')
    }
  }

  private async handleToggleAgent(e: CustomEvent) {
    const agentId = e.detail as string
    const agent = state.agents.find(a => a.id === agentId)
    if (!agent) return
    try {
      if (agent.status === 'stopped') {
        state.updateAgentStatus(agentId, 'starting')
        await api.startAgent(agentId)
        // Backend broadcasts agent:status 'idle' via WS when truly ready
      } else {
        await api.stopAgent(agentId)
        state.updateAgentStatus(agentId, 'stopped')
      }
    } catch (e) {
      console.error('Failed to toggle agent:', e)
      // Backend broadcasts error status via WS, but as a fallback ensure UI isn't stuck
      if (agent.status === 'stopped') {
        // Start failed — backend will broadcast 'error', but refresh to be safe
        this.queueWorkspaceSync('crud-error-recover:toggle-agent')
      }
    }
  }

  private async handleCancelStart(e: CustomEvent) {
    const agentId = e.detail as string
    try {
      await api.cancelAgentStart(agentId)
      // Backend broadcasts agent:status 'stopped' via WS on cancellation
    } catch (e) {
      console.error('Failed to cancel agent start:', e)
    }
  }

  private handleManageMembers(e: CustomEvent) {
    const channelId = e.detail as string
    this.membersDialog?.open(channelId)
  }

  private handleMembersChanged(e: CustomEvent) {
    const { count } = e.detail
    this.subscriberCount = count
    this.requestUpdate()
  }

  private handleOpenProfile(e: CustomEvent) {
    const agentId = e.detail as string
    if (agentId === 'admin' || agentId === 'system') return
    state.openProfile(agentId)
    void this.ensureAgentLogsLoaded(agentId)
  }

  private handleCloseProfile() {
    state.closeProfile()
  }

  private handleSettingsSaved(e: CustomEvent<ClaudeSettings>) {
    this.selectedModelProvider = e.detail.selectedModelProvider
    this.requestUpdate()
  }

  private handleLoadAgentLogsOlder(e: CustomEvent) {
    const agentId = e.detail as string
    void this.loadOlderAgentLogs(agentId)
  }

  private async handleLoadAgentScreen(e: CustomEvent) {
    const agentId = e.detail as string
    try {
      const screen = await api.getAgentScreen(agentId)
      state.setAgentScreen(agentId, screen)
    } catch (e) {
      console.error('Failed to load agent screen:', e)
    }
  }

  private handleAgentUpdated(e: CustomEvent) {
    state.updateAgent(e.detail)
  }

  private async handleDeleteAgent(e: CustomEvent) {
    const agentId = e.detail as string
    try {
      await api.deleteAgent(agentId)
      for (const key of this.appOpenErrors.keys()) {
        if (key.startsWith(`${agentId}:`)) this.appOpenErrors.delete(key)
      }
      state.removeAgent(agentId)
      this.queueWorkspaceSync('crud-success:delete-agent')
    } catch (e) {
      console.error('Failed to delete agent:', e)
      this.queueWorkspaceSync('crud-error-recover:delete-agent')
    }
  }

  private handleOpenChannelDetails(e: CustomEvent) {
    const channelId = e.detail as string
    this.detailsChannelId = channelId
    this.requestUpdate()
  }

  private handleCloseDetails() {
    this.detailsChannelId = null
    this.requestUpdate()
  }

  private async handleChannelUpdated(e: CustomEvent) {
    const { id, data } = e.detail
    try {
      const updated = await api.updateChannel(id, data)
      state.updateChannel(id, updated)
    } catch (err) {
      console.error('Failed to update channel:', err)
    }
  }

  private async handleChannelDeleted(e: CustomEvent) {
    const channelId = e.detail as string
    try {
      await api.deleteChannel(channelId)
      this.detailsChannelId = null
      state.removeChannel(channelId)
      // Select the new first channel if needed
      if (state.selectedChannelId && state.selectedChannelId !== channelId) {
        // Already on a different channel
      } else if (state.channels.length > 0) {
        await this.selectChannel(state.channels[0].id)
      }
      this.queueWorkspaceSync('crud-success:delete-channel')
    } catch (err) {
      console.error('Failed to delete channel:', err)
      this.queueWorkspaceSync('crud-error-recover:delete-channel')
    }
  }

  private handleChannelContextAction(e: CustomEvent) {
    const { channelId, action } = e.detail
    if (action === 'details') {
      this.detailsChannelId = channelId
      this.requestUpdate()
    } else if (action === 'delete') {
      const ch = state.channels.find(c => c.id === channelId)
      if (!ch) return
      if (!confirm(`Delete channel "#${ch.name}"? All messages will be lost.`)) return
      this.handleChannelDeleted(new CustomEvent('channel-deleted', { detail: channelId }))
    }
  }

  private async handleSendMessage(e: CustomEvent) {
    const { channelId, content } = e.detail
    try {
      await api.sendMessage(channelId, ADMIN_USER_ID, content)
    } catch (e) {
      console.error('Failed to send message:', e)
    }
  }

  private async handleSendDm(e: CustomEvent) {
    const { agentId, content } = e.detail
    const previousStatus = state.agents.find(a => a.id === agentId)?.status
    const token = ++this.dmStatusTokenSeq
    this.dmOptimisticStatusTokens.set(agentId, token)
    state.updateAgentStatus(agentId, 'thinking')
    try {
      await api.sendDirectMessage(agentId, content)
    } catch (e) {
      if (this.dmOptimisticStatusTokens.get(agentId) === token && previousStatus) {
        state.updateAgentStatus(agentId, previousStatus)
      }
      console.error('Failed to send DM:', e)
    } finally {
      if (this.dmOptimisticStatusTokens.get(agentId) === token) {
        this.dmOptimisticStatusTokens.delete(agentId)
      }
    }
  }

  private async openMiniapp(agentId: string, slug: string) {
    const agent = state.agents.find(a => a.id === agentId)
    if (!agent) return
    this.appOpenErrors.delete(this.appErrorKey(agentId, slug))

    state.openMiniappWindow({
      agentId,
      agentName: agent.name,
      slug,
      appName: slug,
      url: '',
      loading: true,
      error: null,
    })

    try {
      const opened = await api.openAgentApp(agentId, slug)
      this.appOpenErrors.delete(this.appErrorKey(agentId, slug))
      state.openMiniappWindow({
        agentId,
        agentName: agent.name,
        slug: opened.app.slug,
        appName: opened.app.name,
        url: opened.url,
        loading: false,
        error: null,
      })
    } catch (err: any) {
      this.appOpenErrors.set(this.appErrorKey(agentId, slug), err.message || 'Failed to open miniapp')
      state.closeMiniappWindow()
      this.requestUpdate()
    }
  }

  private async handleOpenMiniapp(e: CustomEvent<{ slug: string; agentId?: string }>) {
    const agentId = e.detail.agentId || state.selectedAgentId
    if (!agentId) return
    await this.openMiniapp(agentId, e.detail.slug)
  }

  private handleCloseMiniappWindow() {
    state.closeMiniappWindow()
  }

  private async handleReloadMiniappWindow() {
    const win = state.miniappWindow
    if (!win) return
    await this.openMiniapp(win.agentId, win.slug)
  }

  private async handleRestartReloadMiniapp() {
    const win = state.miniappWindow
    if (!win) return
    try {
      const agent = state.agents.find(a => a.id === win.agentId)
      if (agent?.status === 'stopped' || agent?.status === 'error') {
        await api.startAgent(win.agentId)
      }
    } catch (err) {
      state.patchMiniappWindow({ loading: false, error: 'Failed to restart agent' })
      return
    }
    await this.openMiniapp(win.agentId, win.slug)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    state.removeEventListener('change', this.stateChangeHandler)
    uiPreferences.removeEventListener('change', this.uiPreferenceChangeHandler)
    uiPreferences.destroy()
    this.ws?.destroy()
  }

  private handleOpenSettings(e?: CustomEvent<{ section?: SettingsSection }>) {
    this.settingsInitialSection = e?.detail?.section ?? 'general'
    this.activeSurface = 'settings'
    this.requestUpdate()
  }

  private handleOpenSandboxes() {
    this.activeSurface = 'sandboxes'
    this.requestUpdate()
  }

  private async handleOpenApps() {
    this.activeSurface = 'apps'
    this.requestUpdate()
    try {
      const apps = await api.listAllApps()
      state.setAllApps(apps)
    } catch (err) {
      console.error('Failed to load all apps:', err)
    }
  }

  private handleCloseSettings() {
    this.activeSurface = 'chat'
    this.settingsInitialSection = 'general'
    this.requestUpdate()
  }

  private handleThemeModeChange(e: CustomEvent<ThemeMode>) {
    uiPreferences.setThemeMode(e.detail)
  }

  private handleToggleSidebar() {
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    uiPreferences.setSidebarCollapsed(!uiPreferences.sidebarCollapsed)
  }

  private renderChatSurface() {
    if (state.selectedAgent) {
      return html`
        <agent-chat-view
          .agent=${state.selectedAgent}
          .entries=${state.getRecentAgentLogs(state.selectedAgent.id).filter((entry) => entry.type !== 'runtime')}
          .selectedModelProvider=${this.selectedModelProvider}
          @open-miniapp=${this.handleOpenMiniapp}
          @toggle-agent=${this.handleToggleAgent}
          @cancel-start=${this.handleCancelStart}
          @open-agent-profile=${this.handleOpenProfile}
          @open-settings=${this.handleOpenSettings}
          @agent-updated=${this.handleAgentUpdated}
          @send-dm=${this.handleSendDm}
        ></agent-chat-view>
      `
    }

    return html`
      <message-area
        .channel=${state.currentChannel}
        .messages=${state.currentMessages}
        .agents=${state.agents}
        .typingAgentIds=${state.currentTypingAgentIds}
        .subscriberCount=${this.subscriberCount}
        .selectedModelProvider=${this.selectedModelProvider}
        @open-settings=${this.handleOpenSettings}
        @send-message=${this.handleSendMessage}
        @manage-members=${this.handleManageMembers}
        @open-agent-profile=${this.handleOpenProfile}
        @open-channel-details=${this.handleOpenChannelDetails}
      ></message-area>
    `
  }

  private renderActiveSurface() {
    if (this.activeSurface === 'settings') {
      return html`
        <settings-view
          .themeMode=${uiPreferences.themeMode}
          .initialSection=${this.settingsInitialSection}
          @close-settings=${this.handleCloseSettings}
          @settings-saved=${this.handleSettingsSaved}
          @theme-mode-change=${this.handleThemeModeChange}
        ></settings-view>
      `
    }

    if (this.activeSurface === 'sandboxes') {
      return html`
        <sandboxes-view
          .agents=${state.agents}
        ></sandboxes-view>
      `
    }

    if (this.activeSurface === 'apps') {
      return html`
        <apps-view
          .apps=${state.allApps}
          @open-miniapp=${this.handleOpenMiniapp}
        ></apps-view>
      `
    }

    return this.renderChatSurface()
  }

  private renderHostApprovals() {
    const pending = state.pendingHostCommands
    const count = pending.length

    return html`
      ${count > 0
        ? html`
            <button class="host-approvals-fab" type="button" @click=${this.openHostApprovalsModal}>
              Approvals (${count})
            </button>
          `
        : ''}

      ${this.hostApprovalModalOpen
        ? html`
            <div class="host-approvals-overlay" @click=${this.closeHostApprovalsModal}>
              <section class="host-approvals-modal" @click=${(event: Event) => event.stopPropagation()}>
                <div class="host-approvals-head">
                  <div class="host-approvals-title">Pending Host Command Approvals (${count})</div>
                  <button class="host-approvals-btn" type="button" @click=${this.closeHostApprovalsModal}>Close</button>
                </div>
                <div class="host-approvals-list">
                  ${count === 0
                    ? html`<div class="host-approvals-item"><div class="host-approvals-help">No pending requests.</div></div>`
                    : pending.map((request) => {
                      const isLoading = this.hostCommandDecisionLoadingIds.has(request.requestId)
                      const needsFullHostConfirm = request.scope === 'full-host' && this.hostApprovalConfirmRequestId === request.requestId
                      return html`
                        <div class="host-approvals-item">
                          <div class="host-approvals-meta">
                            Request: ${request.requestId} · Agent: ${request.agentId} · Scope: ${request.scope} · CWD: ${request.cwd}
                          </div>
                          <div class="host-approvals-command">${this.formatHostCommand(request)}</div>
                          <div class="host-approvals-actions">
                            <button
                              class="host-approvals-btn danger"
                              type="button"
                              ?disabled=${isLoading}
                              @click=${() => this.decideHostCommand(request, 'reject')}
                            >
                              Reject
                            </button>
                            <button
                              class="host-approvals-btn primary"
                              type="button"
                              ?disabled=${isLoading}
                              @click=${() => this.decideHostCommand(request, 'approve')}
                            >
                              ${needsFullHostConfirm ? 'Confirm Full-Host Approve' : (request.scope === 'full-host' ? 'Approve (Need Confirm)' : 'Approve')}
                            </button>
                            ${needsFullHostConfirm
                              ? html`<span class="host-approvals-help">Second click required for full-host scope.</span>`
                              : ''}
                          </div>
                        </div>
                      `
                    })}
                </div>
              </section>
            </div>
          `
        : ''}
    `
  }

  render() {
    const sidebarCollapsed = uiPreferences.sidebarCollapsed
    const isSettings = this.activeSurface === 'settings'
    const miniappWindow = state.miniappWindow
    const miniappAgent = miniappWindow ? state.agents.find(agent => agent.id === miniappWindow.agentId) : null

    return html`
      <div class="app ${sidebarCollapsed ? 'collapsed' : ''} ${isSettings ? 'settings-mode' : ''}">
        ${isSettings ? '' : html`
          <div class="sidebar-wrap">
            <sidebar-panel
              .channels=${state.channels}
              .agents=${state.agents}
              .selectedChannelId=${state.selectedChannelId}
              .selectedAgentId=${state.selectedAgentId || ''}
              .activeSurface=${this.activeSurface}
              .collapsed=${sidebarCollapsed}
              @select-channel=${(e: CustomEvent) => this.selectChannel(e.detail)}
              @select-agent=${(e: CustomEvent) => this.selectAgent(e.detail)}
              @create-channel=${() => this.channelDialog?.open()}
              @create-agent=${() => this.agentDialog?.open()}
              @open-settings=${this.handleOpenSettings}
              @open-sandboxes=${this.handleOpenSandboxes}
              @open-apps=${this.handleOpenApps}
              @toggle-sidebar=${this.handleToggleSidebar}
              @channel-context-action=${this.handleChannelContextAction}
            ></sidebar-panel>
          </div>
        `}
        <div class="content-wrap">
          ${this.renderActiveSurface()}
        </div>
      </div>

      ${miniappWindow ? html`
        <miniapp-window
          .open=${miniappWindow.open}
          .agentId=${miniappWindow.agentId}
          .agentName=${miniappWindow.agentName}
          .appSlug=${miniappWindow.slug}
          .appName=${miniappWindow.appName}
          .appUrl=${miniappWindow.url}
          .loading=${miniappWindow.loading}
          .errorMessage=${miniappWindow.error || ''}
          .agentStatus=${miniappAgent?.status || 'stopped'}
          @close-miniapp-window=${this.handleCloseMiniappWindow}
          @reload-miniapp-window=${this.handleReloadMiniappWindow}
          @restart-reload-miniapp=${this.handleRestartReloadMiniapp}
        ></miniapp-window>
      ` : ''}

      ${state.profileAgent ? html`
        <agent-profile-panel
          .agent=${state.profileAgent}
          .channels=${state.channels}
          .screen=${state.getAgentScreen(state.profileAgent.id)}
          .logs=${state.getAgentLogs(state.profileAgent.id)}
          .logsLoading=${this.logsLoadingAgentIds.has(state.profileAgent.id)}
          .logsLoadingOlder=${this.logsLoadingOlderAgentIds.has(state.profileAgent.id)}
          .logsHasMore=${state.getAgentLogsNextBeforeSeq(state.profileAgent.id) !== null}
          @toggle-agent=${this.handleToggleAgent}
          @delete-agent=${this.handleDeleteAgent}
          @close-profile=${this.handleCloseProfile}
          @load-agent-logs-older=${this.handleLoadAgentLogsOlder}
          @load-agent-screen=${this.handleLoadAgentScreen}
          @agent-updated=${this.handleAgentUpdated}
        ></agent-profile-panel>
      ` : ''}

      ${this.detailsChannelId ? html`
        <channel-details-panel
          .channel=${state.channels.find(c => c.id === this.detailsChannelId) || null}
          .agents=${state.agents}
          @close-details=${this.handleCloseDetails}
          @channel-updated=${this.handleChannelUpdated}
          @channel-deleted=${this.handleChannelDeleted}
          @members-changed=${this.handleMembersChanged}
        ></channel-details-panel>
      ` : ''}

      ${this.renderHostApprovals()}

      <create-channel-dialog
        @channel-created=${this.handleCreateChannel}
      ></create-channel-dialog>

      <create-agent-dialog
        @agent-created=${this.handleCreateAgent}
      ></create-agent-dialog>

      <channel-members-dialog
        .agents=${state.agents}
        @members-changed=${this.handleMembersChanged}
      ></channel-members-dialog>
    `
  }
}
