import type { Strategy } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'

const manifest: StrategyManifest = {
  id: 'clickhouse',
  stage: 'analytics',
  displayName: 'ClickHouse HTTP sink',
  defaultEnabled: false
}

export function createClickHouseStrategy(): Strategy {
  return {
    id: 'clickhouse',
    stage: 'analytics',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      const url = ctx.host.getSecret('CLICKHOUSE_HTTP_URL')
      const user = ctx.host.getSecret('CLICKHOUSE_USER')
      const pass = ctx.host.getSecret('CLICKHOUSE_PASSWORD')
      if (!url) return { continuePipeline: true }
      const auth =
        user && pass ? `Basic ${btoa(`${user}:${pass}`)}` : undefined
      const row = {
        ...ctx.tracking,
        consent_decision: ctx.consent?.payload.decision ?? ctx.tracking.consentDecision ?? null,
        jurisdiction: ctx.jurisdictionKey ?? ctx.tracking.jurisdiction ?? null
      }
      try {
        await fetch(url, {
          method: 'POST',
          headers: {
            ...(auth ? { Authorization: auth } : {}),
            'content-type': 'application/json'
          },
          body: JSON.stringify(row)
        })
      } catch {
        /* analytics must not throw — Invariant 12 style: best-effort */
      }
      return { continuePipeline: true }
    }
  }
}
