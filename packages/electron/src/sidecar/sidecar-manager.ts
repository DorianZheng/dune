import { utilityProcess, UtilityProcess } from 'electron'
import { EventEmitter } from 'events'
import http from 'http'
import {
  getBackendEntryPath,
  getDataDir,
  getFrontendDistPath,
  getAgentSkillsPath,
  getAgentMcpPath,
  getAgentPromptsPath,
  getHostOperatorHelperPath,
} from '../util/paths'
import { findFreePort } from './port-finder'

const HEALTH_POLL_INTERVAL_MS = 200
const HEALTH_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 5_000

export class SidecarManager extends EventEmitter {
  private child: UtilityProcess | null = null
  private _port = 0
  private _clientPort = 0
  private intentionalStop = false

  get port(): number {
    return this._port
  }

  get clientPort(): number {
    return this._clientPort
  }

  async start(): Promise<number> {
    this._port = await findFreePort(20000 + Math.floor(Math.random() * 30000))
    this._clientPort = await findFreePort(this._port + 1)
    const adminPort = await findFreePort(this._clientPort + 1)

    const backendEntry = getBackendEntryPath()
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PORT: String(this._port),
      CLIENT_PORT: String(this._clientPort),
      ADMIN_PORT: String(adminPort),
      DATA_DIR: getDataDir(),
      FRONTEND_DIST_PATH: getFrontendDistPath(),
      AGENT_SKILLS_PATH: getAgentSkillsPath(),
      AGENT_MCP_PATH: getAgentMcpPath(),
      AGENT_PROMPTS_PATH: getAgentPromptsPath(),
      HOST_OPERATOR_HELPER_PATH: getHostOperatorHelperPath(),
    }

    this.intentionalStop = false

    this.child = utilityProcess.fork(backendEntry, [], {
      env,
      stdio: 'pipe',
      serviceName: 'dune-backend',
    })

    this.child.stdout?.on('data', (data: Buffer) => {
      console.log('[backend]', data.toString().trimEnd())
    })

    this.child.stderr?.on('data', (data: Buffer) => {
      console.error('[backend]', data.toString().trimEnd())
    })

    this.child.on('exit', (code) => {
      if (!this.intentionalStop) {
        console.error(`Backend exited unexpectedly: code=${code}`)
        this.emit('crashed', { code, signal: null })
      }
      this.child = null
    })

    await this.waitForHealth()
    console.log(`Backend sidecar ready (agent=${this._port}, client=${this._clientPort})`)
    return this._clientPort
  }

  async stop(): Promise<void> {
    if (!this.child) return

    this.intentionalStop = true
    this.child.kill()

    const exited = await this.waitForExit(STOP_GRACE_MS)
    if (!exited && this.child) {
      console.warn('Backend did not exit gracefully, sending SIGKILL')
      this.child.kill()
      await this.waitForExit(2000)
    }

    this.child = null
  }

  private waitForHealth(): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()

      const poll = () => {
        if (Date.now() - startTime > HEALTH_TIMEOUT_MS) {
          reject(new Error(`Backend health check timed out after ${HEALTH_TIMEOUT_MS}ms`))
          return
        }

        const req = http.get(`http://127.0.0.1:${this._clientPort}/health`, (res) => {
          if (res.statusCode === 200) {
            res.resume()
            resolve()
          } else {
            res.resume()
            setTimeout(poll, HEALTH_POLL_INTERVAL_MS)
          }
        })

        req.on('error', () => {
          setTimeout(poll, HEALTH_POLL_INTERVAL_MS)
        })

        req.setTimeout(1000, () => {
          req.destroy()
          setTimeout(poll, HEALTH_POLL_INTERVAL_MS)
        })
      }

      poll()
    })
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve(true)
        return
      }

      const timer = setTimeout(() => {
        resolve(false)
      }, timeoutMs)

      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }
}
