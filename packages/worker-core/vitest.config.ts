import { defineConfig } from 'vitest/config'

/**
 * Default (Node) test project: unit + contract tests against the in-process
 * handler with the SDK mock host. `__tests__/workers/**` is excluded here —
 * those run inside real workerd via vitest.workers.config.ts (`test:workers`).
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '__tests__/workers/**'],
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'json-summary'],
      // P6.4: threshold the consent + explore request paths, not presentational
      // or glue code. 85% line minimum, CI-enforced via `pnpm coverage`.
      include: [
        'src/create-fetch-handler.ts',
        'src/cors.ts',
        'src/config.ts',
        'src/enabled-strategies.ts',
        'src/explore-warehouse.ts',
        'src/portal.ts'
      ],
      thresholds: {
        lines: 85
      }
    }
  }
})
