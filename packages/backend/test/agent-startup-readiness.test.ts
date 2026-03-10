import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-startup-readiness')
process.env.AGENT_STARTUP_TIMEOUT_MS = '1000'
process.env.AGENT_DESKTOP_POLL_MS = '100'

const agentManager = await import('../src/agents/agent-manager.js')

type ExecResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function createFakeBox(sequence: ExecResult[]): { exec: () => Promise<ExecResult> } {
  let index = 0
  return {
    async exec() {
      const current = sequence[Math.min(index, sequence.length - 1)]
      index += 1
      return current
    },
  }
}

test('desktop readiness succeeds with xfdesktop4 marker', async () => {
  // Each probe does TWO exec calls: xwininfo then pgrep.
  // Probe 1: xwininfo (no marker, no size) + pgrep (no PIDs) → not ready
  // Probe 2: xwininfo (has marker + size) + pgrep (not reached since xwininfo suffices)
  const box = createFakeBox([
    { exitCode: 0, stdout: 'root window only', stderr: '' },           // probe 1: xwininfo — no marker, no 1024x768
    { exitCode: 1, stdout: '', stderr: '' },                           // probe 1: pgrep — no matches
    { exitCode: 0, stdout: 'xfdesktop4 running root window 1024x768', stderr: '' }, // probe 2: xwininfo — has marker + size
  ])

  const result = await agentManager.__waitUntilDesktopReadyForTests(box as any)
  assert.equal(result.matchedMarker, 'xfdesktop4')
  assert.equal(result.probeCount, 2)
})

test('desktop readiness succeeds with xfce4-panel marker', async () => {
  const box = createFakeBox([
    { exitCode: 0, stdout: 'xfce4-panel active root 1024x768', stderr: '' },
  ])

  const result = await agentManager.__waitUntilDesktopReadyForTests(box as any)
  assert.equal(result.matchedMarker, 'xfce4-panel')
  assert.equal(result.probeCount, 1)
})

test('desktop readiness timeout returns diagnostic desktop_not_ready error', async () => {
  const box = createFakeBox([
    { exitCode: 0, stdout: 'window tree unavailable', stderr: '' },
  ])

  await assert.rejects(
    agentManager.__waitUntilDesktopReadyForTests(box as any),
    /desktop_not_ready: timeout_ms=\d+.*probes=\d+.*last_exit=0/s,
  )
})
