import { mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(__dirname, '..')
const helperPackageRoot = resolve(packageRoot, 'native', 'dune-host-operator-helper')
const outputPath = resolve(packageRoot, 'bin', 'dune-host-operator-helper')

if (process.platform !== 'darwin') {
  rmSync(outputPath, { force: true })
  process.exit(0)
}

if (!existsSync(helperPackageRoot)) {
  console.warn('[host-operator-helper] package missing, skipping build')
  process.exit(0)
}

const version = spawnSync('swift', ['--version'], { encoding: 'utf-8' })
if (version.status !== 0) {
  console.warn('[host-operator-helper] swift unavailable, skipping build')
  process.exit(0)
}

const build = spawnSync('swift', ['build', '-c', 'release', '--package-path', helperPackageRoot], {
  stdio: 'inherit',
})
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

mkdirSync(dirname(outputPath), { recursive: true })
copyFileSync(resolve(helperPackageRoot, '.build', 'release', 'dune-host-operator-helper'), outputPath)
