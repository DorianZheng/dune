import { Hono } from 'hono'
import * as agentStore from '../storage/agent-store.js'
import * as hostOperatorService from '../host-operator/host-operator-service.js'
import type { HostOperatorDecisionRequest } from '@dune/shared'

export const adminHostOperatorApi = new Hono()

function handleAdminHostOperatorError(c: any, err: any) {
  const message = String(err?.message || 'host_operator_error')
  if (message === 'request_not_pending') return c.json({ error: message }, 409)
  if (message === 'host_operator_unavailable') return c.json({ error: message }, 503)
  return c.json({ error: message }, 400)
}

adminHostOperatorApi.get('/host-operator/pending', (c) => {
  const requests = hostOperatorService.listPendingHostOperatorRequests(500)
  return c.json({ requests })
})

adminHostOperatorApi.get('/host-operator/apps', async (c) => {
  try {
    const apps = await hostOperatorService.listRunningHostOperatorApps()
    return c.json({ apps })
  } catch (err: any) {
    return handleAdminHostOperatorError(c, err)
  }
})

adminHostOperatorApi.post('/host-operator/:requestId/decision', async (c) => {
  try {
    const body = await c.req.json() as HostOperatorDecisionRequest
    if (body?.decision !== 'approve' && body?.decision !== 'reject') {
      return c.json({ error: 'invalid_decision' }, 400)
    }

    const decided = await hostOperatorService.decideHostOperatorRequest({
      requestId: c.req.param('requestId'),
      decision: body.decision,
      approverId: 'admin',
      agentLookup: (agentId) => agentStore.getAgent(agentId),
    })
    if (!decided) return c.json({ error: 'not_found' }, 404)
    return c.json(decided)
  } catch (err: any) {
    return handleAdminHostOperatorError(c, err)
  }
})
