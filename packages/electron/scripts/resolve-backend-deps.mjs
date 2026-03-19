#!/usr/bin/env node
/**
 * Copies external (non-bundled) native modules into a flat output directory
 * and rebuilds them for Electron's Node ABI.
 *
 * Since the backend is bundled with esbuild, only native .node addons
 * that cannot be bundled need to ship separately:
 *  - better-sqlite3 (native SQLite addon + transitive deps)
 *  - @boxlite-ai/boxlite-{platform}-{arch} (native boxlite binary)
 *
 * Usage: node resolve-backend-deps.mjs <backend-root> <output-node-modules>
 */
import { cpSync, mkdirSync, existsSync, rmSync, lstatSync, readlinkSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const [backendRoot, outputDir] = process.argv.slice(2)
if (!backendRoot || !outputDir) {
  console.error('Usage: resolve-backend-deps.mjs <backend-root> <output-node-modules>')
  process.exit(1)
}

const backendNM = resolve(backendRoot, 'node_modules')
const repoRoot = resolve(backendRoot, '..', '..')
const dst = resolve(outputDir)

if (!existsSync(backendNM)) {
  console.error(`Source not found: ${backendNM}`)
  process.exit(1)
}

if (existsSync(dst)) rmSync(dst, { recursive: true })
mkdirSync(dst, { recursive: true })

let copied = 0

function resolveSymlink(linkPath) {
  const target = readlinkSync(linkPath)
  return resolve(dirname(linkPath), target)
}

function realPathOf(p) {
  const stat = lstatSync(p)
  return stat.isSymbolicLink() ? resolveSymlink(p) : p
}

function copyPkg(realPath, destPath) {
  if (existsSync(destPath)) return
  const prefix = realPath + '/'
  cpSync(realPath, destPath, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      if (src === realPath) return true
      const rel = src.startsWith(prefix) ? src.slice(prefix.length) : ''
      return !rel.includes('node_modules')
    },
  })
  copied++
  console.log(`  copied: ${destPath.replace(dst + '/', '')}`)
}

// -- 1. Copy better-sqlite3 (JS + native binary only, no transitive deps) --
// The backend uses the `nativeBinding` constructor option to point directly
// to the .node file, bypassing the `bindings` → `file-uri-to-path` chain.
const bs3Src = join(backendNM, 'better-sqlite3')
if (existsSync(bs3Src)) {
  const bs3Real = realPathOf(bs3Src)
  copyPkg(bs3Real, join(dst, 'better-sqlite3'))
}

// -- 2. Copy @boxlite-ai platform-specific native binaries --
// These are optional deps and may live in the root pnpm store
const rootPnpmNM = join(repoRoot, 'node_modules', '.pnpm', 'node_modules')
if (existsSync(rootPnpmNM)) {
  const boxliteScope = join(rootPnpmNM, '@boxlite-ai')
  if (existsSync(boxliteScope)) {
    for (const sub of readdirSync(boxliteScope)) {
      if (!sub.includes('darwin') && !sub.includes('linux') && !sub.includes('win32')) continue
      const subReal = realPathOf(join(boxliteScope, sub))
      copyPkg(subReal, join(dst, '@boxlite-ai', sub))
    }
  }
}

console.log(`Resolved ${copied} external packages to ${dst}`)

// -- 3. Rebuild better-sqlite3 for Electron's Node ABI --
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
