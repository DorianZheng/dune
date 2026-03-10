import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

export type HostDirectoryPickResult =
  | { status: 'selected'; hostPath: string }
  | { status: 'cancelled' }

export type HostDirectoryPickerErrorCode = 'picker_unavailable' | 'picker_failed'

export class HostDirectoryPickerError extends Error {
  constructor(
    public readonly code: HostDirectoryPickerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HostDirectoryPickerError'
  }
}

export type HostDirectoryPickerCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  spawnError: NodeJS.ErrnoException | null
}

export type HostDirectoryPickerRunner = (
  command: string,
  args: string[],
) => Promise<HostDirectoryPickerCommandResult>

type PickOptions = {
  platform?: NodeJS.Platform
  runCommand?: HostDirectoryPickerRunner
}

function runCommand(command: string, args: string[]): Promise<HostDirectoryPickerCommandResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let spawnError: NodeJS.ErrnoException | null = null
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = err
    })
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr, spawnError })
    })
  })
}

function parseSelectedPath(stdout: string): string | null {
  const line = stdout
    .split(/\r?\n/g)
    .map((v) => v.trim())
    .find((v) => v.length > 0)
  if (!line) return null
  if (!isAbsolute(line)) return null
  if (/^[A-Za-z]:[\\/]?$/.test(line)) return `${line.slice(0, 2)}\\`
  if (line === '/' || line === '\\') return line
  return line.replace(/[\\/]+$/, '')
}

function isCommandMissing(result: HostDirectoryPickerCommandResult): boolean {
  if (result.spawnError?.code === 'ENOENT') return true
  const combined = `${result.stderr}\n${result.stdout}\n${result.spawnError?.message || ''}`.toLowerCase()
  return combined.includes('not found') || combined.includes('is not recognized')
}

function looksLikeCancel(result: HostDirectoryPickerCommandResult): boolean {
  if (result.exitCode === 1 && !result.stderr.trim() && !result.stdout.trim()) return true
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase()
  return (
    combined.includes('cancel')
    || combined.includes('canceled')
    || combined.includes('cancelled')
    || combined.includes('aborted')
  )
}

function formatFailure(command: string, result: HostDirectoryPickerCommandResult): string {
  const details = [
    `command=${command}`,
    `exitCode=${result.exitCode == null ? 'null' : String(result.exitCode)}`,
  ]
  if (result.spawnError?.message) details.push(`spawnError=${result.spawnError.message}`)
  if (result.stderr.trim()) details.push(`stderr=${result.stderr.trim()}`)
  if (result.stdout.trim()) details.push(`stdout=${result.stdout.trim()}`)
  return details.join(' ')
}

async function pickOnDarwin(runner: HostDirectoryPickerRunner): Promise<HostDirectoryPickResult> {
  const result = await runner('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select folder to mount")'])
  if (isCommandMissing(result)) {
    throw new HostDirectoryPickerError('picker_unavailable', 'osascript_not_available')
  }
  if (result.exitCode === 0) {
    const selected = parseSelectedPath(result.stdout)
    if (selected) return { status: 'selected', hostPath: selected }
    throw new HostDirectoryPickerError('picker_failed', `invalid_selection ${formatFailure('osascript', result)}`)
  }
  if (looksLikeCancel(result)) return { status: 'cancelled' }
  throw new HostDirectoryPickerError('picker_failed', formatFailure('osascript', result))
}

async function pickOnLinux(runner: HostDirectoryPickerRunner): Promise<HostDirectoryPickResult> {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: 'zenity', args: ['--file-selection', '--directory', '--title=Select folder to mount'] },
    { command: 'kdialog', args: ['--getexistingdirectory', '.'] },
  ]
  let missingCount = 0
  for (const attempt of attempts) {
    const result = await runner(attempt.command, attempt.args)
    if (isCommandMissing(result)) {
      missingCount += 1
      continue
    }
    if (result.exitCode === 0) {
      const selected = parseSelectedPath(result.stdout)
      if (selected) return { status: 'selected', hostPath: selected }
      throw new HostDirectoryPickerError('picker_failed', `invalid_selection ${formatFailure(attempt.command, result)}`)
    }
    if (looksLikeCancel(result)) return { status: 'cancelled' }
    throw new HostDirectoryPickerError('picker_failed', formatFailure(attempt.command, result))
  }
  if (missingCount === attempts.length) {
    throw new HostDirectoryPickerError('picker_unavailable', 'no_linux_picker_command_available')
  }
  throw new HostDirectoryPickerError('picker_failed', 'linux_picker_failed')
}

async function pickOnWindows(runner: HostDirectoryPickerRunner): Promise<HostDirectoryPickResult> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select folder to mount'",
    '$dialog.ShowNewFolderButton = $true',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  Write-Output $dialog.SelectedPath',
    '  exit 0',
    '}',
    'exit 1',
  ].join('; ')
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: 'powershell', args: ['-NoProfile', '-STA', '-Command', script] },
    { command: 'pwsh', args: ['-NoProfile', '-STA', '-Command', script] },
  ]

  let missingCount = 0
  for (const attempt of attempts) {
    const result = await runner(attempt.command, attempt.args)
    if (isCommandMissing(result)) {
      missingCount += 1
      continue
    }
    if (result.exitCode === 0) {
      const selected = parseSelectedPath(result.stdout)
      if (selected) return { status: 'selected', hostPath: selected }
      throw new HostDirectoryPickerError('picker_failed', `invalid_selection ${formatFailure(attempt.command, result)}`)
    }
    if (looksLikeCancel(result)) return { status: 'cancelled' }
    throw new HostDirectoryPickerError('picker_failed', formatFailure(attempt.command, result))
  }
  if (missingCount === attempts.length) {
    throw new HostDirectoryPickerError('picker_unavailable', 'no_windows_picker_command_available')
  }
  throw new HostDirectoryPickerError('picker_failed', 'windows_picker_failed')
}

export async function pickHostDirectory(options: PickOptions = {}): Promise<HostDirectoryPickResult> {
  const platform = options.platform ?? process.platform
  const runner = options.runCommand ?? runCommand
  switch (platform) {
    case 'darwin':
      return pickOnDarwin(runner)
    case 'linux':
      return pickOnLinux(runner)
    case 'win32':
      return pickOnWindows(runner)
    default:
      throw new HostDirectoryPickerError('picker_unavailable', `unsupported_platform:${platform}`)
  }
}
