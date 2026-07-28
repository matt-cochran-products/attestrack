import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * P6.1 — real Worker runtime tests. Runs `__tests__/workers/**` inside actual
 * workerd (via @cloudflare/vitest-pool-workers), with a REAL KV namespace
 * binding and a REAL ExecutionContext, so KV semantics (TTL floor, persistence),
 * `waitUntil`, `cf-ipcountry`, and `Set-Cookie` behavior are exercised in the
 * runtime Cloudflare actually runs — not a Node mock.
 *
 * vitest-pool-workers 0.13+ (the vitest 4 line) replaced `defineWorkersConfig`
 * + `test.poolOptions.workers` with the `cloudflareTest()` plugin — the options
 * object below is unchanged from the old `poolOptions.workers` shape.
 *
 * Invoked via `pnpm --filter @attestrack/worker-core test:workers` (separate
 * from the default `test` script; see docs/TEST-STRATEGY.md).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        // Mirror the deploy scaffold (packages/deploy/src/worker-template.ts).
        compatibilityDate: '2024-12-01',
        // Required by the vitest pool itself (test runner internals);
        // production worker code under test uses no Node APIs.
        compatibilityFlags: ['nodejs_compat'],
        kvNamespaces: ['ATTESTRACK_KV']
      }
    })
  ],
  test: {
    include: ['__tests__/workers/**/*.test.ts']
  }
})
