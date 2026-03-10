import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  cleanupSandboxPath,
  listSandboxPath,
  preflightDorianRuntime,
  type ActorIdentity,
} from './helpers/sandbox-e2e-api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.SANDBOX_E2E_BASE_URL || 'http://localhost:3100'
const FRONTEND_URL = process.env.SANDBOX_E2E_FRONTEND_URL || 'http://localhost:4173'
const BOX_ID_OVERRIDE = process.env.SANDBOX_E2E_BOX_ID?.trim() || null
const SYSTEM_ACTOR_ID = process.env.SANDBOX_E2E_SYSTEM_ACTOR_ID || 'agent:operator'
const HUMAN_ACTOR_ID = process.env.SANDBOX_E2E_HUMAN_ACTOR_ID || 'admin'
const HOST_IMPORT_ROOT = process.env.SANDBOX_E2E_HOST_ROOT || resolve(__dirname, '../../../test-results/e2e-host-import')

const SYSTEM_ACTOR: ActorIdentity = {
  actorType: 'system',
  actorId: SYSTEM_ACTOR_ID,
}

const HUMAN_ACTOR: ActorIdentity = {
  actorType: 'human',
  actorId: HUMAN_ACTOR_ID,
}

type RunState = {
  runId: string
  sandboxTempRoot: string
  hostImportFile: string
}

let runState: RunState | null = null
let boxId = BOX_ID_OVERRIDE

function getBoxId(): string {
  if (!boxId) {
    throw new Error('sandbox fixture not initialized')
  }
  return boxId
}

function nextRunState(): RunState {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    runId,
    sandboxTempRoot: `/tmp/dune-playwright-${runId}`,
    hostImportFile: join(HOST_IMPORT_ROOT, `dune-playwright-host-${runId}.txt`),
  }
}

async function setActorInBrowser(page: Page, actor: ActorIdentity): Promise<void> {
  await page.evaluate(async ({ actorType, actorId }) => {
    const mod = await import('/src/services/api-client.ts')
    mod.setSandboxActorIdentity({ actorType, actorId })
  }, actor)
  await page.reload()
}

async function openDorianFilesTab(page: Page): Promise<void> {
  await page.goto(FRONTEND_URL)
  await page.getByTestId('nav-sandboxes').click()
  const sandboxCard = page.locator(`[data-testid="sandbox-card"][data-box-id="${getBoxId()}"]`)
  await expect(sandboxCard).toBeVisible()
  await sandboxCard.click()
  await page.getByTestId('sandbox-tab-files').click()
  await expect(page.getByTestId('sandbox-files-explorer')).toBeVisible()
}

async function createPathFromDialog(
  page: Page,
  action: 'new-file' | 'new-folder' | 'import-host',
  primaryPath: string,
  options?: { secondaryPath?: string; content?: string },
): Promise<void> {
  await page.getByTestId('fs-actions-select').selectOption(action)
  await expect(page.getByTestId('fs-dialog')).toBeVisible()
  await page.getByTestId('fs-dialog-primary').fill(primaryPath)
  if (options?.secondaryPath !== undefined) {
    await page.getByTestId('fs-dialog-secondary').fill(options.secondaryPath)
  }
  if (options?.content !== undefined) {
    await page.getByTestId('fs-dialog-content').fill(options.content)
  }
  await page.getByTestId('fs-dialog-submit').click()
}

test.beforeAll(async () => {
  const box = await preflightDorianRuntime({
    baseUrl: BASE_URL,
    boxId,
    humanActor: HUMAN_ACTOR,
  })
  boxId = box.boxId
})

test.afterEach(async () => {
  if (!runState) return
  await cleanupSandboxPath({
    baseUrl: BASE_URL,
    boxId: getBoxId(),
    path: runState.sandboxTempRoot,
    systemActor: SYSTEM_ACTOR,
  })
  await fs.rm(runState.hostImportFile, { force: true })
  runState = null
})

test('human actor has full read-write access to managed sandboxes', async ({ page }) => {
  runState = nextRunState()

  await page.goto(FRONTEND_URL)
  await setActorInBrowser(page, HUMAN_ACTOR)
  await openDorianFilesTab(page)

  await expect(page.getByTestId('fs-actions-select')).toBeEnabled()
  await expect(page.getByTestId('fs-action-error')).toHaveCount(0)
})

