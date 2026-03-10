export type ThemeMode = 'light' | 'dark' | 'system'

export interface UiPreferences {
  themeMode: ThemeMode
  sidebarCollapsed: boolean
}

type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEYS = {
  themeMode: 'dune.ui.themeMode',
  sidebarCollapsed: 'dune.ui.sidebarCollapsed',
  memoryPaneWidths: 'dune.ui.memoryPaneWidths',
} as const

const LEGACY_STORAGE_KEYS = [
  'dune.ui.density',
  'dune.ui.sendShortcut',
  'dune.ui.opaqueWindowBackground',
  'dune.ui.reducedMotion',
  'dune.ui.agentWorkspaceTabs',
] as const

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value == null) return fallback
  return value === '1' || value === 'true'
}

function parseAgentMemoryPaneWidths(value: string | null): Record<string, number> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, number> = {}
    for (const [agentId, width] of Object.entries(parsed)) {
      if (!agentId || typeof width !== 'number' || !Number.isFinite(width) || width <= 0) continue
      result[agentId] = Math.round(width)
    }
    return result
  } catch {
    return {}
  }
}

class UiPreferencesStore extends EventTarget {
  private mode: ThemeMode = 'system'
  private sidebarCollapsedValue = false
  private memoryPaneWidthsValue: Record<string, number> = {}
  private mediaQuery: MediaQueryList | null = null
  private initialized = false

  private readonly handleSystemThemeChange = () => {
    if (this.mode !== 'system') return
    this.applyDomState()
    this.emitChange()
  }

  init() {
    if (this.initialized) return
    this.initialized = true
    this.mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY)
    this.readPreferences()
    this.clearLegacyStorage()
    this.applyDomState()
    this.bindMediaListener()
  }

  destroy() {
    if (!this.initialized) return
    this.unbindMediaListener()
    this.initialized = false
  }

  get preferences(): UiPreferences {
    return {
      themeMode: this.mode,
      sidebarCollapsed: this.sidebarCollapsedValue,
    }
  }

  get themeMode(): ThemeMode {
    return this.mode
  }

  get sidebarCollapsed(): boolean {
    return this.sidebarCollapsedValue
  }

  get resolvedTheme(): ResolvedTheme {
    return this.resolveTheme(this.mode)
  }

  setThemeMode(nextMode: ThemeMode) {
    if (this.mode === nextMode) return
    this.mode = nextMode
    this.writeStorage(STORAGE_KEYS.themeMode, nextMode)
    this.applyDomState()
    this.emitChange()
  }

  setSidebarCollapsed(next: boolean) {
    if (this.sidebarCollapsedValue === next) return
    this.sidebarCollapsedValue = next
    this.writeStorage(STORAGE_KEYS.sidebarCollapsed, next ? '1' : '0')
    this.emitChange()
  }

  getAgentMemoryPaneWidth(agentId: string): number | null {
    const value = this.memoryPaneWidthsValue[agentId]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    return value
  }

  setAgentMemoryPaneWidth(agentId: string, widthPx: number) {
    if (!agentId || !Number.isFinite(widthPx) || widthPx <= 0) return
    const normalized = Math.round(widthPx)
    if (this.memoryPaneWidthsValue[agentId] === normalized) return
    this.memoryPaneWidthsValue = {
      ...this.memoryPaneWidthsValue,
      [agentId]: normalized,
    }
    this.writeStorage(STORAGE_KEYS.memoryPaneWidths, JSON.stringify(this.memoryPaneWidthsValue))
  }

  private resolveTheme(mode: ThemeMode): ResolvedTheme {
    if (mode !== 'system') return mode
    return this.mediaQuery?.matches ? 'dark' : 'light'
  }

  private applyDomState() {
    const root = document.documentElement
    root.dataset.themeMode = this.mode
    root.dataset.theme = this.resolveTheme(this.mode)
  }

  private emitChange() {
    this.dispatchEvent(new CustomEvent('change', {
      detail: {
        resolvedTheme: this.resolveTheme(this.mode),
        preferences: this.preferences,
      },
    }))
  }

  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  private writeStorage(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Ignore storage errors (private mode / blocked storage).
    }
  }

  private removeStorage(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Ignore storage errors (private mode / blocked storage).
    }
  }

  private readPreferences() {
    const themeModeRaw = this.readStorage(STORAGE_KEYS.themeMode)
    this.mode = isThemeMode(themeModeRaw) ? themeModeRaw : 'system'
    this.sidebarCollapsedValue = parseBoolean(this.readStorage(STORAGE_KEYS.sidebarCollapsed), false)
    this.memoryPaneWidthsValue = parseAgentMemoryPaneWidths(this.readStorage(STORAGE_KEYS.memoryPaneWidths))
  }

  private clearLegacyStorage() {
    for (const key of LEGACY_STORAGE_KEYS) {
      this.removeStorage(key)
    }
  }

  private bindMediaListener() {
    if (!this.mediaQuery) return
    if (typeof this.mediaQuery.addEventListener === 'function') {
      this.mediaQuery.addEventListener('change', this.handleSystemThemeChange)
      return
    }
    this.mediaQuery.addListener(this.handleSystemThemeChange)
  }

  private unbindMediaListener() {
    if (!this.mediaQuery) return
    if (typeof this.mediaQuery.removeEventListener === 'function') {
      this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange)
      return
    }
    this.mediaQuery.removeListener(this.handleSystemThemeChange)
  }
}

export const uiPreferences = new UiPreferencesStore()
