import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'json-summary'],
      // P6.4: the explore SQL gate (INV-B-14) and consent schemas — the
      // security/consent-critical surfaces of this package.
      include: ['src/explore-sql.ts', 'src/consent.schema.ts', 'src/jurisdiction.schema.ts'],
      thresholds: {
        lines: 85
      }
    }
  }
})
