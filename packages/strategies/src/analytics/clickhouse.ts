import type { Strategy, StrategyPipelineContext } from '@attestrack/sdk'
import type { StrategyManifest, TrackingEventV1 } from '@attestrack/types'

const manifest: StrategyManifest = {
  id: 'clickhouse',
  stage: 'analytics',
  displayName: 'ClickHouse HTTP sink',
  defaultEnabled: false
}

/**
 * Build the ClickHouse HTTP insert URL. If the operator already embedded a
 * `query=` (advanced / self-managed table name — e.g. the pubops dogfood points
 * at its own `tracking_events`), it is used verbatim. Otherwise we append the
 * canonical `INSERT INTO events FORMAT JSONEachRow` targeting the repo-shipped
 * `events` table (packages/schema/warehouse/clickhouse.sql), with best-effort
 * datetime parsing so the ISO `occurredAt` lands in DateTime64.
 */
export function buildClickHouseInsertUrl(base: string): string {
  if (/[?&]query=/i.test(base)) return base
  const sep = base.includes('?') ? '&' : '?'
  const q = encodeURIComponent('INSERT INTO events FORMAT JSONEachRow')
  return `${base}${sep}query=${q}&date_time_input_format=best_effort`
}

/** Explicit event → warehouse-row projection (NO blind spread) — the row keys
 *  are exactly the `events` table columns; unknown/extra fields never reach the
 *  warehouse. */
export function toClickHouseRow(
  t: TrackingEventV1,
  resolved: { consentDecision: string | null; jurisdiction: string | null }
): Record<string, unknown> {
  return {
    v: t.v,
    eventName: t.eventName,
    siteId: t.siteId,
    occurredAt: t.occurredAt,
    consentDecision: resolved.consentDecision,
    jurisdiction: resolved.jurisdiction,
    visitorId: t.visitorId ?? null,
    sessionId: t.sessionId ?? null,
    eventId: t.eventId ?? null,
    pagePath: t.pagePath ?? null,
    referrer: t.referrer ?? null,
    utmSource: t.utmSource ?? null,
    utmMedium: t.utmMedium ?? null,
    utmCampaign: t.utmCampaign ?? null,
    utmTerm: t.utmTerm ?? null,
    utmContent: t.utmContent ?? null,
    userAgentClass: t.userAgentClass ?? null,
    ctaType: t.ctaType ?? null,
    scrollDepthPct: t.scrollDepthPct ?? null,
    section: t.section ?? null,
    dwellMs: t.dwellMs ?? null,
    webVitalName: t.webVitalName ?? null,
    webVitalValue: t.webVitalValue ?? null,
    params: t.params ?? null
  }
}

/** Record a delivery failure so the portal / STR.4 error surface can show it
 *  (Phase 3 builds the full log on top of this). Best-effort; never throws. */
async function recordDeliveryError(ctx: StrategyPipelineContext, detail: string): Promise<void> {
  try {
    const kv = ctx.host.kv
    if (!kv) return
    const key = 'attestrack:delivery:error:clickhouse'
    const prev = await kv.get(key)
    let count = 0
    if (prev) {
      try {
        count = (JSON.parse(prev) as { count?: number }).count ?? 0
      } catch {
        count = 0
      }
    }
    await kv.put(key, JSON.stringify({ count: count + 1, lastError: detail.slice(0, 500) }))
  } catch {
    /* recording is best-effort too */
  }
}

export function createClickHouseStrategy(): Strategy {
  return {
    id: 'clickhouse',
    stage: 'analytics',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      const url = ctx.host.getSecret('CLICKHOUSE_HTTP_URL')
      if (!url) return { continuePipeline: true }
      const user = ctx.host.getSecret('CLICKHOUSE_USER')
      const pass = ctx.host.getSecret('CLICKHOUSE_PASSWORD')
      const auth = user && pass ? `Basic ${btoa(`${user}:${pass}`)}` : undefined

      const row = toClickHouseRow(ctx.tracking, {
        consentDecision: ctx.consent?.payload.decision ?? ctx.tracking.consentDecision ?? null,
        jurisdiction: ctx.jurisdictionKey ?? ctx.tracking.jurisdiction ?? null
      })

      try {
        const res = await fetch(buildClickHouseInsertUrl(url), {
          method: 'POST',
          headers: {
            ...(auth ? { Authorization: auth } : {}),
            'content-type': 'application/json'
          },
          body: JSON.stringify(row)
        })
        if (!res.ok) {
          await recordDeliveryError(ctx, `HTTP ${res.status}`)
        }
      } catch (err) {
        // analytics must not throw — best-effort (Invariant 12) — but DO record.
        await recordDeliveryError(ctx, err instanceof Error ? err.message : 'network error')
      }
      return { continuePipeline: true }
    }
  }
}
