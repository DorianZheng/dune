import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type {
  HostOperatorActCreateRequest,
  HostOperatorCreateRequest,
  HostOperatorFilesystemCreateRequest,
  HostOperatorOverviewCreateRequest,
  HostOperatorPerceiveCreateRequest,
  HostOperatorRunningApp,
  HostOperatorStatusCreateRequest,
} from '@dune/shared'

export type HostOperatorArtifact = {
  name: string
  contentBase64: string
}

export type HostOperatorProviderResult = {
  resultJson: unknown
  artifacts?: HostOperatorArtifact[]
}

export type HostOperatorProviderStatus = {
  available: boolean
  platform: NodeJS.Platform
  provider: string
  reason?: string
  helperPath?: string
}

export interface HostOperatorProvider {
  readonly name: string
  readonly platform: NodeJS.Platform
  listApps(): Promise<HostOperatorRunningApp[]>
  overview(input: HostOperatorOverviewCreateRequest): Promise<HostOperatorProviderResult>
  perceive(input: HostOperatorPerceiveCreateRequest): Promise<HostOperatorProviderResult>
  act(input: HostOperatorActCreateRequest): Promise<HostOperatorProviderResult>
  status(input: HostOperatorStatusCreateRequest): Promise<HostOperatorProviderResult>
  filesystem(input: HostOperatorFilesystemCreateRequest): Promise<HostOperatorProviderResult>
}

type HelperOk = {
  ok: true
  result?: unknown
  artifacts?: HostOperatorArtifact[]
}

type HelperErr = {
  ok: false
  error: string
  code?: string
}

type HelperResponse = HelperOk | HelperErr

type HelperPayload = {
  command: string
  input?: HostOperatorCreateRequest
}

async function invokeHelper(helperPath: string, payload: HelperPayload): Promise<HostOperatorProviderResult> {
  if (!existsSync(helperPath)) {
    throw new Error('host_operator_unavailable')
  }

  const response = await new Promise<HelperResponse>((resolve, reject) => {
    const child = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error('host_operator_helper_timeout'))
    }, 60_000)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const trimmed = stdout.trim()
      if (!trimmed) {
        reject(new Error(stderr.trim() || 'host_operator_helper_empty_response'))
        return
      }
      try {
        resolve(JSON.parse(trimmed) as HelperResponse)
      } catch (err: any) {
        reject(new Error(err?.message || 'host_operator_helper_invalid_json'))
      }
    })

    child.stdin.end(JSON.stringify(payload))
  })

  if (!response.ok) {
    throw new Error(response.code || response.error || 'host_operator_helper_failed')
  }

  return {
    resultJson: response.result ?? null,
    artifacts: response.artifacts ?? [],
  }
}

export class UnsupportedHostOperatorProvider implements HostOperatorProvider {
  readonly name = 'unsupported'

  constructor(
    readonly platform: NodeJS.Platform,
    private readonly reason: string,
  ) {}

  async listApps(): Promise<HostOperatorRunningApp[]> {
    throw new Error('host_operator_unavailable')
  }

  async overview(): Promise<HostOperatorProviderResult> {
    throw new Error('host_operator_unavailable')
  }

  async perceive(): Promise<HostOperatorProviderResult> {
    throw new Error('host_operator_unavailable')
  }

  async act(): Promise<HostOperatorProviderResult> {
    throw new Error('host_operator_unavailable')
  }

  async status(): Promise<HostOperatorProviderResult> {
    return {
      resultJson: {
        available: false,
        platform: this.platform,
        provider: this.name,
        reason: this.reason,
      } satisfies HostOperatorProviderStatus,
    }
  }

  async filesystem(): Promise<HostOperatorProviderResult> {
    throw new Error('host_operator_unavailable')
  }
}

export class DarwinHostOperatorProvider implements HostOperatorProvider {
  readonly name = 'darwin-helper'
  readonly platform: NodeJS.Platform = 'darwin'

  constructor(private readonly helperPath: string) {}

  async listApps(): Promise<HostOperatorRunningApp[]> {
    const result = await invokeHelper(this.helperPath, { command: 'list_apps' })
    return Array.isArray(result.resultJson) ? result.resultJson as HostOperatorRunningApp[] : []
  }

  async overview(input: HostOperatorOverviewCreateRequest): Promise<HostOperatorProviderResult> {
    return invokeHelper(this.helperPath, { command: 'overview', input })
  }

  async perceive(input: HostOperatorPerceiveCreateRequest): Promise<HostOperatorProviderResult> {
    return invokeHelper(this.helperPath, { command: 'perceive', input })
  }

  async act(input: HostOperatorActCreateRequest): Promise<HostOperatorProviderResult> {
    return invokeHelper(this.helperPath, { command: 'act', input })
  }

  async status(input: HostOperatorStatusCreateRequest): Promise<HostOperatorProviderResult> {
    if (!existsSync(this.helperPath)) {
      return {
        resultJson: {
          available: false,
          platform: this.platform,
          provider: this.name,
          reason: 'helper_missing',
          helperPath: this.helperPath,
        } satisfies HostOperatorProviderStatus,
      }
    }
    return invokeHelper(this.helperPath, { command: 'status', input })
  }

  async filesystem(input: HostOperatorFilesystemCreateRequest): Promise<HostOperatorProviderResult> {
    return invokeHelper(this.helperPath, { command: 'filesystem', input })
  }
}

export function createDefaultHostOperatorProvider(options: {
  platform?: NodeJS.Platform
  helperPath: string
}): HostOperatorProvider {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') {
    return new DarwinHostOperatorProvider(options.helperPath)
  }
  return new UnsupportedHostOperatorProvider(platform, 'platform_not_supported')
}
