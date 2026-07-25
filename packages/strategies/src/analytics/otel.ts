import type { Strategy } from '@attestrue/sdk'
import type { StrategyManifest } from '@attestrue/types'

const manifest: StrategyManifest = {
  id: 'otel',
  stage: 'analytics',
  displayName: 'OpenTelemetry (OTLP logs) sink',
  defaultEnabled: false
}

/** Attributes we promote from a tracking event onto the OTLP log record. Kept a
 *  closed list so the observability signal stays bounded-cardinality (same
 *  discipline as the ClickHouse column set) — one rich record per real event. */
const ATTR_KEYS = [
  'siteId',
  'sessionId',
  'pagePath',
  'ctaType',
  'scrollDepthPct',
  'section',
  'dwellMs',
  'webVitalName',
  'webVitalValue',
  'params'
] as const

function otlpValue(v: unknown) {
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }
  if (typeof v === 'boolean') return { boolValue: v }
  return { stringValue: String(v) }
}

/**
 * Fan a tracking event out to an OpenTelemetry collector as an OTLP **log**
 * record (SigNoz-backed, or any OTLP/HTTP endpoint). This is the second half of
 * the dual-sink: the SAME `/t/event` ingest that writes the ClickHouse row also
 * emits one high-level log to OTel → so the observability store holds the same
 * few, valuable semantic events instead of noisy raw telemetry.
 *
 * Enabled by providing `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. http://localhost:4318
 * for a local SigNoz collector). No-ops when unset. Best-effort (Invariant 12):
 * analytics must never throw.
 */
export function createOtelStrategy(): Strategy {
  return {
    id: 'otel',
    stage: 'analytics',
    manifest,
    async run(ctx) {
      if (!ctx.tracking) return { continuePipeline: true }
      const base = ctx.host.getSecret('OTEL_EXPORTER_OTLP_ENDPOINT')
      if (!base) return { continuePipeline: true }
      const headerRaw = ctx.host.getSecret('OTEL_EXPORTER_OTLP_HEADERS') // "k=v,k2=v2"
      const serviceName = ctx.host.getSecret('OTEL_SERVICE_NAME') ?? 'attestrue-tracking'

      const t = ctx.tracking as unknown as Record<string, unknown>
      const attrs = [
        { key: 'event.name', value: { stringValue: String(t.eventName) } },
        {
          key: 'consent.decision',
          value: {
            stringValue: String(ctx.consent?.payload.decision ?? t.consentDecision ?? 'unknown')
          }
        },
        { key: 'jurisdiction', value: { stringValue: String(ctx.jurisdictionKey ?? t.jurisdiction ?? '') } },
        ...ATTR_KEYS.flatMap((k) => (t[k] == null ? [] : [{ key: k, value: otlpValue(t[k]) }]))
      ]

      const occurredMs = Date.parse(String(t.occurredAt))
      const timeUnixNano = String((Number.isNaN(occurredMs) ? Date.now() : occurredMs) * 1_000_000)

      const payload = {
        resourceLogs: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
            scopeLogs: [
              {
                scope: { name: 'attestrue.tflo' },
                logRecords: [
                  {
                    timeUnixNano,
                    severityNumber: 9,
                    severityText: 'INFO',
                    body: { stringValue: String(t.eventName) },
                    attributes: attrs
                  }
                ]
              }
            ]
          }
        ]
      }

      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (headerRaw) {
        for (const pair of headerRaw.split(',')) {
          const i = pair.indexOf('=')
          if (i > 0) headers[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
        }
      }

      try {
        await fetch(`${base.replace(/\/$/, '')}/v1/logs`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        })
      } catch {
        /* analytics must not throw — best-effort */
      }
      return { continuePipeline: true }
    }
  }
}
