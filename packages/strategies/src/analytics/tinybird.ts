import { recordDeliveryResult, type Strategy } from '@attestrack/sdk'
import type { StrategyManifest } from '@attestrack/types'

const manifest: StrategyManifest = {
  id: 'tinybird',
  stage: 'analytics',
  displayName: 'Tinybird Events API',
  defaultEnabled: false
}

export function createTinybirdStrategy(): Strategy {
  return {
    id: 'tinybird',
    stage: 'analytics',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      const token = ctx.host.getSecret('TINYBIRD_TOKEN')
      const datasource = ctx.host.getSecret('TINYBIRD_DATASOURCE') ?? 'events'
      if (!token) return { continuePipeline: true }
      const url = `https://api.tinybird.co/v0/events?name=${encodeURIComponent(datasource)}`
      const payload = {
        ...ctx.tracking,
        consent_decision: ctx.consent?.payload.decision ?? ctx.tracking.consentDecision,
        jurisdiction: ctx.jurisdictionKey ?? ctx.tracking.jurisdiction
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: `${JSON.stringify(payload)}\n`
        })
        // P3.1: record the outcome for the portal /destinations view (STR.4).
        await recordDeliveryResult(
          ctx.host.kv,
          'tinybird',
          res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` }
        )
      } catch (err) {
        // best-effort (Invariant 12) — but DO record the failure.
        await recordDeliveryResult(ctx.host.kv, 'tinybird', {
          ok: false,
          detail: err instanceof Error ? err.message : 'network error'
        })
      }
      return { continuePipeline: true }
    }
  }
}
