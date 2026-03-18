import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function ensureBoxliteHome(dataRoot: string): string {
  const boxliteHome = join(dataRoot, 'boxlite')
  const legacyBoxliteHome = join(dataRoot, 'b')

  mkdirSync(dataRoot, { recursive: true })

  try {
    if (existsSync(boxliteHome)) {
      const stat = lstatSync(boxliteHome)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        rmSync(boxliteHome, { recursive: true, force: true })
      }
    }

    if (existsSync(legacyBoxliteHome)) {
      const stat = lstatSync(legacyBoxliteHome)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        rmSync(legacyBoxliteHome, { recursive: true, force: true })
      } else if (!existsSync(boxliteHome)) {
        renameSync(legacyBoxliteHome, boxliteHome)
      } else {
        cpSync(legacyBoxliteHome, boxliteHome, {
          recursive: true,
          force: false,
          errorOnExist: false,
        })
        rmSync(legacyBoxliteHome, { recursive: true, force: true })
      }
    }

    mkdirSync(boxliteHome, { recursive: true })
    return boxliteHome
  } catch {
    mkdirSync(boxliteHome, { recursive: true })
    return boxliteHome
  }
}
