#!/usr/bin/env node
/**
 * Creates a flat, self-contained node_modules for the backend by resolving
 * pnpm's virtual store into an npm-style layout. Handles:
 * - Direct deps (symlinks in backend/node_modules)
 * - Transitive deps (nested in .pnpm virtual store)
 * - Platform-specific optional deps (e.g. @boxlite-ai/boxlite-darwin-arm64)
 *
 * Usage: node resolve-backend-deps.mjs <backend-root> <output-node-modules>
 */
import { cpSync, mkdirSync, existsSync, rmSync, readdirSync, lstatSync, readlinkSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'

const [backendRoot, outputDir] = process.argv.slice(2)
if (!backendRoot || !outputDir) {
  console.error('Usage: resolve-backend-deps.mjs <backend-root> <output-node-modules>')
  process.exit(1)
}

const backendNM = resolve(backendRoot, 'node_modules')
const dst = resolve(outputDir)
const repoRoot = resolve(backendRoot, '..', '..')

if (!existsSync(backendNM)) {
  console.error(`Source not found: ${backendNM}`)
  process.exit(1)
}

if (existsSync(dst)) rmSync(dst, { recursive: true })
mkdirSync(dst, { recursive: true })

let copied = 0

function copyPackage(realPath, destPath) {
  if (existsSync(destPath)) return // already copied
  cpSync(realPath, destPath, { recursive: true, dereference: true })
  copied++
}

function resolveSymlink(linkPath) {
  const target = readlinkSync(linkPath)
  return resolve(dirname(linkPath), target)
}

// Step 1: Copy direct backend deps (resolving symlinks)
for (const entry of readdirSync(backendNM)) {
  if (entry === '.pnpm' || entry === '.cache' || entry === '.package-lock.json' || entry === '.modules.yaml') continue
  const srcPath = join(backendNM, entry)
  const stat = lstatSync(srcPath)

  if (entry.startsWith('@') && (stat.isDirectory() || stat.isSymbolicLink())) {
    const realScopePath = stat.isSymbolicLink() ? resolveSymlink(srcPath) : srcPath
    if (!existsSync(realScopePath)) continue
    for (const sub of readdirSync(realScopePath)) {
      const subSrc = join(realScopePath, sub)
      const subStat = lstatSync(subSrc)
      const realPath = subStat.isSymbolicLink() ? resolveSymlink(subSrc) : subSrc
      copyPackage(realPath, join(dst, entry, sub))
    }
  } else {
    const realPath = stat.isSymbolicLink() ? resolveSymlink(srcPath) : srcPath
    if (!existsSync(realPath)) continue
    copyPackage(realPath, join(dst, entry))
  }
}

// Step 2: For each copied package, also copy its transitive deps from the
// .pnpm virtual store's nested node_modules
function findPnpmNodeModules(pkgRealPath) {
  // In pnpm, the real path is like:
  //   .pnpm/mime-types@2.1.35/node_modules/mime-types
  // Sibling entries in that node_modules are the transitive deps:
  //   .pnpm/mime-types@2.1.35/node_modules/mime-db
  const parentNM = dirname(pkgRealPath)
  if (!parentNM.includes('.pnpm')) return []
  const siblings = []
  try {
    for (const entry of readdirSync(parentNM)) {
      const entryPath = join(parentNM, entry)
      if (entry.startsWith('.')) continue
      siblings.push({ name: entry, path: entryPath })
    }
  } catch {}
  return siblings
}

// Iterate over what we copied and resolve transitive deps
const processed = new Set()
function resolveTransitive(name, realPath) {
  if (processed.has(name)) return
  processed.add(name)

  for (const sibling of findPnpmNodeModules(realPath)) {
    const destPath = join(dst, sibling.name)
    if (existsSync(destPath)) continue
    const stat = lstatSync(sibling.path)
    const siblingReal = stat.isSymbolicLink() ? resolveSymlink(sibling.path) : sibling.path
    if (!existsSync(siblingReal)) continue

    // Handle scoped packages
    if (sibling.name.startsWith('@')) {
      for (const sub of readdirSync(siblingReal)) {
        const subReal = join(siblingReal, sub)
        const subStat = lstatSync(subReal)
        const finalReal = subStat.isSymbolicLink() ? resolveSymlink(subReal) : subReal
        const subDest = join(destPath, sub)
        if (!existsSync(subDest)) {
          copyPackage(finalReal, subDest)
          resolveTransitive(`${sibling.name}/${sub}`, finalReal)
        }
      }
    } else {
      copyPackage(siblingReal, destPath)
      resolveTransitive(sibling.name, siblingReal)
    }
  }
}

// Get real paths for the direct deps we already copied
for (const entry of readdirSync(backendNM)) {
  if (entry.startsWith('.')) continue
  const srcPath = join(backendNM, entry)
  const stat = lstatSync(srcPath)
  if (stat.isSymbolicLink()) {
    const realPath = resolveSymlink(srcPath)
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(realPath)) {
        const subStat = lstatSync(join(realPath, sub))
        const subReal = subStat.isSymbolicLink() ? resolveSymlink(join(realPath, sub)) : join(realPath, sub)
        resolveTransitive(`${entry}/${sub}`, subReal)
      }
    } else {
      resolveTransitive(entry, realPath)
    }
  }
}

// Step 3: Copy platform-specific optional deps from root .pnpm/node_modules
const rootPnpmNM = join(repoRoot, 'node_modules', '.pnpm', 'node_modules')
if (existsSync(rootPnpmNM)) {
  for (const entry of readdirSync(rootPnpmNM)) {
    if (!entry.startsWith('@boxlite-ai')) continue
    const scopePath = join(rootPnpmNM, entry)
    for (const sub of readdirSync(scopePath)) {
      if (!sub.includes('darwin') && !sub.includes('linux') && !sub.includes('win32')) continue
      const subPath = join(scopePath, sub)
      const destPath = join(dst, entry, sub)
      if (existsSync(destPath)) continue
      const stat = lstatSync(subPath)
      const realPath = stat.isSymbolicLink() ? resolveSymlink(subPath) : subPath
      copyPackage(realPath, destPath)
    }
  }
}

console.log(`Resolved ${copied} packages from ${backendNM} -> ${dst}`)

// Step 4: Rebuild native modules for Electron's Node ABI.
// utilityProcess runs with Electron's bundled Node.js, so native addons
// must match Electron's ABI. We use node-gyp directly because
// @electron/rebuild silently skips when prebuilt binaries are present.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const electronDir = resolve(backendRoot, '..', 'electron')
const _require = createRequire(join(electronDir, 'package.json'))
try {
  const electronPkg = _require('electron/package.json')
  const electronVersion = electronPkg.version
  const arch = process.arch

  const betterSqliteDir = join(dst, 'better-sqlite3')
  console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} (${arch})...`)
  execFileSync('npx', [
    '--yes', 'node-gyp', 'rebuild',
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
    '--runtime=electron',
  ], { stdio: 'inherit', cwd: betterSqliteDir })
  console.log('Native module rebuild complete.')
} catch (err) {
  console.warn('Warning: Could not rebuild native modules for Electron:', err.message)
  console.warn('The packaged app may fail if native module ABI does not match.')
}
