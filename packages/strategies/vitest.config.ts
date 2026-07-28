import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'json-summary'],
      // P6.4: the consent pipeline stage-1 strategies (gate, evidence log,
      // jurisdiction resolution) — the consent-correctness path.
      include: [
        'src/mandatory/consent.ts',
        'src/mandatory/consent-log.ts',
        'src/mandatory/jurisdiction.ts'
      ],
      thresholds: {
        lines: 85
      }
    }
  }
})
