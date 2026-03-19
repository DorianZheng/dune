import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import * as slackSettingsStore from '../storage/slack-settings-store.js'
import * as slackChannelLinkStore from '../storage/slack-channel-link-store.js'
import * as messageStore from '../storage/message-store.js'
import * as channelStore from '../storage/channel-store.js'
import * as agentStore from '../storage/agent-store.js'
import { onNewMessage } from '../agents/orchestrator.js'
import { parseMentions } from '../utils/mentions.js'

let socketClient: SocketModeClient | null = null
let webClient: WebClient | null = null
let botUserId: string | null = null

export function isSlackConnected(): boolean {
  return webClient !== null
}

export function getSlackWebClient(): WebClient | null {
  return webClient
}

export async function startSlackConnection(): Promise<void> {
  console.log('[slack] startSlackConnection called')
  const botToken = slackSettingsStore.getSlackBotToken()
  if (!botToken) {
    console.log('[slack] No bot token found, skipping')
    return
  }
  console.log('[slack] Bot token found, connecting...')

  // Don't double-connect
  if (socketClient || webClient) {
    await stopSlackConnection()
  }

  webClient = new WebClient(botToken)

  // Resolve bot user ID for filtering out own messages
  try {
    const authResult = await webClient.auth.test()
    botUserId = authResult.user_id as string || null
    console.log(`Slack bot authenticated as user ${botUserId}`)
  } catch (err) {
    console.error('Slack auth.test failed:', err)
  }

  // Socket Mode (inbound) only works with an app-level token
  const appToken = slackSettingsStore.getSlackAppToken()
  if (!appToken) {
    console.log('[slack] No app token — outbound only (no Socket Mode)')
    return
  }
  console.log('[slack] App token found, starting Socket Mode...')

  socketClient = new SocketModeClient({ appToken })

  // events_api events: the SocketModeClient emits the inner event type
  // e.g., 'message' for message events, 'app_mention' for app_mention events
  socketClient.on('message', async ({ event, ack }) => {
    try {
      await ack()
    } catch (e) {
      console.error('Slack ack failed:', e)
    }
    if (!event) return
    // Skip bot's own messages and bot_message subtypes
    if (event.bot_id || event.subtype === 'bot_message') return
    if (botUserId && event.user === botUserId) return

    console.log(`[slack] message in ${event.channel} from ${event.user}: ${(event.text || '').slice(0, 80)}`)
    handleInboundMessage(event.channel, event.user, event.text || '', event.channel_type)
  })

  socketClient.on('app_mention', async ({ event, ack }) => {
    try {
      await ack()
    } catch (e) {
      console.error('Slack ack failed:', e)
    }
    if (!event) return
    if (botUserId && event.user === botUserId) return

    console.log(`[slack] app_mention in ${event.channel} from ${event.user}: ${(event.text || '').slice(0, 80)}`)
    handleInboundMessage(event.channel, event.user, event.text || '', 'channel')
  })

  // Log all events for debugging
  socketClient.on('slack_event', ({ type }) => {
    console.log(`[slack] event: ${type}`)
  })

  try {
    await socketClient.start()
    console.log('Slack Socket Mode connected')
  } catch (err) {
    console.error('Failed to start Slack Socket Mode:', err)
    socketClient = null
    webClient = null
  }
}

export async function stopSlackConnection(): Promise<void> {
  if (socketClient) {
    try {
      await socketClient.disconnect()
    } catch { /* ignore */ }
    socketClient = null
  }
  webClient = null
  botUserId = null
  console.log('Slack Socket Mode disconnected')
}

function handleInboundMessage(slackChannelId: string, slackUserId: string, text: string, channelType?: string): void {
  if (!text.trim()) return

  // Check if this Slack channel is linked to a Dune channel
  const link = slackChannelLinkStore.getLinkBySlackChannel(slackChannelId)

  if (link) {
    if (link.direction === 'outbound') return
    routeToLinkedChannel(link.duneChannelId, slackUserId, text)
    return
  }

  // DMs or unlinked channels: route to the "general" channel
  if (channelType === 'im') {
    const general = channelStore.getChannelByName('general')
    if (general) {
      routeToLinkedChannel(general.id, slackUserId, text)
      return
    }
  }

  console.log(`[slack] No link for Slack channel ${slackChannelId}, ignoring`)
}

function routeToLinkedChannel(duneChannelId: string, slackUserId: string, text: string): void {
  const agents = agentStore.listAgents()
  const mentionedIds = parseMentions(text, agents)
  const authorId = `slack:${slackUserId}`

  const message = messageStore.createMessage(duneChannelId, authorId, text, mentionedIds)
  onNewMessage(message).catch(err => console.error('Slack inbound orchestrator error:', err))
}

export async function maybeForwardToSlack(message: { channelId: string; authorId: string; content: string }): Promise<void> {
  if (!webClient) return

  // Echo prevention: don't forward messages that came from Slack or system
  if (message.authorId.startsWith('slack:') || message.authorId === 'system') return

  const link = slackChannelLinkStore.getLinkByDuneChannel(message.channelId)
  if (!link) return
  if (link.direction === 'inbound') return

  // Resolve display name for agents
  const agent = agentStore.getAgent(message.authorId)
  const username = agent?.name ?? 'Dune User'

  try {
    await webClient.chat.postMessage({
      channel: link.slackChannelId,
      text: message.content,
      username,
    })
  } catch (err) {
    console.error('Failed to forward message to Slack:', err)
  }
}
