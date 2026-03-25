import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const e2eRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: e2eRoot,
  testMatch: 'smoke.spec.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8791'
  },
  webServer: {
    command: 'node ./scripts/dev-server.mjs',
    cwd: e2eRoot,
    port: 8791,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
})
