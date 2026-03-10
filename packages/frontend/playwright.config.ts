import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendUrl = process.env.SANDBOX_E2E_FRONTEND_URL || 'http://localhost:4173'
const attachFrontend = process.env.SANDBOX_E2E_ATTACH_FRONTEND === '1'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['sandbox-files-dorian.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: resolve(__dirname, '../../test-results/playwright-report'),
    }],
  ],
  outputDir: resolve(__dirname, '../../test-results/playwright-output'),
  use: {
    baseURL: frontendUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: attachFrontend
    ? undefined
    : {
        command: 'pnpm dev --host localhost --port 4173',
        cwd: __dirname,
        url: frontendUrl,
        timeout: 120_000,
        reuseExistingServer: true,
      },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
