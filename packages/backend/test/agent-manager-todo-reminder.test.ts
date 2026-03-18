import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-manager-todo-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const todoStore = await import('../src/storage/todo-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM todos;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agents;
  `)
}

test.beforeEach(() => {
  clearTables()
  agentManager.__resetTodoReminderStateForTests()
})

test.afterEach(() => {
  agentManager.__setTodoReminderEnqueueForTests(null)
  agentManager.__resetTodoReminderStateForTests()
})

test('CLI command injects agent ID env vars, model flag, and preserves session/auth flags', () => {
  const cmd = agentManager.__buildClaudeCliCommandForTests({
    agentId: 'agent-123',
    promptFile: '/tmp/prompt.txt',
    systemPromptFile: '/tmp/system.txt',
    hasSession: true,
    oauthToken: 'oauth-secret',
    modelId: 'opus',
  })

  assert.match(cmd, /AGENT_ID=agent-123/)
  assert.match(cmd, /DUNE_AGENT_ID=agent-123/)
  assert.match(cmd, /CLAUDE_CODE_OAUTH_TOKEN=oauth-secret/)
  assert.match(cmd, /--model opus/)
  assert.match(cmd, /--continue/)
})

test('todo reminder check enforces cooldown boundaries for no-pending nudges', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Reminder Agent',
    personality: 'checks cooldown behavior',
  })

  const firstAt = 1_000_000
  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, firstAt), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'no-pending')
  assert.match(sent[0]?.content || '', /idle as the follower/i)
  assert.match(sent[0]?.content || '', /Create a new pending heartbeat todo/i)

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, firstAt + 299_999), false)
  assert.equal(sent.length, 1)

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, firstAt + 300_001), true)
  assert.equal(sent.length, 2)
  assert.equal(sent[1]?.kind, 'no-pending')
})

test('todo reminder check prioritizes overdue reminders over no-pending nudges', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Overdue Agent',
    personality: 'checks overdue behavior',
  })

  const now = Date.now()
  const overdue = todoStore.createTodo({
    agentId: agent.id,
    title: 'Past due task',
    dueAt: now - 5_000,
  })

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, now), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'overdue')
  assert.match(sent[0]?.content || '', /overdue todo\(s\)/)
  assert.match(sent[0]?.content || '', new RegExp(overdue.id))
})

test('leader idle reminder asks for delegation and review on pending work', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Leader Agent',
    personality: 'plans handoffs',
    role: 'leader',
  })

  todoStore.createTodo({
    agentId: agent.id,
    title: 'Review release checklist',
    description: 'Check blockers and sequencing',
    dueAt: Date.now() + 30 * 60_000,
  })

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, Date.now()), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'idle')
  assert.match(sent[0]?.content || '', /idle as the leader/i)
  assert.match(sent[0]?.content || '', /Use dune-leader now/i)
  assert.match(sent[0]?.content || '', /follower-owned todo plus a concise instruction message/i)
  assert.match(sent[0]?.content || '', /Do not implement directly yourself/i)
  assert.match(sent[0]?.content || '', /leader-thesis\.md/i)
  assert.match(sent[0]?.content || '', /Leader PDCA/i)
  assert.match(sent[0]?.content || '', /exhaust obstacle-removal/i)
  assert.match(sent[0]?.content || '', /Do not passively wait/i)
  assert.doesNotMatch(sent[0]?.content || '', /create one due about/i)
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), undefined)
})

test('leader no-pending reminder asks what to do next', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Leader No Pending Agent',
    personality: 'decides the next task',
    role: 'leader',
  })

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, Date.now()), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'no-pending')
  assert.match(sent[0]?.content || '', /pick one delegable objective now/i)
  assert.match(sent[0]?.content || '', /create or recruit one before delegating/i)
  assert.match(sent[0]?.content || '', /follower-owned todo plus a concise instruction message/i)
  assert.match(sent[0]?.content || '', /Outcome: advanced\|blocked/i)
  assert.match(sent[0]?.content || '', /exhaust obstacle-removal/i)
  assert.match(sent[0]?.content || '', /Do not passively wait/i)
  assert.doesNotMatch(sent[0]?.content || '', /Create a new pending heartbeat todo/i)
})

test('follower idle reminder preserves the original request on pending work', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Follower Agent',
    personality: 'preserves requests',
    role: 'follower',
  })

  todoStore.createTodo({
    agentId: agent.id,
    title: 'Draft QA checklist',
    description: 'Keep the request intact',
    dueAt: Date.now() + 30 * 60_000,
  })

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, Date.now()), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'idle')
  assert.match(sent[0]?.content || '', /idle as the follower/i)
  assert.match(sent[0]?.content || '', /Preserve originalTitle and originalDescription exactly/i)
})

test('todo reminder check skips locked agents when requireUnlocked is true', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Locked Agent',
    personality: 'checks lock behavior',
  })
  todoStore.createTodo({
    agentId: agent.id,
    title: 'Pending work',
    dueAt: Date.now() + 30 * 60_000,
  })

  agentManager.__setAgentLockForTests(agent.id, true)
  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, Date.now(), true), false)
  assert.equal(sent.length, 0)

  agentManager.__setAgentLockForTests(agent.id, false)
  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, Date.now(), true), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'idle')
})

test('leader PDCA parser requires the fixed 8-line footer at the end of the reply', () => {
  const pdca = agentManager.__parseLeaderPdcaForTests(`
Completed the delegation.

Leader PDCA
Thesis: revised
Plan: owner=Fiona; deliverable=Ship the launch checklist draft; due=tomorrow; success=Checklist is complete and reviewed
Do: Assigned Fiona the launch checklist and clarified the expected draft.
Check: Fiona acknowledged the assignment and the due time.
Act: Review Fiona's first draft tomorrow morning.
Obstacle: cleared
Outcome: advanced
`)

  assert.deepEqual(pdca, {
    thesis: 'revised',
    plan: {
      owner: 'Fiona',
      deliverable: 'Ship the launch checklist draft',
      due: 'tomorrow',
      success: 'Checklist is complete and reviewed',
    },
    do: 'Assigned Fiona the launch checklist and clarified the expected draft.',
    check: 'Fiona acknowledged the assignment and the due time.',
    act: "Review Fiona's first draft tomorrow morning.",
    obstacle: 'cleared',
    outcome: 'advanced',
  })

  // Too few lines
  assert.equal(agentManager.__parseLeaderPdcaForTests('Leader PDCA\nThesis: unchanged'), null)
  // Old 7-line footer without Obstacle is rejected
  assert.equal(
    agentManager.__parseLeaderPdcaForTests('Leader PDCA\nThesis: unchanged\nPlan: owner=a; deliverable=b; due=c; success=d\nDo: x\nCheck: y\nAct: z\nOutcome: advanced'),
    null,
  )
  // Trailing line after footer is rejected
  assert.equal(
    agentManager.__parseLeaderPdcaForTests('Leader PDCA\nThesis: unchanged\nPlan: owner=a; deliverable=b; due=c; success=d\nDo: x\nCheck: y\nAct: z\nObstacle: cleared\nOutcome: advanced\nTrailing line'),
    null,
  )
})

test('advanced leader PDCA consumes cooldown and suppresses immediate requeue', () => {
  const agent = agentStore.createAgent({
    name: 'Leader PDCA Agent',
    personality: 'judges progress',
    role: 'leader',
  })

  const remindedAt = 2_000_000
  const resolution = agentManager.__finalizeTodoReminderTurnForTests(
    agent.id,
    'leader',
    { kind: 'idle', remindedAt },
    `
Leadership move complete.

Leader PDCA
Thesis: unchanged
Plan: owner=Team Alpha; deliverable=Send the release summary; due=today; success=Summary is posted to the team channel
Do: Delegated the release summary to Team Alpha and sent the delivery expectations.
Check: Team Alpha acknowledged the assignment in the channel.
Act: Review the summary once Team Alpha posts it.
Obstacle: cleared
Outcome: advanced
`,
  )

  assert.equal(resolution.consumeCooldown, true)
  assert.equal(resolution.allowImmediateRequeue, false)
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), remindedAt)
})

test('blocked or malformed leader PDCA does not consume cooldown and still suppresses immediate requeue', () => {
  const agent = agentStore.createAgent({
    name: 'Leader Blocked Agent',
    personality: 'needs direction sometimes',
    role: 'leader',
  })

  const blocked = agentManager.__finalizeTodoReminderTurnForTests(
    agent.id,
    'leader',
    { kind: 'no-pending', remindedAt: 3_000_000 },
    `
Need direction first.

Leader PDCA
Thesis: unchanged
Plan: owner=unassigned; deliverable=Choose the launch market; due=none; success=The launch market is explicitly chosen
Do: Requested the missing launch-market decision from the user and assigned parallelizable competitor research to Fiona.
Check: The decision is still missing, so no delegation can proceed on the primary objective.
Act: Follow up on Fiona's competitor research and re-check user response.
Obstacle: exhausted
Outcome: blocked
`,
  )

  assert.equal(blocked.consumeCooldown, false)
  assert.equal(blocked.allowImmediateRequeue, false)
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), undefined)

  const malformed = agentManager.__finalizeTodoReminderTurnForTests(
    agent.id,
    'leader',
    { kind: 'idle', remindedAt: 3_100_000 },
    'Planned the next step but forgot the verdict footer.',
  )

  assert.equal(malformed.consumeCooldown, false)
  assert.equal(malformed.allowImmediateRequeue, false)
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), undefined)
})

test('leader policy violation detection blocks direct implementation work but allows coordination shell commands', () => {
  assert.equal(
    agentManager.__detectLeaderPolicyViolationForTests([
      {
        toolName: 'Bash',
        input: { command: 'curl -s -X POST http://localhost:3200/api/todos -H \"Content-Type: application/json\" -d \"{}\"' },
      },
    ]),
    null,
  )

  const editViolation = agentManager.__detectLeaderPolicyViolationForTests([
    {
      toolName: 'Edit',
      input: { file_path: '/workspace/app.ts' },
    },
  ])
  assert.equal(editViolation?.toolName, 'Edit')
  assert.match(editViolation?.reason || '', /Direct implementation tool use/i)

  const bashViolation = agentManager.__detectLeaderPolicyViolationForTests([
    {
      toolName: 'Bash',
      input: { command: 'cat <<\"EOF\" > /workspace/app.ts\nexport const broken = true\nEOF' },
    },
  ])
  assert.equal(bashViolation?.toolName, 'Bash')
  assert.match(bashViolation?.reason || '', /Direct implementation shell work is not allowed/i)
})

test('leader policy violation prevents cooldown consumption even with advanced PDCA', () => {
  const agent = agentStore.createAgent({
    name: 'Leader Policy Agent',
    personality: 'should not self-execute',
    role: 'leader',
  })

  const resolution = agentManager.__finalizeTodoReminderTurnForTests(
    agent.id,
    'leader',
    { kind: 'idle', remindedAt: 4_000_000 },
    `
Leader PDCA
Thesis: unchanged
Plan: owner=Team Bravo; deliverable=Update the runbook; due=today; success=Runbook PR is ready for review
Do: Claimed the task directly and edited the files myself.
Check: The runbook changed locally.
Act: Hand the result to the team.
Obstacle: cleared
Outcome: advanced
`,
    { toolName: 'Edit', reason: 'Direct implementation tool use is not allowed for leaders: Edit.' },
  )

  assert.equal(resolution.consumeCooldown, false)
  assert.equal(resolution.allowImmediateRequeue, false)
  assert.equal(resolution.policyViolation?.toolName, 'Edit')
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), undefined)
})

// ── Obstacle semantics tests ──────────────────────────────────────────────

test('Outcome: blocked with Obstacle != exhausted fails validation', () => {
  // blocked + cleared → invalid
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=Fiona; deliverable=Ship draft; due=tomorrow; success=Draft reviewed
Do: Reassigned the work to Fiona.
Check: Fiona started but hit a new blocker.
Act: Follow up with Fiona on the new blocker.
Obstacle: cleared
Outcome: blocked
`),
    null,
  )

  // blocked + rerouted → invalid
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=Team B; deliverable=Rerouted delivery; due=today; success=Delivery complete
Do: Rerouted the work around the dependency.
Check: Team B picked up the rerouted path.
Act: Review Team B's progress tomorrow.
Obstacle: rerouted
Outcome: blocked
`),
    null,
  )

  // blocked + escalated → invalid
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=human; deliverable=Decision needed; due=none; success=Decision made
Do: Escalated to the human after exhausting options.
Check: No response yet.
Act: Follow up on the escalation and assign parallelizable work.
Obstacle: escalated
Outcome: blocked
`),
    null,
  )
})

