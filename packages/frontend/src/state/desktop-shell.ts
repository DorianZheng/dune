export type WindowControlAction = 'minimize' | 'maximize' | 'close'

export type DesktopShellMode = 'browser' | 'electron-macos' | 'electron-desktop'
export type DesktopChromeDisposition = 'pane-local'
export type DesktopLayoutMode = 'split-view'

export type DesktopShellState = {
  isElectron: boolean
  platform: string
  mode: DesktopShellMode
  chromeDisposition: DesktopChromeDisposition
  layoutMode: DesktopLayoutMode
  supportsWindowControls: boolean
  usesNativeTrafficLights: boolean
}

type DuneElectronBridge = {
  platform: string
  isElectron: boolean
  minimize?: () => void
  maximize?: () => void
  close?: () => void
  onNativeThemeChange?: (callback: (isDark: boolean) => void) => void
  getAppVersion?: () => Promise<string>
  selectDirectory?: () => Promise<string | null>
}

declare global {
  interface Window {
    duneElectron?: DuneElectronBridge
    __DUNE_E2E_CAPTURE_WINDOW_ACTIONS?: boolean
  }
}

function resolveMode(bridge?: DuneElectronBridge): DesktopShellMode {
  if (!bridge?.isElectron) return 'browser'
  return bridge.platform === 'darwin' ? 'electron-macos' : 'electron-desktop'
}

function buildState(): DesktopShellState {
  const bridge = window.duneElectron
  const mode = resolveMode(bridge)

  return {
    isElectron: bridge?.isElectron === true,
    platform: bridge?.platform ?? 'browser',
    mode,
    chromeDisposition: 'pane-local',
    layoutMode: 'split-view',
    supportsWindowControls: mode === 'electron-desktop',
    usesNativeTrafficLights: mode === 'electron-macos',
  }
}

class DesktopShellStore extends EventTarget {
  private snapshot: DesktopShellState = {
    isElectron: false,
    platform: 'browser',
    mode: 'browser',
    chromeDisposition: 'pane-local',
    layoutMode: 'split-view',
    supportsWindowControls: false,
    usesNativeTrafficLights: false,
  }

  private initialized = false

  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.refresh()
  }

  get state(): DesktopShellState {
    return this.snapshot
  }

  refresh(): void {
    const next = buildState()
    const changed = JSON.stringify(next) !== JSON.stringify(this.snapshot)
    this.snapshot = next
    this.applyDomState()
    if (changed) {
      this.dispatchEvent(new CustomEvent('change', { detail: next }))
    }
  }

  invokeWindowControl(action: WindowControlAction): void {
    document.documentElement.dataset.lastWindowAction = action
    if (window.__DUNE_E2E_CAPTURE_WINDOW_ACTIONS) return

    const bridge = window.duneElectron
    const fn = bridge?.[action]
    if (typeof fn === 'function') {
      fn.call(bridge)
    }
  }

  private applyDomState(): void {
    const root = document.documentElement
    root.dataset.shellMode = this.snapshot.mode
    root.dataset.desktop = this.snapshot.isElectron ? 'true' : 'false'
    root.dataset.platform = this.snapshot.platform
    root.dataset.chromeDisposition = this.snapshot.chromeDisposition
    root.dataset.layoutMode = this.snapshot.layoutMode
  }
}

export const desktopShell = new DesktopShellStore()
