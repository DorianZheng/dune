import { Hono } from 'hono'

export const adminHostCommandsApi = new Hono()

adminHostCommandsApi.get('/host-commands/pending', (c) => {
  return c.json({ error: 'host_exec_removed' }, 410)
})

adminHostCommandsApi.post('/host-commands/:requestId/decision', async (c) => {
  return c.json({ error: 'host_exec_removed' }, 410)
})
