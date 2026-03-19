import { Hono } from 'hono'
import * as channelStore from '../storage/channel-store.js'
import * as messageStore from '../storage/message-store.js'
import * as agentStore from '../storage/agent-store.js'
import { onNewMessage } from '../agents/orchestrator.js'
import { parseMentions } from '../utils/mentions.js'
import { sendToAll as broadcastAll } from '../gateway/broadcast.js'

export const channelsApi = new Hono()

channelsApi.get('/', (c) => {
  return c.json(channelStore.listChannels())
})

channelsApi.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Channel name is required' }, 400)
  }
  body.name = body.name.trim()
  const channel = channelStore.createChannel(body)
  broadcastAll({
    type: 'workspace:invalidate',
    payload: { resources: ['channels'], reason: 'created' },
  })
  return c.json(channel, 201)
})

channelsApi.get('/by-name/:name', (c) => {
  const channel = channelStore.getChannelByName(c.req.param('name'))
  if (!channel) return c.json({ error: 'Not found' }, 404)
  return c.json(channel)
})

channelsApi.get('/:id', (c) => {
  const channel = channelStore.getChannel(c.req.param('id'))
  if (!channel) return c.json({ error: 'Not found' }, 404)
  return c.json(channel)
})

channelsApi.put('/:id', async (c) => {
  const body = await c.req.json()
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'Channel name cannot be empty' }, 400)
    }
    body.name = body.name.trim()
  }
  const channel = channelStore.updateChannel(c.req.param('id'), body)
  if (!channel) return c.json({ error: 'Not found' }, 404)
  broadcastAll({
    type: 'workspace:invalidate',
    payload: { resources: ['channels'], reason: 'updated' },
  })
  return c.json(channel)
})

channelsApi.delete('/:id', (c) => {
  const ok = channelStore.deleteChannel(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  broadcastAll({
    type: 'workspace:invalidate',
    payload: { resources: ['channels'], reason: 'deleted' },
  })
  return c.json({ ok: true })
})

// Messages
channelsApi.get('/:id/messages', (c) => {
  const limit = Number(c.req.query('limit') || 50)
  const before = c.req.query('before') ? Number(c.req.query('before')) : undefined
  return c.json(messageStore.getChannelMessages(c.req.param('id'), limit, before))
})

channelsApi.post('/:id/messages', async (c) => {
  const body = await c.req.json()
  const channelId = c.req.param('id')

  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return c.json({ error: 'Message content is required' }, 400)
  }
  if (!body.authorId || typeof body.authorId !== 'string') {
    return c.json({ error: 'Author ID is required' }, 400)
  }

  const channel = channelStore.getChannel(channelId)
  if (!channel) return c.json({ error: 'Channel not found' }, 404)

  const authorAgent = agentStore.getAgent(body.authorId)
  if (authorAgent && !channelStore.isAgentSubscribed(authorAgent.id, channelId)) {
    return c.json({ error: `Agent "${authorAgent.name}" is not in this channel.` }, 403)
  }

  // Parse @mentions from content
  const agents = agentStore.listAgents()
  const mentionedIds = parseMentions(body.content, agents)

  const message = messageStore.createMessage(channelId, body.authorId, body.content, mentionedIds)

  // Fire and forget - let agents respond asynchronously
  onNewMessage(message).catch(err => console.error('Orchestrator error:', err))

  return c.json(message, 201)
})

// Subscriptions
channelsApi.post('/:id/subscribe', async (c) => {
  const { agentId } = await c.req.json()
  if (!agentId) return c.json({ error: 'agentId is required' }, 400)
  if (!agentStore.getAgent(agentId)) return c.json({ error: 'Agent not found' }, 404)
  if (!channelStore.getChannel(c.req.param('id'))) return c.json({ error: 'Channel not found' }, 404)
  channelStore.subscribeAgent(agentId, c.req.param('id'))
  return c.json({ ok: true })
})

channelsApi.post('/:id/unsubscribe', async (c) => {
  const { agentId } = await c.req.json()
  channelStore.unsubscribeAgent(agentId, c.req.param('id'))
  return c.json({ ok: true })
})

channelsApi.get('/:id/subscribers', (c) => {
  return c.json(channelStore.getChannelSubscribers(c.req.param('id')))
})