test('missing Obstacle line rejects the footer', () => {
  // 7-line footer (old format) without Obstacle line
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=Fiona; deliverable=Ship draft; due=tomorrow; success=Draft reviewed
Do: Assigned the draft to Fiona.
Check: Fiona acknowledged.
Act: Review the draft tomorrow.
Outcome: advanced
`),
    null,
  )
})

test('passive wait wording in Do or Act fails validation', () => {
  // "Wait for" in Act
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=human; deliverable=Decision; due=none; success=Decision made
Do: Asked the user for the missing decision.
Check: No response yet.
Act: Wait for the user decision, then assign the launch owner.
Obstacle: escalated
Outcome: advanced
`),
    null,
  )

  // "waiting for" in Do
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=human; deliverable=Decision; due=none; success=Decision made
Do: Sent the question and now waiting for user response.
Check: No response yet.
Act: Assign Fiona the competitor research in parallel.
Obstacle: escalated
Outcome: advanced
`),
    null,
  )

  // "now waiting" in Act
  assert.equal(
    agentManager.__parseLeaderPdcaForTests(`
Leader PDCA
Thesis: unchanged
Plan: owner=human; deliverable=Market choice; due=none; success=Market chosen
Do: Escalated to user after trying all followers.
Check: No decision yet.
Act: Now waiting for the user to decide.
Obstacle: exhausted
Outcome: blocked
`),
    null,
  )
})

test('valid Obstacle: escalated with concrete Act succeeds', () => {
  const pdca = agentManager.__parseLeaderPdcaForTests(`
