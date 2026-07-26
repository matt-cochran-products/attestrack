import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'json-summary'],
      // P6.4: consent-path files only (token mint/verify + gate evaluation).
      // Presentational/glue code is deliberately not chased for %.
      include: ['src/consent-token.ts', 'src/consent-gate.ts'],
      thresholds: {
        lines: 85
      }
    }
  }
})
