import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { MiniApp, MiniAppStatusType } from '@dune/shared'
import { config } from '../config.js'

const APP_STATUSES = new Set<MiniAppStatusType>(['published', 'building', 'archived', 'error'])

type RawManifest = {
  slug?: unknown
  name?: unknown
  description?: unknown
  collection?: unknown
  status?: unknown
  entry?: unknown
  order?: unknown
  tags?: unknown
  kind?: unknown
  sandboxId?: unknown
  port?: unknown
  path?: unknown
}

export type MiniAppStoreOptions = {
  rootPath?: string
}

function getMiniAppRoot(agentId: string, options?: MiniAppStoreOptions): string {
  if (options?.rootPath) return resolve(options.rootPath)
  return join(config.agentsRoot, agentId, '.dune', 'miniapps')
}

function normalizeSlug(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  return /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(value) ? value : null
}

function normalizeEntry(input: unknown): string | null {
  const raw = typeof input === 'string' ? input.trim() : 'index.html'
  if (!raw) return null
  const normalized = raw.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) {
    return null
  }
  return normalized
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    out.add(trimmed)
  }
  return [...out]
}

export function normalizeMiniAppManifest(
  agentId: string,
  rootDir: string,
  folderName: string,
  rawManifest: RawManifest,
): MiniApp | null {
  const slug = normalizeSlug(typeof rawManifest.slug === 'string' ? rawManifest.slug : folderName)
  if (!slug) {
    console.warn(`[miniapps] Invalid slug for agent ${agentId}: ${folderName}`)
    return null
  }

  const appDir = resolve(rootDir, folderName)
  const relativeDir = relative(rootDir, appDir)
  if (relativeDir.startsWith('..') || relativeDir.includes('\0')) {
    console.warn(`[miniapps] Unsafe app directory ignored for agent ${agentId}: ${folderName}`)
    return null
  }

  const entry = normalizeEntry(rawManifest.entry)
  if (!entry) {
    console.warn(`[miniapps] Invalid entry in ${folderName}/app.json for agent ${agentId}`)
    return null
  }

  const entryPath = resolve(appDir, entry)
  const relativeEntry = relative(appDir, entryPath)
  if (relativeEntry.startsWith('..') || relativeEntry.includes('\0')) {
    console.warn(`[miniapps] Entry escapes app directory in ${folderName}/app.json for agent ${agentId}`)
    return null
  }

  const statusRaw = typeof rawManifest.status === 'string' ? rawManifest.status : 'published'
  const status: MiniAppStatusType = APP_STATUSES.has(statusRaw as MiniAppStatusType)
    ? (statusRaw as MiniAppStatusType)
    : 'published'

  const orderValue = typeof rawManifest.order === 'number' && Number.isFinite(rawManifest.order)
    ? rawManifest.order
    : 100

  const name = typeof rawManifest.name === 'string' && rawManifest.name.trim()
    ? rawManifest.name.trim()
    : slug

  const description = typeof rawManifest.description === 'string'
    ? rawManifest.description.trim()
    : ''

  const collection = typeof rawManifest.collection === 'string' && rawManifest.collection.trim()
    ? rawManifest.collection.trim()
    : 'Published'

  const kind = rawManifest.kind === 'backend' ? 'backend' as const : 'frontend' as const
  const sandboxId = typeof rawManifest.sandboxId === 'string' && rawManifest.sandboxId.trim()
    ? rawManifest.sandboxId.trim()
    : undefined
  const port = typeof rawManifest.port === 'number' && Number.isFinite(rawManifest.port)
    ? rawManifest.port
    : undefined
  const appPath = typeof rawManifest.path === 'string' ? rawManifest.path.trim() : undefined

  const entryExists = existsSync(entryPath) && statSync(entryPath).isFile()
  const updatedAt = statSync(join(appDir, 'app.json')).mtimeMs

  // Backend apps with sandboxId+port are openable even without entry file
  const isBackendApp = kind === 'backend' && !!sandboxId && port != null
  const effectiveStatus: MiniAppStatusType = (entryExists || isBackendApp) ? status : 'error'
  const openable = (entryExists || isBackendApp) && effectiveStatus !== 'archived' && effectiveStatus !== 'error'

  return {
    agentId,
    slug,
    name,
    description,
    collection,
    status: effectiveStatus,
    entry,
    order: orderValue,
    tags: normalizeTags(rawManifest.tags),
    updatedAt,
    entryExists,
    openable,
    ...(entryExists || isBackendApp ? {} : { error: `Entry file not found: ${entry}` }),
    ...(kind !== 'frontend' ? { kind } : {}),
    ...(sandboxId ? { sandboxId } : {}),
    ...(port != null ? { port } : {}),
    ...(appPath ? { path: appPath } : {}),
  }
}

export function listMiniApps(agentId: string, options?: MiniAppStoreOptions): MiniApp[] {
  const rootDir = getMiniAppRoot(agentId, options)
  mkdirSync(rootDir, { recursive: true })

  const apps: MiniApp[] = []
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const manifestPath = join(rootDir, entry.name, 'app.json')
    if (!existsSync(manifestPath)) {
      console.warn(`[miniapps] Missing app.json for agent ${agentId}: ${entry.name}`)
      continue
    }

    let raw: RawManifest
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RawManifest
    } catch (err: any) {
      console.warn(`[miniapps] Failed to parse ${entry.name}/app.json for agent ${agentId}: ${err.message}`)
      continue
    }

    const normalized = normalizeMiniAppManifest(agentId, rootDir, entry.name, raw)
    if (!normalized) continue
    apps.push(normalized)
  }

  apps.sort((a, b) => {
    const collectionCmp = a.collection.localeCompare(b.collection)
    if (collectionCmp !== 0) return collectionCmp
    const orderCmp = a.order - b.order
    if (orderCmp !== 0) return orderCmp
    return b.updatedAt - a.updatedAt
  })

  return apps
}

export function getMiniApp(agentId: string, slug: string, options?: MiniAppStoreOptions): MiniApp | null {
  const normalized = normalizeSlug(slug)
  if (!normalized) return null
  return listMiniApps(agentId, options).find(app => app.slug === normalized) || null
}