Escalated to the human but assigned parallelizable work.

Leader PDCA
Thesis: unchanged
Plan: owner=human; deliverable=Launch market decision; due=none; success=Market is explicitly chosen
Do: Escalated the launch-market decision to the human after exhausting follower options, and assigned competitor research to Fiona.
Check: Fiona started research; human decision still pending.
Act: Review Fiona's competitor research draft and prepare a recommendation summary for the human.
Obstacle: escalated
Outcome: advanced
`)

  assert.ok(pdca)
  assert.equal(pdca?.obstacle, 'escalated')
  assert.equal(pdca?.outcome, 'advanced')
  assert.match(pdca?.act || '', /Review Fiona/)
})

test('valid Obstacle: rerouted + Outcome: advanced parses and consumes cooldown', () => {
  const agent = agentStore.createAgent({
    name: 'Leader Reroute Agent',
    personality: 'finds alternate paths',
    role: 'leader',
  })

  const remindedAt = 5_000_000
  const resolution = agentManager.__finalizeTodoReminderTurnForTests(
    agent.id,
    'leader',
    { kind: 'idle', remindedAt },
    `
Rerouted around the blocker.

Leader PDCA
Thesis: unchanged
Plan: owner=Team Charlie; deliverable=Alternative delivery path; due=today; success=Delivery completed via alternate route
Do: Rerouted the blocked delivery to Team Charlie using an alternative approach.
Check: Team Charlie acknowledged and started the alternative path.
Act: Review Team Charlie's progress in two hours.
Obstacle: rerouted
Outcome: advanced
`,
  )

  assert.equal(resolution.consumeCooldown, true)
  assert.equal(resolution.allowImmediateRequeue, false)
  assert.equal(resolution.pdca?.obstacle, 'rerouted')
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), remindedAt)
})

test('valid Obstacle: exhausted + Outcome: blocked parses correctly and does not consume cooldown', () => {
  const agent = agentStore.createAgent({
    name: 'Leader Exhausted Agent',
    personality: 'tried everything',
    role: 'leader',
  })

  const resolution = agentManager.__finalizeTodoReminderTurnForTests(
    agent.id,
    'leader',
    { kind: 'idle', remindedAt: 6_000_000 },
    `
All autonomous options exhausted.

Leader PDCA
Thesis: unchanged
Plan: owner=human; deliverable=Infrastructure access decision; due=none; success=Access granted and deployment unblocked
Do: Tried re-scoping, reassigning to all available followers, and escalated through team coordination. Assigned Fiona parallelizable documentation.
Check: No follower can proceed without infrastructure access. Fiona is documenting the deployment plan.
Act: Check Fiona's documentation progress and re-check if human has responded.
Obstacle: exhausted
Outcome: blocked
`,
  )

  assert.equal(resolution.consumeCooldown, false)
  assert.equal(resolution.allowImmediateRequeue, false)
  assert.equal(resolution.pdca?.obstacle, 'exhausted')
  assert.equal(resolution.pdca?.outcome, 'blocked')
  assert.equal(agentManager.__getTodoReminderCooldownForTests(agent.id), undefined)
})
