#!/usr/bin/env node
/**
 * Starts backend, frontend (Vite), and Electron dev servers concurrently.
 * Waits for the Vite dev server to be ready before launching Electron.
 */
import { spawn } from 'node:child_process'

const VITE_URL = 'http://localhost:5173'
const VITE_READY_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 500

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
    if (!proc.killed) {
      proc.kill('SIGTERM')
    }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })

// 1. Start backend
spawnDev('backend', 'pnpm', ['--filter', '@dune/backend', 'dev'], { env: { ...process.env } })

// 2. Start frontend (Vite)
spawnDev('frontend', 'pnpm', ['--filter', '@dune/frontend', 'dev'])

// 3. Wait for Vite to be ready, then launch Electron
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
