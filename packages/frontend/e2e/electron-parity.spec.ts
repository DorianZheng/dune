import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import {
  captureDesktopWindowScreenshot,
  cleanupLaunchSessions,
  launchDuneApp,
  repoRoot,
  type LaunchSession,
} from './electron-test-utils.js'

const parityOutputRoot = resolve(repoRoot, 'test-results/manual-parity')
const parityFixtureRoot = resolve(repoRoot, 'packages/frontend/e2e/fixtures/parity')
const parityViewport = { width: 1600, height: 1040 }
const parityWindowBounds = { x: 48, y: 48, width: 1600, height: 1040 }
const updateFixtures = process.env.UPDATE_PARITY_FIXTURES === '1'

type ParityStateId =
  | 'lightExpandedNewThread'
  | 'lightHiddenNewThread'
  | 'darkExpandedActiveThread'
  | 'darkHiddenActiveThread'

type ParityTheme = 'light' | 'dark'
type ParitySidebar = 'expanded' | 'hidden'

type Box = {
  x: number
  y: number
  width: number
  height: number
}

type ParityStateConfig = {
  id: ParityStateId
  label: string
  theme: ParityTheme
  sidebar: ParitySidebar
  referenceRasterPath: string
  captureFilename: string
  diffFilename: string
}

const parityStates = {
  lightExpandedNewThread: {
    id: 'lightExpandedNewThread',
    label: 'Light Expanded New Thread',
    theme: 'light',
    sidebar: 'expanded',
    referenceRasterPath: resolve(parityFixtureRoot, 'reference-dune-light-expanded-new-thread.png'),
    captureFilename: 'dune-desktop-parity-light-expanded-new-thread.png',
    diffFilename: 'dune-desktop-parity-light-expanded-new-thread-diff.png',
  },
  lightHiddenNewThread: {
    id: 'lightHiddenNewThread',
    label: 'Light Hidden New Thread',
    theme: 'light',
    sidebar: 'hidden',
    referenceRasterPath: resolve(parityFixtureRoot, 'reference-dune-light-hidden-new-thread.png'),
    captureFilename: 'dune-desktop-parity-light-hidden-new-thread.png',
    diffFilename: 'dune-desktop-parity-light-hidden-new-thread-diff.png',
  },
  darkExpandedActiveThread: {
    id: 'darkExpandedActiveThread',
    label: 'Dark Expanded Active Thread',
    theme: 'dark',
    sidebar: 'expanded',
    referenceRasterPath: resolve(parityFixtureRoot, 'reference-dune-dark-expanded-active-thread.png'),
    captureFilename: 'dune-desktop-parity-dark-expanded-active-thread.png',
    diffFilename: 'dune-desktop-parity-dark-expanded-active-thread-diff.png',
  },
  darkHiddenActiveThread: {
    id: 'darkHiddenActiveThread',
    label: 'Dark Hidden Active Thread',
    theme: 'dark',
    sidebar: 'hidden',
    referenceRasterPath: resolve(parityFixtureRoot, 'reference-dune-dark-hidden-active-thread.png'),
    captureFilename: 'dune-desktop-parity-dark-hidden-active-thread.png',
    diffFilename: 'dune-desktop-parity-dark-hidden-active-thread-diff.png',
  },
} satisfies Record<ParityStateId, ParityStateConfig>

const parityStateOrder: ParityStateId[] = [
  'lightExpandedNewThread',
  'lightHiddenNewThread',
  'darkExpandedActiveThread',
  'darkHiddenActiveThread',
]

const PRIMARY_CHANNEL_NAME = 'Evaluate necessity of webapp and electron app'
const PRIMARY_CHANNEL_SELECTOR_TEXT = 'Evaluate necessity of webapp'
const ALLOWED_DIFF_RATIO = 0.008

const parityChannels = [
  {
    name: PRIMARY_CHANNEL_NAME,
    description: 'Desktop-first parity baseline for shell comparison.',
  },
  { name: 'test the electron app E2E', description: 'Validate the packaged desktop shell and smoke coverage.' },
  { name: 'Copy rescreen repo for dune', description: 'Track repo setup and parity artifacts.' },
  { name: 'Check agent status', description: 'Review runtime status and lifecycle alignment.' },
  { name: 'Update boxlite to latest version', description: 'Packaging and runtime maintenance work.' },
]

const parityAgents = [
  {
    name: 'Aurora',
    personality: 'Focuses on desktop shell QA, release coordination, and UI parity.',
    role: 'follower',
    workMode: 'normal',
    avatarColor: '#4e8cff',
  },
  {
    name: 'Dorian',
    personality: 'Tracks parity gaps, density issues, and screenshot regressions.',
    role: 'follower',
    workMode: 'normal',
    avatarColor: '#6fcb8b',
  },
]

