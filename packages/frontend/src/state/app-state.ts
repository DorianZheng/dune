import type {
  Agent,
  Channel,
  Message,
  AgentLogEntry,
  AgentStatusType,
  HostCommandRequest,
  MiniApp,
} from '@dune/shared'
import type { WsClient } from '../services/ws-client.js'

export type MiniappWindowState = {
  open: boolean
  agentId: string
  agentName: string
  slug: string
  appName: string
  url: string
  loading: boolean
  error: string | null
}

class AppState extends EventTarget {
  ws: WsClient | null = null
  channels: Channel[] = []
  agents: Agent[] = []
  messages: Map<string, Message[]> = new Map()
  selectedChannelId = ''
  selectedAgentId: string | null = null
  profileAgentId: string | null = null
  typingAgents: Map<string, Set<string>> = new Map()
  agentLogs: Map<string, AgentLogEntry[]> = new Map()
  agentLogsNextBeforeSeq: Map<string, number | null> = new Map()
  agentLogsLoaded: Set<string> = new Set()
  agentScreens: Map<string, { guiHttpPort: number; guiHttpsPort: number; width: number; height: number }> = new Map()
  agentApps: Map<string, MiniApp[]> = new Map()
  allApps: MiniApp[] = []
  miniappWindow: MiniappWindowState | null = null
  pendingHostCommands: HostCommandRequest[] = []

  setChannels(channels: Channel[]) {
    this.channels = channels
    const channelIds = new Set(channels.map(channel => channel.id))

    if (this.selectedChannelId && !channelIds.has(this.selectedChannelId)) {
      this.selectedChannelId = channels.length > 0 ? channels[0].id : ''
    }

    for (const channelId of this.messages.keys()) {
      if (!channelIds.has(channelId)) {
        this.messages.delete(channelId)
      }
    }

    for (const channelId of this.typingAgents.keys()) {
      if (!channelIds.has(channelId)) {
        this.typingAgents.delete(channelId)
      }
    }

    this.emit('change')
  }

  setAgents(agents: Agent[]) {
    this.agents = agents
    const agentIds = new Set(agents.map(agent => agent.id))

    if (this.selectedAgentId && !agentIds.has(this.selectedAgentId)) {
      this.selectedAgentId = null
    }
    if (this.profileAgentId && !agentIds.has(this.profileAgentId)) {
      this.profileAgentId = null
    }
    if (this.miniappWindow && !agentIds.has(this.miniappWindow.agentId)) {
      this.miniappWindow = null
    }

    for (const agentId of this.agentLogs.keys()) {
      if (!agentIds.has(agentId)) {
        this.agentLogs.delete(agentId)
        this.agentLogsNextBeforeSeq.delete(agentId)
        this.agentLogsLoaded.delete(agentId)
      }
    }
    for (const agentId of this.agentScreens.keys()) {
      if (!agentIds.has(agentId)) {
        this.agentScreens.delete(agentId)
      }
    }
    for (const agentId of this.agentApps.keys()) {
      if (!agentIds.has(agentId)) {
        this.agentApps.delete(agentId)
      }
    }

    this.emit('change')
  }

  addChannel(channel: Channel) {
    this.channels = [...this.channels, channel]
    this.emit('change')
  }

  addAgent(agent: Agent) {
    this.agents = [...this.agents, agent]
    this.emit('change')
  }

  updateChannel(id: string, data: Partial<Channel>) {
    this.channels = this.channels.map(c => c.id === id ? { ...c, ...data } : c)
    this.emit('change')
  }

  removeChannel(id: string) {
    this.channels = this.channels.filter(c => c.id !== id)
    this.messages.delete(id)
    if (this.selectedChannelId === id) {
      this.selectedChannelId = this.channels.length > 0 ? this.channels[0].id : ''
    }
    this.emit('change')
  }

  updateAgentStatus(agentId: string, status: AgentStatusType) {
    this.agents = this.agents.map(a => a.id === agentId ? { ...a, status } : a)
    this.emit('change')
  }

  setMessages(channelId: string, messages: Message[]) {
    this.messages.set(channelId, messages)
    this.emit('change')
  }

  addMessage(message: Message) {
    const msgs = this.messages.get(message.channelId) || []
    msgs.push(message)
    this.messages.set(message.channelId, [...msgs])
    this.emit('change')
  }

  updateMessage(id: string, content: string, isStreaming: boolean) {
    for (const [channelId, msgs] of this.messages) {
      const idx = msgs.findIndex(m => m.id === id)
      if (idx !== -1) {
        const updated = [...msgs]
        updated[idx] = { ...updated[idx], content }
        this.messages.set(channelId, updated)
        this.emit('change')
        break
      }
    }
  }

  setTyping(channelId: string, agentId: string, isTyping: boolean) {
    if (!this.typingAgents.has(channelId)) this.typingAgents.set(channelId, new Set())
    const set = this.typingAgents.get(channelId)!
    if (isTyping) set.add(agentId)
    else set.delete(agentId)
    this.emit('change')
  }

  selectChannel(channelId: string) {
    this.selectedChannelId = channelId
    this.selectedAgentId = null
    this.emit('change')
  }

  selectAgent(agentId: string) {
    this.selectedAgentId = agentId
    this.selectedChannelId = ''
    this.emit('change')
  }

