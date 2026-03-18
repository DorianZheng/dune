import { expect, test } from '@playwright/test'
import { cleanupLaunchSessions, launchDuneApp, type LaunchSession } from './electron-test-utils.js'

test.afterEach(async () => {
  await cleanupLaunchSessions()
})

async function ensureSidebarVisible(page: import('@playwright/test').Page) {
  const showSidebarButton = page.getByTestId('toolbar-sidebar-toggle')
  if (await showSidebarButton.count()) {
    await showSidebarButton.click()
  }
  await expect(page.getByTestId('sidebar-header')).toBeVisible()
}

async function readDesktopToolbarDragLayout(page: import('@playwright/test').Page) {
  return page.locator('app-shell').evaluate((host) => {
    const shadow = host.shadowRoot
    const toolbar = shadow?.querySelector<HTMLElement>('.pane-toolbar')
    const titleStrip = shadow?.querySelector<HTMLElement>('.pane-toolbar-title-wrap')
    const leading = shadow?.querySelector<HTMLElement>('.pane-toolbar-leading')
    const actions = shadow?.querySelector<HTMLElement>('.pane-toolbar-actions')

    if (!toolbar || !titleStrip || !actions) return null

    const readAppRegion = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      return style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || 'none'
    }

    return {
      toolbarHeight: Math.round(toolbar.getBoundingClientRect().height),
      titleStripHeight: Math.round(titleStrip.getBoundingClientRect().height),
      titleStripRegion: readAppRegion(titleStrip),
      leadingRegion: leading ? readAppRegion(leading) : null,
      actionsRegion: readAppRegion(actions),
    }
  })
}

async function readDesktopToolbarMetrics(page: import('@playwright/test').Page) {
  return page.locator('app-shell').evaluate((host) => {
    const shadow = host.shadowRoot
    const toolbar = shadow?.querySelector<HTMLElement>('.pane-toolbar')
    const title = shadow?.querySelector<HTMLElement>('[data-testid="desktop-toolbar-title"]')
    const actions = shadow?.querySelector<HTMLElement>('.pane-toolbar-actions')
    const windowControls = shadow?.querySelector<HTMLElement>('[data-testid="desktop-window-controls"]')

    if (!toolbar || !title || !actions) return null

    const readAppRegion = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      return style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || 'none'
    }

    const toolbarRect = toolbar.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    const controlsRect = windowControls?.getBoundingClientRect() ?? null

    return {
      titleTagName: title.tagName,
      titleRegion: readAppRegion(title),
      titleClientWidth: Math.round(title.clientWidth),
      titleScrollWidth: Math.round(title.scrollWidth),
      titleRight: Math.round(titleRect.right),
      actionsLeft: Math.round(actionsRect.left),
      actionsRight: Math.round(actionsRect.right),
      toolbarRight: Math.round(toolbarRect.right),
      controlsRight: controlsRect ? Math.round(controlsRect.right) : null,
    }
  })
}

async function readElementWidth(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => Math.round((element as HTMLElement).getBoundingClientRect().width))
}

async function dragHorizontalSeparator(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
  deltaX: number,
) {
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Expected separator to have a bounding box')
  }
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY, { steps: 10 })
  await page.mouse.up()
}

async function getWindowBounds(session: LaunchSession) {
  return session.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      throw new Error('Expected an Electron BrowserWindow')
    }
    return win.getBounds()
  })
}

async function setWindowSize(session: LaunchSession, width: number, height: number) {
  return session.electronApp.evaluate(async ({ BrowserWindow }, nextSize) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      throw new Error('Expected an Electron BrowserWindow')
    }
    if (win.isMaximized()) {
      win.unmaximize()
    }
    const currentBounds = win.getBounds()
    win.setBounds({
      ...currentBounds,
      width: nextSize.width,
      height: nextSize.height,
    }, false)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 180))
    return win.getBounds()
  }, { width, height })
}

type ProfileSmokeScene = {
  primaryChannelName: string
  secondaryChannelName: string
  agentName: string
  agentMessageText: string
  systemMessageText: string
}

