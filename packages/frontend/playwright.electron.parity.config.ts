import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './e2e',
  testMatch: ['electron-parity.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: resolve(__dirname, '../../test-results/electron-parity-report'),
    }],
  ],
  outputDir: resolve(__dirname, '../../test-results/electron-parity-output'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
