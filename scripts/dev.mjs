#!/usr/bin/env node
/**
 * Starts backend, frontend (Vite), and Electron dev servers.
 * Order: backend → wait for .port → Vite → wait for Vite → Electron
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'

const PORT_FILE = 'packages/backend/.port'
const VITE_URL = 'http://localhost:5173'
const BACKEND_READY_TIMEOUT_MS = 30_000
const VITE_READY_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 300

const procs = []

function spawnDev(name, cmd, args, opts = {}) {
  const proc = spawn(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    ...opts,
  })
  proc._name = name
  procs.push(proc)
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] exited with code ${code}`)
    }
  })
  return proc
}

async function waitForPortFile(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (existsSync(PORT_FILE)) {
        const raw = readFileSync(PORT_FILE, 'utf-8').trim()
        if (raw.startsWith('{')) {
          const config = JSON.parse(raw)
          if (config.agentPort > 0 && config.clientPort > 0) return config
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Backend did not write ${PORT_FILE} within ${timeoutMs}ms`)
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) })
      return
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function cleanup() {
  for (const proc of procs) {
    if (!proc.killed) proc.kill('SIGTERM')
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })

// Clean stale port file
try { unlinkSync(PORT_FILE) } catch {}

// 1. Start backend
spawnDev('backend', 'pnpm', ['--filter', '@dune/backend', 'dev'], { env: { ...process.env } })

// 2. Wait for backend to write .port file
try {
  console.log('[dev] Waiting for backend to start...')
  const ports = await waitForPortFile(BACKEND_READY_TIMEOUT_MS)
  console.log(`[dev] Backend ready (agent=${ports.agentPort}, client=${ports.clientPort}, admin=${ports.adminPort})`)
} catch (err) {
  console.error(`[dev] ${err.message}`)
  cleanup()
  process.exit(1)
}

// 3. Start frontend (Vite) — now .port exists with correct ports
spawnDev('frontend', 'pnpm', ['--filter', '@dune/frontend', 'dev'])

// 4. Wait for Vite, then launch Electron
try {
  console.log(`[dev] Waiting for Vite at ${VITE_URL}...`)
  await waitForUrl(VITE_URL, VITE_READY_TIMEOUT_MS)
  console.log('[dev] Vite ready, launching Electron...')
  spawnDev('electron', 'pnpm', ['--filter', '@dune/electron', 'dev:electron'])
} catch (err) {
  console.error(`[dev] ${err.message}`)
  cleanup()
  process.exit(1)
}