async function seedProfileSmokeScene(page: import('@playwright/test').Page, scene: ProfileSmokeScene) {
  await page.evaluate(async ({ primaryChannelName, secondaryChannelName, agentName, agentMessageText, systemMessageText }) => {
    const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers || {})
      if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      const response = await fetch(path, { ...init, headers })
      if (!response.ok && response.status !== 409) {
        throw new Error(`${path} failed: ${response.status}`)
      }
      if (response.status === 409) return {} as T
      return response.json() as Promise<T>
    }

    const requestOptionalJson = async <T>(path: string): Promise<T | null> => {
      const response = await fetch(path)
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`${path} failed: ${response.status}`)
      }
      return response.json() as Promise<T>
    }

    type CreatedChannel = { id: string; name: string }
    type CreatedAgent = { id: string; name: string }
    type StoredMessage = { authorId: string; content: string }

    const createOrReuseChannel = async (channel: { name: string; description: string }) => {
      const created = await requestJson<CreatedChannel>('/api/channels', {
        method: 'POST',
        body: JSON.stringify(channel),
      })
      if (created?.id) return created
      const existing = await requestOptionalJson<CreatedChannel>(`/api/channels/by-name/${encodeURIComponent(channel.name)}`)
      if (!existing) throw new Error(`Failed to resolve seeded channel: ${channel.name}`)
      return existing
    }

    const createOrReuseAgent = async (agent: { name: string; personality: string; avatarColor: string }) => {
      const created = await requestJson<CreatedAgent>('/api/agents', {
        method: 'POST',
        body: JSON.stringify(agent),
      })
      if (created?.id) return created
      const existing = await requestOptionalJson<CreatedAgent>(`/api/agents/by-name/${encodeURIComponent(agent.name)}`)
      if (!existing) throw new Error(`Failed to resolve seeded agent: ${agent.name}`)
      return existing
    }

    const primaryChannel = await createOrReuseChannel({
      name: primaryChannelName,
      description: 'Smoke test channel for profile open coverage.',
    })
    await createOrReuseChannel({
      name: secondaryChannelName,
      description: 'Secondary smoke test channel for shell navigation coverage.',
    })

    const agent = await createOrReuseAgent({
      name: agentName,
      personality: 'Profile smoke test agent for desktop shell coverage.',
      avatarColor: '#4e8cff',
    })

    await requestJson(`/api/channels/${primaryChannel.id}/subscribe`, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id }),
    })

    const expectedMessages: StoredMessage[] = [
      { authorId: agent.id, content: agentMessageText },
      { authorId: 'system', content: systemMessageText },
    ]
    const existingMessages = await requestJson<StoredMessage[]>(`/api/channels/${primaryChannel.id}/messages?limit=${expectedMessages.length}`)
    const messagesMatch = existingMessages.length === expectedMessages.length
      && existingMessages.every((message, index) =>
        message.authorId === expectedMessages[index].authorId && message.content === expectedMessages[index].content)

    if (!messagesMatch) {
      if (existingMessages.length > 0) {
        throw new Error(`Seeded profile channel "${primaryChannelName}" already exists with non-matching messages`)
      }
      for (const message of expectedMessages) {
        await requestJson(`/api/channels/${primaryChannel.id}/messages`, {
          method: 'POST',
          body: JSON.stringify(message),
        })
      }
    }
  }, scene)
}

