import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

/**
 * P6.1 — real Worker runtime tests. Runs `__tests__/workers/**` inside actual
 * workerd (via @cloudflare/vitest-pool-workers), with a REAL KV namespace
 * binding and a REAL ExecutionContext, so KV semantics (TTL floor, persistence),
 * `waitUntil`, `cf-ipcountry`, and `Set-Cookie` behavior are exercised in the
 * runtime Cloudflare actually runs — not a Node mock.
 *
 * Invoked via `pnpm --filter @attestrack/worker-core test:workers` (separate
 * from the default `test` script; see docs/TEST-STRATEGY.md).
 */
export default defineWorkersConfig({
  test: {
    include: ['__tests__/workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        miniflare: {
          // Mirror the deploy scaffold (packages/deploy/src/worker-template.ts).
          compatibilityDate: '2024-12-01',
          // Required by the vitest pool itself (test runner internals);
          // production worker code under test uses no Node APIs.
          compatibilityFlags: ['nodejs_compat'],
          kvNamespaces: ['ATTESTRACK_KV']
        }
      }
    }
  }
})