  get selectedAgent(): Agent | null {
    if (!this.selectedAgentId) return null
    return this.agents.find(a => a.id === this.selectedAgentId) || null
  }

  get currentMessages(): Message[] {
    return this.messages.get(this.selectedChannelId) || []
  }

  get currentChannel(): Channel | null {
    return this.channels.find(c => c.id === this.selectedChannelId) || null
  }

  get currentTypingAgentIds(): string[] {
    return [...(this.typingAgents.get(this.selectedChannelId) || [])]
  }

  private mergeUniqueEntries(entries: AgentLogEntry[]): AgentLogEntry[] {
    const seen = new Set<string>()
    const merged: AgentLogEntry[] = []
    for (const entry of entries) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      merged.push(entry)
    }
    return merged
  }

  setAgentLogsPage(agentId: string, entries: AgentLogEntry[], nextBeforeSeq: number | null) {
    const existing = this.agentLogs.get(agentId) || []
    const merged = this.mergeUniqueEntries([...entries, ...existing])
    this.agentLogs.set(agentId, merged)
    this.agentLogsNextBeforeSeq.set(agentId, nextBeforeSeq)
    this.agentLogsLoaded.add(agentId)
    this.emit('change')
  }

  prependAgentLogs(agentId: string, entries: AgentLogEntry[], nextBeforeSeq: number | null) {
    const existing = this.agentLogs.get(agentId) || []
    const merged = this.mergeUniqueEntries([...entries, ...existing])
    this.agentLogs.set(agentId, merged)
    this.agentLogsNextBeforeSeq.set(agentId, nextBeforeSeq)
    this.agentLogsLoaded.add(agentId)
    this.emit('change')
  }

  appendAgentLogs(agentId: string, entries: AgentLogEntry[]) {
    if (entries.length === 0) return
    const existing = this.agentLogs.get(agentId) || []
    const combined = this.mergeUniqueEntries([...existing, ...entries])
    this.agentLogs.set(agentId, combined)
    this.emit('change')
  }

  getAgentLogs(agentId: string): AgentLogEntry[] {
    return this.agentLogs.get(agentId) || []
  }

  getRecentAgentLogs(agentId: string, limit = 200): AgentLogEntry[] {
    const entries = this.getAgentLogs(agentId)
    if (entries.length <= limit) return entries
    return entries.slice(entries.length - limit)
  }

  getAgentLogsNextBeforeSeq(agentId: string): number | null {
    return this.agentLogsNextBeforeSeq.get(agentId) ?? null
  }

  hasAgentLogs(agentId: string): boolean {
    return this.agentLogsLoaded.has(agentId)
  }

  setAgentScreen(agentId: string, screen: { guiHttpPort: number; guiHttpsPort: number; width: number; height: number }) {
    this.agentScreens.set(agentId, screen)
    this.emit('change')
  }

  getAgentScreen(agentId: string): { guiHttpPort: number; guiHttpsPort: number; width: number; height: number } | null {
    return this.agentScreens.get(agentId) || null
  }

  setAgentApps(agentId: string, apps: MiniApp[]) {
    this.agentApps.set(agentId, apps)
    this.emit('change')
  }

  getAgentApps(agentId: string): MiniApp[] {
    return this.agentApps.get(agentId) || []
  }

  setAllApps(apps: MiniApp[]) {
    this.allApps = apps
    this.emit('change')
  }

  getAllApps(): MiniApp[] {
    return this.allApps
  }

  setPendingHostCommands(requests: HostCommandRequest[]) {
    this.pendingHostCommands = requests
      .filter((request) => request.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
    this.emit('change')
  }

  upsertHostCommandRequest(request: HostCommandRequest) {
    const others = this.pendingHostCommands.filter((item) => item.requestId !== request.requestId)
    if (request.status === 'pending') {
      others.push(request)
    }
    this.pendingHostCommands = others.sort((a, b) => a.createdAt - b.createdAt)
    this.emit('change')
  }

  openMiniappWindow(data: Omit<MiniappWindowState, 'open'>) {
    this.miniappWindow = {
      open: true,
      ...data,
    }
    this.emit('change')
  }

  patchMiniappWindow(data: Partial<MiniappWindowState>) {
    if (!this.miniappWindow) return
    this.miniappWindow = { ...this.miniappWindow, ...data }
    this.emit('change')
  }

  closeMiniappWindow() {
    this.miniappWindow = null
    this.emit('change')
  }

  updateAgent(updated: Agent) {
    this.agents = this.agents.map(a => a.id === updated.id ? updated : a)
    this.emit('change')
  }

  removeAgent(id: string) {
    this.agents = this.agents.filter(a => a.id !== id)
    this.agentApps.delete(id)
    this.agentLogs.delete(id)
    this.agentLogsNextBeforeSeq.delete(id)
    this.agentLogsLoaded.delete(id)
    if (this.profileAgentId === id) this.profileAgentId = null
    if (this.selectedAgentId === id) this.selectedAgentId = null
    if (this.miniappWindow?.agentId === id) this.miniappWindow = null
    this.emit('change')
  }

  openProfile(agentId: string) {
    this.profileAgentId = agentId
    this.emit('change')
  }

  closeProfile() {
    this.profileAgentId = null
    this.emit('change')
  }

  get profileAgent(): Agent | null {
    if (!this.profileAgentId) return null
    return this.agents.find(a => a.id === this.profileAgentId) || null
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type))
  }
}

export const state = new AppState()