test('launches the built Electron app and preserves only functional shell controls', async () => {
  const session = await launchDuneApp({ bypassSingleInstance: true })
  if (!session?.page) {
    throw new Error('Expected the built Electron app to open a window')
  }
  const { page } = session
  const originalBounds = await getWindowBounds(session)
  const desktopBounds = {
    width: Math.max(originalBounds.width, 1280),
    height: Math.max(originalBounds.height, 800),
  }
  await setWindowSize(session, desktopBounds.width, desktopBounds.height)
  const originalViewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  await expect(page.locator('app-shell')).toBeVisible()
  await ensureSidebarVisible(page)

  await expect(page.getByTestId('desktop-toolbar')).toBeVisible()
  await expect(page.getByTestId('nav-sandboxes')).toBeVisible()
  await expect(page.getByTestId('nav-apps')).toBeVisible()
  await expect(page.getByTestId('nav-settings')).toBeVisible()

  await expect(page.getByTestId('nav-new-thread')).toHaveCount(0)
  await expect(page.getByTestId('nav-automations')).toHaveCount(0)
  await expect(page.getByTestId('nav-skills')).toHaveCount(0)
  await expect(page.getByTestId('toolbar-vscode')).toHaveCount(0)
  await expect(page.getByTestId('toolbar-hand-off')).toHaveCount(0)
  await expect(page.getByTestId('toolbar-commit')).toHaveCount(0)

  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.electron ?? null))
    .toBe('true')

  const desktopInfo = await page.evaluate(async () => {
    const duneElectron = (window as any).duneElectron
    return {
      isElectron: duneElectron?.isElectron === true,
      platform: duneElectron?.platform ?? null,
      version: typeof duneElectron?.getAppVersion === 'function'
        ? await duneElectron.getAppVersion()
        : null,
      electronDataset: document.documentElement.dataset.electron ?? null,
      platformDataset: document.documentElement.dataset.platform ?? null,
      shellMode: document.documentElement.dataset.shellMode ?? null,
    }
  })

  expect(desktopInfo.isElectron).toBe(true)
  expect(desktopInfo.electronDataset).toBe('true')
  expect(desktopInfo.platform).toBe(process.platform)
  expect(desktopInfo.platformDataset).toBe(process.platform)
  expect(desktopInfo.shellMode).toBe(process.platform === 'darwin' ? 'electron-macos' : 'electron-desktop')
  expect(desktopInfo.version).toEqual(expect.any(String))
  expect(desktopInfo.version?.trim()).not.toHaveLength(0)

  await page.locator('sidebar-panel').locator('button[title="Create channel"]').click()
  await expect(page.getByRole('heading', { level: 2, name: 'Create Channel' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.locator('sidebar-panel').locator('button[title="Create agent"]').click()
  await expect(page.getByRole('heading', { level: 2, name: 'Create Agent' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  const seedId = Date.now()
  const profileScene: ProfileSmokeScene = {
    primaryChannelName: `release-war-room-smoke-${seedId}`,
    secondaryChannelName: `release-war-room-alt-${seedId}`,
    agentName: `Profile Smoke ${seedId} with an intentionally long agent name for toolbar truncation coverage across the desktop shell, integrated agent workspace header regression coverage, and profile action placement verification`,
    agentMessageText: `Profile smoke agent check-in ${seedId}`,
    systemMessageText: `System profile smoke event ${seedId}`,
  }
  await seedProfileSmokeScene(page, profileScene)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await ensureSidebarVisible(page)
  await expect(page.locator('sidebar-panel .row.kind-channel.selected').first()).toBeVisible()
  await expect(page.getByTestId('composer-dock')).toBeVisible()

  const currentTitle = (await page.getByTestId('desktop-toolbar-title').textContent())?.trim() || ''
  const channelRows = page.locator('sidebar-panel .row.kind-channel')
  const rowCount = await channelRows.count()
  expect(rowCount).toBeGreaterThanOrEqual(2)

  let nextChannelName = ''
  for (let index = 0; index < rowCount; index += 1) {
    const row = channelRows.nth(index)
    const label = ((await row.textContent()) || '')
      .replace(/^\s*#\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (label && label !== currentTitle) {
      nextChannelName = label
      await row.click()
      break
    }
  }

  expect(nextChannelName).not.toHaveLength(0)
  await expect(page.getByTestId('desktop-toolbar-title')).toContainText(nextChannelName)

  await expect(page.getByTestId('sidebar-resizer')).toBeVisible()
  const initialSidebarWidth = await readElementWidth(page.getByTestId('sidebar-region'))
  await dragHorizontalSeparator(page, page.getByTestId('sidebar-resizer'), 96)
  const draggedSidebarWidth = await readElementWidth(page.getByTestId('sidebar-region'))
  expect(draggedSidebarWidth).toBeGreaterThan(initialSidebarWidth + 40)

  await page.getByTestId('sidebar-resizer').focus()
  await page.keyboard.press('Shift+ArrowLeft')
  const keyboardSidebarWidth = await readElementWidth(page.getByTestId('sidebar-region'))
  expect(keyboardSidebarWidth).toBeLessThan(draggedSidebarWidth)
  expect(draggedSidebarWidth - keyboardSidebarWidth).toBeGreaterThanOrEqual(24)

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('toolbar-leading-cluster')).toBeVisible()
  await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeVisible()
  await expect(page.getByTestId('sidebar-header')).toHaveCount(0)
  await expect
    .poll(async () => page.getByTestId('sidebar-region').evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(0)

  const dragLayout = await readDesktopToolbarDragLayout(page)
  expect(dragLayout).not.toBeNull()
  expect(dragLayout?.titleStripRegion).toBe('drag')
  expect(dragLayout?.leadingRegion).toBe('no-drag')
  expect(dragLayout?.actionsRegion).toBe('no-drag')
  expect(dragLayout?.titleStripHeight).toBeGreaterThanOrEqual((dragLayout?.toolbarHeight ?? 0) - 8)

  await page.getByTestId('toolbar-sidebar-toggle').click()
  await expect(page.getByTestId('sidebar-header')).toBeVisible()
  await expect
    .poll(async () => readElementWidth(page.getByTestId('sidebar-region')))
    .toBe(keyboardSidebarWidth)

  const agentRow = page.locator('sidebar-panel .row.kind-agent').filter({ hasText: profileScene.agentName }).first()
  await expect(agentRow).toBeVisible()
  await agentRow.click()
  await expect(page.getByTestId('desktop-toolbar-title')).toContainText(profileScene.agentName)
  await expect(page.getByTestId('agent-profile-header')).toHaveCount(0)

  const agentToolbarMetrics = await readDesktopToolbarMetrics(page)
  expect(agentToolbarMetrics).not.toBeNull()
  expect(agentToolbarMetrics?.titleTagName).toBe('BUTTON')
  expect(agentToolbarMetrics?.titleRegion).toBe('no-drag')
  expect(agentToolbarMetrics?.titleClientWidth).toBeGreaterThan(0)
  expect(agentToolbarMetrics?.titleScrollWidth).toBeGreaterThan(agentToolbarMetrics?.titleClientWidth ?? 0)
  expect(agentToolbarMetrics?.titleRight).toBeLessThanOrEqual((agentToolbarMetrics?.actionsLeft ?? 0) + 1)
  expect(agentToolbarMetrics?.actionsRight).toBeLessThanOrEqual((agentToolbarMetrics?.toolbarRight ?? 0) + 1)
  if (agentToolbarMetrics?.controlsRight !== null) {
    expect(agentToolbarMetrics.controlsRight).toBeLessThanOrEqual((agentToolbarMetrics?.toolbarRight ?? 0) + 1)
  }

  await page.getByTestId('desktop-toolbar-title').click()
  await expect(page.locator('agent-profile-panel')).toBeVisible()
  await expect(page.getByTestId('agent-profile-resizer')).toBeVisible()
  const initialInspectorWidth = await readElementWidth(page.getByTestId('agent-profile-modal'))
  await dragHorizontalSeparator(page, page.getByTestId('agent-profile-resizer'), -120)
  const resizedInspectorWidth = await readElementWidth(page.getByTestId('agent-profile-modal'))
  expect(resizedInspectorWidth).toBeGreaterThan(initialInspectorWidth + 60)
  await page.getByRole('button', { name: 'Close agent profile' }).click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)

  await page.getByTestId('desktop-toolbar-title').click()
  await expect(page.locator('agent-profile-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Close agent profile' }).click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)

  const seededChannelRow = page.locator('sidebar-panel .row.kind-channel').filter({ hasText: profileScene.primaryChannelName }).first()
  await expect(seededChannelRow).toBeVisible()
  await seededChannelRow.click()
  await expect(page.getByTestId('desktop-toolbar-title')).toContainText(profileScene.primaryChannelName)
  const channelToolbarMetrics = await readDesktopToolbarMetrics(page)
  expect(channelToolbarMetrics).not.toBeNull()
  expect(channelToolbarMetrics?.titleTagName).toBe('BUTTON')
  expect(channelToolbarMetrics?.titleRegion).toBe('no-drag')
  expect(channelToolbarMetrics?.titleClientWidth).toBeGreaterThan(0)
  expect(channelToolbarMetrics?.titleRight).toBeLessThanOrEqual((channelToolbarMetrics?.actionsLeft ?? 0) + 1)
  expect(channelToolbarMetrics?.actionsRight).toBeLessThanOrEqual((channelToolbarMetrics?.toolbarRight ?? 0) + 1)
  if (channelToolbarMetrics?.controlsRight !== null) {
    expect(channelToolbarMetrics.controlsRight).toBeLessThanOrEqual((channelToolbarMetrics?.toolbarRight ?? 0) + 1)
  }
  await expect.poll(async () => page.locator('message-area').evaluate((host) =>
    host.shadowRoot?.querySelector('.header') ? 1 : 0)).toBe(0)

  await page.getByTestId('desktop-toolbar-title').click()
  await expect(page.locator('channel-details-panel')).toBeVisible()
  await expect(page.getByTestId('channel-details-resizer')).toBeVisible()
  await page.getByRole('button', { name: 'Close channel details' }).click()
  await expect(page.locator('channel-details-panel')).toHaveCount(0)

  const agentMessageRow = page.locator('message-item').filter({ hasText: profileScene.agentMessageText }).first()
  await expect(agentMessageRow).toBeVisible()
  await agentMessageRow.locator('[data-testid="message-agent-avatar"]').click()
  await expect(page.locator('agent-profile-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Close agent profile' }).click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)

  await agentMessageRow.locator('[data-testid="message-agent-name"]').click()
  await expect(page.locator('agent-profile-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Close agent profile' }).click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)

  const systemMessageRow = page.locator('message-item.system').filter({ hasText: profileScene.systemMessageText }).first()
  await expect(systemMessageRow).toBeVisible()
  await systemMessageRow.locator('[data-testid="message-agent-avatar"]').click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)
  await systemMessageRow.locator('[data-testid="message-agent-name"]').click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)

  await seededChannelRow.click({ button: 'right' })
  await page.getByRole('button', { name: 'Channel details' }).click()
  await expect(page.locator('channel-details-panel')).toBeVisible()
  await expect(page.getByTestId('channel-details-resizer')).toBeVisible()
  const channelInspectorWidth = await readElementWidth(page.getByTestId('channel-details-modal'))
  expect(Math.abs(channelInspectorWidth - resizedInspectorWidth)).toBeLessThanOrEqual(2)
  await page.getByRole('button', { name: 'Close channel details' }).click()
  await expect(page.locator('channel-details-panel')).toHaveCount(0)

  await setWindowSize(session, 940, desktopBounds.height)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(980)
  await expect(page.getByTestId('sidebar-resizer')).toHaveCount(0)

  await page.setViewportSize({
    width: 740,
    height: Math.max(640, originalViewport.height),
  })
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(760)
  await agentRow.click()
  await page.getByTestId('desktop-toolbar-title').click()
  await expect(page.locator('agent-profile-panel')).toBeVisible()
  await expect(page.getByTestId('agent-profile-resizer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close agent profile' }).click()
  await expect(page.locator('agent-profile-panel')).toHaveCount(0)

  await seededChannelRow.click()
  await page.getByTestId('desktop-toolbar-title').click()
  await expect(page.locator('channel-details-panel')).toBeVisible()
  await expect(page.getByTestId('channel-details-resizer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close channel details' }).click()
  await expect(page.locator('channel-details-panel')).toHaveCount(0)

  await page.setViewportSize(originalViewport)
  await setWindowSize(session, desktopBounds.width, desktopBounds.height)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBeGreaterThan(980)
  await ensureSidebarVisible(page)

  await page.getByTestId('nav-sandboxes').click()
  await expect(page.getByTestId('stage-shell').getByRole('heading', { level: 1, name: 'Sandboxes' })).toBeVisible()

  await page.getByTestId('nav-apps').click()
  await expect(page.locator('apps-view').getByText('Apps').first()).toBeVisible()

  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('stage-shell').getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to app' }).click()
  await expect(page.getByTestId('nav-settings')).toBeVisible()

  await page.evaluate(() => {
    window.__DUNE_E2E_CAPTURE_WINDOW_ACTIONS = true
    document.documentElement.dataset.lastWindowAction = ''
  })

  if (process.platform === 'darwin') {
    await expect(page.getByTestId('desktop-window-controls')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('desktop-window-controls')).toBeVisible()
    await page.getByTestId('window-minimize').click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.lastWindowAction ?? ''))
      .toBe('minimize')
    await page.getByTestId('window-maximize').click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.lastWindowAction ?? ''))
      .toBe('maximize')
  }
})

test('launches the built Electron app while another dev instance holds the normal lock', async () => {
  await launchDuneApp({
    devMode: true,
    tolerateExistingLockHolder: true,
  })

  const session = await launchDuneApp({ bypassSingleInstance: true })
  if (!session?.page) {
    throw new Error('Expected the built Electron app to open a window with DUNE_E2E enabled')
  }

  await expect(session.page.locator('app-shell')).toBeVisible()
  await ensureSidebarVisible(session.page)
  await expect(session.page.getByTestId('nav-settings')).toBeVisible()
  await expect
    .poll(async () => session.page?.evaluate(() => (window as any).duneElectron?.isElectron ?? false))
    .toBe(true)
})
