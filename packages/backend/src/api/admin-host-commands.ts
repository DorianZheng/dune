import { Hono } from 'hono'
import * as hostCommandService from '../host-commands/host-command-service.js'
import type { HostCommandDecisionRequest } from '@dune/shared'

export const adminHostCommandsApi = new Hono()

function handleAdminHostCommandError(c: any, err: any) {
  const message = String(err?.message || 'host_command_error')
  if (message === 'request_not_pending') return c.json({ error: message }, 409)
  if (message === 'elevated_confirmation_required') return c.json({ error: message }, 400)
  return c.json({ error: message }, 400)
}

adminHostCommandsApi.get('/host-commands/pending', (c) => {
  const requests = hostCommandService.listPendingHostCommandRequests(500)
  return c.json({ requests })
})

adminHostCommandsApi.post('/host-commands/:requestId/decision', async (c) => {
  try {
    const body = await c.req.json() as HostCommandDecisionRequest
    if (body?.decision !== 'approve' && body?.decision !== 'reject') {
      return c.json({ error: 'invalid_decision' }, 400)
    }

    const decided = await hostCommandService.decideHostCommandRequest({
      requestId: c.req.param('requestId'),
      decision: body.decision,
      elevatedConfirmed: !!body.elevatedConfirmed,
      approverId: 'admin',
    })
    if (!decided) return c.json({ error: 'not_found' }, 404)
    return c.json(decided)
  } catch (err: any) {
    return handleAdminHostCommandError(c, err)
  }
})