const parityMessages = [
  {
    authorName: 'admin',
    content: 'please use visualization to check parity',
  },
  {
    authorName: 'Aurora',
    content: [
      'I tightened the desktop shell against the reference and kept the remaining parity work focused on the visible details: borders, toolbar compactness, and center-pane density.',
      '',
      '| File | Delta |',
      '| --- | ---: |',
      '| packages/frontend/e2e/electron-smoke.spec.ts | +43 -2 |',
      '| packages/frontend/src/app-shell.ts | +421 -97 |',
      '| packages/frontend/src/components/agents/agent-chat-view.ts | +72 -44 |',
      '| packages/frontend/src/components/layout/codex-composer.ts | +50 -23 |',
      '| packages/frontend/src/components/layout/message-area.ts | +101 -76 |',
      '| packages/frontend/src/components/layout/sidebar-panel.ts | +158 -167 |',
      '| packages/frontend/src/styles/theme.css | +160 -120 |',
    ].join('\n'),
  },
  {
    authorName: 'Dorian',
    content: [
      'The next pass is only about parity. The current shell is in the right family, but the sidebar header, list rhythm, and dock rectangle still need to land closer to the screenshots.',
      '',
      'The updated audit now compares a real window capture against a visual reference instead of scoring geometry alone.',
    ].join('\n'),
  },
]

test.afterEach(async () => {
  await cleanupLaunchSessions()
})