test('system actor completes Finder workflow on temporary sandbox paths', async ({ page }) => {
  runState = nextRunState()
  const notePath = `${runState.sandboxTempRoot}/note.txt`
  const renamedPath = `${runState.sandboxTempRoot}/note-renamed.txt`
  const hiddenPath = `${runState.sandboxTempRoot}/.hidden.txt`
  const importedPath = `${runState.sandboxTempRoot}/${basename(runState.hostImportFile)}`
  const noteContent = `hello from playwright e2e ${runState.runId}`
  const importedContent = `from-host-import-${runState.runId}`

  await page.goto(FRONTEND_URL)
  await setActorInBrowser(page, SYSTEM_ACTOR)
  await openDorianFilesTab(page)
  await page.locator('[data-testid="fs-breadcrumb-crumb"][data-path="/"]').first().click()

  await createPathFromDialog(page, 'new-folder', runState.sandboxTempRoot)
  const tmpRow = page.locator('[data-testid="fs-row"][data-path="/tmp"]')
  const tmpTreeRow = page.locator('[data-testid="fs-tree-row"][data-path="/tmp"]')
  await expect(tmpRow).toBeVisible()
  await expect(tmpTreeRow).toBeVisible()
  await tmpTreeRow.click()

  const rootRow = page.locator(`[data-testid="fs-row"][data-path="${runState.sandboxTempRoot}"]`)
  const rootTreeRow = page.locator(`[data-testid="fs-tree-row"][data-path="${runState.sandboxTempRoot}"]`)
  await expect(rootTreeRow).toBeVisible()
  await rootTreeRow.click()
  await expect(page.locator(`[data-testid="fs-breadcrumb-crumb"][data-path="${runState.sandboxTempRoot}"]`)).toBeVisible()
  await page.locator('[data-testid="fs-breadcrumb-crumb"][data-path="/tmp"]').click()
  await expect(rootRow).toBeVisible()
  await rootTreeRow.click()
  await page.getByTestId('fs-up-btn').click()
  await expect(rootRow).toBeVisible()
  await rootTreeRow.click()

  await createPathFromDialog(page, 'new-file', notePath, { content: noteContent })
  const noteRow = page.locator(`[data-testid="fs-row"][data-path="${notePath}"]`)
  await expect(noteRow).toBeVisible()

  await noteRow.click()
  await expect(page.getByTestId('fs-preview-body')).toContainText(noteContent)

  await createPathFromDialog(page, 'new-file', hiddenPath, { content: 'secret-dotfile' })
  await expect(page.locator(`[data-testid="fs-row"][data-path="${hiddenPath}"]`)).toHaveCount(0)
  await page.getByTestId('fs-hidden-toggle').check()
  await expect(page.locator(`[data-testid="fs-row"][data-path="${hiddenPath}"]`)).toBeVisible()
  await page.getByTestId('fs-hidden-toggle').uncheck()
  await expect(page.locator(`[data-testid="fs-row"][data-path="${hiddenPath}"]`)).toHaveCount(0)

  await noteRow.click()
  await page.getByTestId('fs-actions-select').selectOption('rename')
  await expect(page.getByTestId('fs-dialog')).toBeVisible()
  await page.getByTestId('fs-dialog-secondary').fill(renamedPath)
  await page.getByTestId('fs-dialog-submit').click()

  const renamedRow = page.locator(`[data-testid="fs-row"][data-path="${renamedPath}"]`)
  await expect(renamedRow).toBeVisible()
  await expect(noteRow).toHaveCount(0)

  await page.getByTestId('fs-search-input').fill('note-renamed')
  await expect(renamedRow).toBeVisible()
  await page.getByTestId('fs-search-input').fill('')

  await renamedRow.click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('fs-download-btn').click(),
  ])
  const downloadedPath = await download.path()
  expect(downloadedPath).toBeTruthy()
  const downloadedContent = await fs.readFile(downloadedPath!, 'utf8')
  expect(downloadedContent).toBe(noteContent)

  await fs.mkdir(HOST_IMPORT_ROOT, { recursive: true })
  await fs.writeFile(runState.hostImportFile, `${importedContent}\n`, 'utf8')
  await createPathFromDialog(page, 'import-host', runState.hostImportFile, { secondaryPath: importedPath })
  const importedRow = page.locator(`[data-testid="fs-row"][data-path="${importedPath}"]`)
  await expect(importedRow).toBeVisible()

  await importedRow.click()
  await expect(page.getByTestId('fs-preview-body')).toContainText(importedContent)

  await page.locator('[data-testid="fs-breadcrumb-crumb"][data-path="/"]').click()
  const usrRow = page.locator('[data-testid="fs-row"][data-path="/usr"]')
  await expect(usrRow).toBeVisible()
  await usrRow.dblclick()
  const usrBinRow = page.locator('[data-testid="fs-row"][data-path="/usr/bin"]')
  await expect(usrBinRow).toBeVisible()
  await usrBinRow.dblclick()
  await page.getByTestId('fs-search-input').fill('bash')
  const largeRow = page.locator('[data-testid="fs-row"][data-path="/usr/bin/bash"]')
  await expect(largeRow).toBeVisible()
  await largeRow.click()
  await expect(page.getByTestId('fs-preview-head')).toContainText('preview truncated')
  await page.getByTestId('fs-search-input').fill('')

  const dialogMessages: string[] = []
  const dialogHandler = async (dialog: { message(): string; accept(): Promise<void> }) => {
    dialogMessages.push(dialog.message())
    await dialog.accept()
  }

  page.on('dialog', dialogHandler as any)
  try {
    await page.locator('[data-testid="fs-breadcrumb-crumb"][data-path="/"]').click()
    await expect(tmpRow).toBeVisible()
    await tmpRow.dblclick()
    await expect(page.locator('[data-testid="fs-breadcrumb-crumb"][data-path="/tmp"]')).toBeVisible()
    await page.getByTestId('fs-search-input').fill(runState.runId)
    await expect(rootRow).toBeVisible()
    await rootRow.click()
    await page.getByTestId('fs-delete-btn').click()
    await expect(rootRow).toHaveCount(0)
    await page.getByTestId('fs-search-input').fill('')
  } finally {
    page.off('dialog', dialogHandler as any)
  }

  expect(dialogMessages.some((msg) => msg.includes('Delete'))).toBeTruthy()
  expect(dialogMessages.some((msg) => msg.includes('not empty'))).toBeTruthy()

  await cleanupSandboxPath({
    baseUrl: BASE_URL,
    boxId: getBoxId(),
    path: runState.sandboxTempRoot,
    systemActor: SYSTEM_ACTOR,
  })

  const listResult = await listSandboxPath({
    baseUrl: BASE_URL,
    boxId: getBoxId(),
    path: '/tmp',
    includeHidden: true,
    actor: SYSTEM_ACTOR,
  })
  expect(listResult.entries.some((entry) => entry.path === runState.sandboxTempRoot)).toBe(false)
})
