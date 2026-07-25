import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const e2eRoot = dirname(fileURLToPath(import.meta.url))

/**
 * Two projects, one worker runtime:
 *
 * - `api-smoke` — request-only smoke (no browser binaries needed). Runs in the
 *   default `pnpm test` pipeline.
 * - `browser-journeys` — Chromium journeys (consent banner cross-origin,
 *   Explore round-trip, portal live-mode, a11y). Needs `playwright install`
 *   plus the portal harness build (`pnpm --filter @attestrack/e2e
 *   build:portal-live`); run via `test:browser` (CI: e2e.yml).
 *
 * BOTH projects run against REAL workerd: the first webServer starts
 * `wrangler dev` on the scaffold-equivalent worker (e2e/worker/worker.ts)
 * with seeded local KV. The second hosts the cross-origin "customer page"
 * (port 8788 ≠ worker port 8791 — P2.1 topology) + the live-mode portal build.
 */
export default defineConfig({
  testDir: e2eRoot,
  timeout: 30_000,
  projects: [
    { name: 'api-smoke', testMatch: /smoke\.spec\.ts/ },
    {
      name: 'browser-journeys',
      testMatch: /journeys\/.+\.spec\.ts/,
      // Full-Chromium new headless (no separate headless-shell download needed).
      use: { ...devices['Desktop Chrome'], channel: 'chromium' }
    }
  ],
  use: {
    baseURL: 'http://127.0.0.1:8791'
  },
  webServer: [
    {
      // Seed local KV, then serve the worker under workerd via wrangler dev.
      // Explicit .bin path: works under `pnpm run`, `pnpm exec`, and bare CLI.
      command:
        'node ../scripts/seed-kv.mjs && ../node_modules/.bin/wrangler dev --port 8791 --ip 127.0.0.1',
      cwd: join(e2eRoot, 'worker'),
      url: 'http://127.0.0.1:8791/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { WRANGLER_SEND_METRICS: 'false' }
    },
    {
      command: 'node ./scripts/page-server.mjs',
      cwd: e2eRoot,
      port: 8788,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ]
})