test('captures deterministic desktop parity baselines across functionality-safe shell states', async () => {
  const session = await launchDuneApp({ bypassSingleInstance: true })
  if (!session?.page) {
    throw new Error('Expected the built Electron app to open a window for parity capture')
  }

  const { page } = session
  if (process.platform !== 'darwin') {
    await page.setViewportSize(parityViewport)
  }
  await expect(page.locator('app-shell')).toBeVisible()

  await seedParityScene(page)

  const results: Array<{
    id: ParityStateId
    label: string
    theme: ParityTheme
    sidebar: ParitySidebar
    diffRatio: number
    referenceRasterPath: string
    captureFilename: string
    diffFilename: string
  }> = []

  await applyUiPreferences(page, 'light', false)
  await selectNewThread(page)
  results.push(await captureState(parityStates.lightExpandedNewThread, page, session, { sidebarHidden: false }))

  await hideSidebarForCapture(page)
  results.push(await captureState(parityStates.lightHiddenNewThread, page, session, { sidebarHidden: true }))

  await applyUiPreferences(page, 'dark', false)
  await selectPrimaryChannel(page)
  results.push(await captureState(parityStates.darkExpandedActiveThread, page, session, { sidebarHidden: false }))

  await hideSidebarForCapture(page)
  results.push(await captureState(parityStates.darkHiddenActiveThread, page, session, { sidebarHidden: true }))

  await fs.mkdir(parityOutputRoot, { recursive: true })
  await fs.writeFile(
    join(parityOutputRoot, 'parity-metrics.json'),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      updateFixtures,
      viewport: parityViewport,
      states: results,
    }, null, 2)}\n`,
    'utf8',
  )

  for (const result of results) {
    expect(result.diffRatio).toBeLessThanOrEqual(ALLOWED_DIFF_RATIO)
  }
})

async function seedParityScene(page: Page): Promise<void> {
  await page.evaluate(
    async ({ channels, agents, messages, primaryChannelName }) => {
      type RequestJsonOptions = RequestInit & { allowNotFound?: boolean }
      const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const headers = new Headers(init?.headers || {})
        if (init?.body && !headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json')
        }
        const response = await fetch(path, {
          ...init,
          headers,
        })
        if (!response.ok) {
          const text = await response.text()
          throw new Error(`${path} failed: ${response.status} ${text}`)
        }
        return response.json() as Promise<T>
      }

      const requestOptionalJson = async <T>(path: string, init?: RequestJsonOptions): Promise<T | null> => {
        const headers = new Headers(init?.headers || {})
        if (init?.body && !headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json')
        }
        const response = await fetch(path, {
          ...init,
          headers,
        })
        if (response.status === 404 && init?.allowNotFound) {
          return null
        }
        if (!response.ok) {
          const text = await response.text()
          throw new Error(`${path} failed: ${response.status} ${text}`)
        }
        return response.json() as Promise<T>
      }

      type CreatedChannel = { id: string; name: string }
      type CreatedAgent = { id: string; name: string }
      type SeedMessage = { authorName: string; content: string }
      type StoredMessage = { authorId: string; content: string }

      const createOrReuseChannel = async (channel: { name: string; description: string }) => {
        try {
          return await requestJson<CreatedChannel>('/api/channels', {
            method: 'POST',
            body: JSON.stringify(channel),
          })
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('/api/channels failed: 409')) throw error
          const existing = await requestOptionalJson<CreatedChannel>(`/api/channels/by-name/${encodeURIComponent(channel.name)}`, { allowNotFound: true })
          if (!existing) throw error
          return existing
        }
      }

      const createOrReuseAgent = async (agent: { name: string; personality: string; avatarColor: string }) => {
        try {
          return await requestJson<CreatedAgent>('/api/agents', {
            method: 'POST',
            body: JSON.stringify(agent),
          })
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('/api/agents failed: 409')) throw error
          const existing = await requestOptionalJson<CreatedAgent>(`/api/agents/by-name/${encodeURIComponent(agent.name)}`, { allowNotFound: true })
          if (!existing) throw error
          return existing
        }
      }

      const createdChannels = new Map<string, CreatedChannel>()
      for (const channel of channels) {
        const created = await createOrReuseChannel(channel)
        createdChannels.set(created.name, created)
      }

      const createdAgents = new Map<string, CreatedAgent>()
      for (const agent of agents) {
        const created = await createOrReuseAgent(agent)
        createdAgents.set(created.name, created)
      }

      const primaryChannel = createdChannels.get(primaryChannelName)
      const aurora = createdAgents.get('Aurora')
      const dorian = createdAgents.get('Dorian')
      if (!primaryChannel || !aurora || !dorian) {
        throw new Error('Failed to seed the canonical parity scene')
      }

      for (const agentId of [aurora.id, dorian.id]) {
        await requestJson(`/api/channels/${primaryChannel.id}/subscribe`, {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        })
      }

      const expectedMessages: Array<StoredMessage> = messages.map((message: SeedMessage) => {
        const authorId = message.authorName === 'admin'
          ? 'admin'
          : createdAgents.get(message.authorName)?.id
        if (!authorId) {
          throw new Error(`Unknown seeded author: ${message.authorName}`)
        }
        return {
          authorId,
          content: message.content,
        }
      })

      const existingMessages = await requestJson<StoredMessage[]>(`/api/channels/${primaryChannel.id}/messages?limit=${messages.length}`)
      const messagesMatch = existingMessages.length === expectedMessages.length
        && existingMessages.every((message, index) => message.content === expectedMessages[index].content)

      if (!messagesMatch) {
        if (existingMessages.length > 0) {
          throw new Error(`Canonical parity channel "${primaryChannelName}" already exists with non-matching messages`)
        }
        for (const message of expectedMessages) {
          await requestJson(`/api/channels/${primaryChannel.id}/messages`, {
            method: 'POST',
            body: JSON.stringify(message),
          })
        }
      }
    },
    {
      channels: parityChannels,
      agents: parityAgents,
      messages: parityMessages,
      primaryChannelName: PRIMARY_CHANNEL_NAME,
    },
  )
}

async function applyUiPreferences(page: Page, theme: ParityTheme, collapsed: boolean): Promise<void> {
  await page.evaluate(({ nextTheme, isCollapsed }) => {
    localStorage.setItem('dune.ui.themeMode', nextTheme)
    localStorage.setItem('dune.ui.sidebarCollapsed', isCollapsed ? '1' : '0')
  }, { nextTheme: theme, isCollapsed: collapsed })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('app-shell')).toBeVisible()
  await waitForShellStability(page, { sidebarHidden: collapsed })
}

async function selectPrimaryChannel(page: Page): Promise<void> {
  const titledTarget = page.locator('sidebar-panel').locator(`button[title="${PRIMARY_CHANNEL_NAME}"]`).first()
  if (await titledTarget.count()) {
    await titledTarget.click()
  } else {
    const target = page.locator('sidebar-panel .row.kind-channel').filter({ hasText: PRIMARY_CHANNEL_SELECTOR_TEXT }).first()
    await expect(target).toBeVisible()
    await target.click()
  }
  await expect(page.getByTestId('desktop-toolbar-title')).toContainText('Evaluate necessity')
  await expect(page.getByTestId('composer-dock')).toBeVisible()
  await expect(page.getByTestId('messages-lane').locator('message-item')).toHaveCount(parityMessages.filter((message) => message.authorName !== 'admin').length)
}

async function selectNewThread(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const shell = document.querySelector('app-shell') as {
      selectChannel?: (channelId: string) => Promise<void>
    } | null
    if (!shell?.selectChannel) {
      throw new Error('App shell did not expose selectChannel for parity setup')
    }
    await shell.selectChannel('')
  })
  await expect(page.getByTestId('desktop-toolbar-title')).toContainText('New thread')
  await expect(page.getByTestId('composer-dock')).toHaveCount(0)
}

async function waitForShellStability(page: Page, options: { sidebarHidden: boolean }): Promise<void> {
  if (options.sidebarHidden) {
    await expect(page.getByTestId('toolbar-leading-cluster')).toBeVisible()
    await expect(page.getByTestId('sidebar-header')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('sidebar-header')).toBeVisible()
  }

  await expect(page.getByTestId('desktop-toolbar')).toBeVisible()
  await page.evaluate(async () => {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    if ('fonts' in document) {
      await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready
    }
  })
}

async function hideSidebarForCapture(page: Page): Promise<void> {
  await page.getByTestId('sidebar-toggle').click()
  await waitForShellStability(page, { sidebarHidden: true })
}

async function captureState(
  config: ParityStateConfig,
  page: Page,
  session: LaunchSession,
  options: { sidebarHidden: boolean },
): Promise<{
  id: ParityStateId
  label: string
  theme: ParityTheme
  sidebar: ParitySidebar
  diffRatio: number
  referenceRasterPath: string
  captureFilename: string
  diffFilename: string
}> {
  const capturePath = join(parityOutputRoot, config.captureFilename)
  const diffPath = join(parityOutputRoot, config.diffFilename)
  await fs.mkdir(dirname(capturePath), { recursive: true })
  await waitForShellStability(page, options)
  const maskBoxes = await collectMaskBoxes(page)
  await captureDesktopWindowScreenshot(session, capturePath, parityWindowBounds)
  const diffRatio = await compareOrUpdateCapture(capturePath, config.referenceRasterPath, diffPath, maskBoxes)

  return {
    id: config.id,
    label: config.label,
    theme: config.theme,
    sidebar: config.sidebar,
    diffRatio,
    referenceRasterPath: config.referenceRasterPath,
    captureFilename: config.captureFilename,
    diffFilename: config.diffFilename,
  }
}

async function collectMaskBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    type RectBox = { x: number; y: number; width: number; height: number }

    const boxes: RectBox[] = []
    const collect = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll('.time')) {
        const rect = element.getBoundingClientRect()
        boxes.push({
          x: Math.round(rect.x * 100) / 100,
          y: Math.round(rect.y * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        })
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      let current = walker.nextNode()
      while (current) {
        const element = current as HTMLElement
        if (element.shadowRoot) collect(element.shadowRoot)
        current = walker.nextNode()
      }
    }

    collect(document)
    return boxes
  })
}

async function compareOrUpdateCapture(
  capturePath: string,
  referencePath: string,
  diffPath: string,
  maskBoxes: Box[],
): Promise<number> {
  await fs.mkdir(dirname(referencePath), { recursive: true })

  if (updateFixtures || !(await fileExists(referencePath))) {
    await fs.copyFile(capturePath, referencePath)
  }

  const actual = normalizePng(await readPng(capturePath))
  const reference = normalizePng(await readPng(referencePath))

  if (actual.width !== reference.width || actual.height !== reference.height) {
    throw new Error(`Parity reference dimensions do not match capture: capture=${actual.width}x${actual.height}, reference=${reference.width}x${reference.height}`)
  }

  const scaleX = actual.width / parityViewport.width
  const scaleY = actual.height / parityViewport.height
  applyMasks(actual, maskBoxes, scaleX, scaleY)
  applyMasks(reference, maskBoxes, scaleX, scaleY)

  const diffImage = new PNG({ width: actual.width, height: actual.height })
  const changedPixels = pixelmatch(actual.data, reference.data, diffImage.data, actual.width, actual.height, {
    threshold: 0.18,
    includeAA: false,
  })
  await fs.writeFile(diffPath, PNG.sync.write(diffImage))
  return changedPixels / (actual.width * actual.height)
}

function applyMasks(image: PNG, boxes: Box[], scaleX: number, scaleY: number) {
  for (const box of boxes) {
    const left = Math.max(0, Math.floor(box.x * scaleX))
    const top = Math.max(0, Math.floor(box.y * scaleY))
    const width = Math.min(image.width - left, Math.ceil(box.width * scaleX))
    const height = Math.min(image.height - top, Math.ceil(box.height * scaleY))

    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const index = ((top + row) * image.width + (left + column)) * 4
        image.data[index] = 127
        image.data[index + 1] = 127
        image.data[index + 2] = 127
        image.data[index + 3] = 255
      }
    }
  }
}

function normalizePng(image: PNG): PNG {
  const next = new PNG({ width: image.width, height: image.height })
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3] / 255
    next.data[index] = Math.round(image.data[index] * alpha)
    next.data[index + 1] = Math.round(image.data[index + 1] * alpha)
    next.data[index + 2] = Math.round(image.data[index + 2] * alpha)
    next.data[index + 3] = 255
  }
  return next
}

async function readPng(path: string): Promise<PNG> {
  const buffer = await fs.readFile(path)
  return PNG.sync.read(buffer)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}
