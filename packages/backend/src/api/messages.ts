import { Hono } from 'hono'
import * as messageStore from '../storage/message-store.js'

export const messagesApi = new Hono()

messagesApi.get('/:id', (c) => {
  const msg = messageStore.getMessage(c.req.param('id'))
  if (!msg) return c.json({ error: 'Not found' }, 404)
  return c.json(msg)
})
