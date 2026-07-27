import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime, noopStrategyLoader } from '@attestrack/sdk'
import {
  KV_KEY_OBS_DELIVERY_PREFIX,
  KV_KEY_OBS_EVENTS_PREFIX,
  KV_KEY_PORTAL_SAVED_QUERIES,
  KV_KEY_PORTAL_STRATEGIES
} from '@attestrack/types'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  computeCuratedChart,
  isValidCuratedDate,
  listCuratedChartDescriptors
} from '../../src/curated-analytics.js'
import { isOriginAllowed } from '../../src/cors.js'
import { executeExploreSql } from '../../src/explore-warehouse.js'
import {
  DELIVERY_STRATEGY_DESCRIPTORS,
  LOG_TTL_SECONDS,
  buildDestinationRows,
  logKeyForHour,
  readRecentLogs,
  recordIngestObservability
} from '../../src/observability.js'
import { PORTAL_API_PREFIX, PORTAL_SHARED_SECRET_HEADER } from '../../src/portal.js'

/**
 * Mutation-hardening round 2 (Stryker): kills the second wave of survivors —
 * the no-store header discipline across every portal route, the constant-time
 * secret compare content check, per-user pin identity normalization + cap,
 * the delivery-descriptor table, dashboard/status boundaries, curated chart
 * metadata + ranking order, and warehouse parse fallbacks.
 */

const SECRET = 'wc-hardening2-secret-32-chars!!!'

afterEach(() => vi.restoreAllMocks())

function makeHandler(secrets: Record<string, string> = { CONSENT_TOKEN_SECRET: SECRET }) {
  const host = createMockHostRuntime({ secrets })
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: [],
    strategyLoader: noopStrategyLoader
  })
  return { host, handler }
}

function portalReq(sub: string, init?: RequestInit) {
  return new Request(`https://t.example.com${PORTAL_API_PREFIX}${sub}`, init)
}
function postJson(sub: string, body: unknown, headers: Record<string, string> = {}) {
  return portalReq(sub, { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('portal cache discipline: every route answers no-store', () => {
  it('GET routes', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(KV_KEY_PORTAL_STRATEGIES, JSON.stringify({ builtin: [] }))
    for (const sub of [
      '/site-config',
      '/configuration',
      '/strategies',
      '/dashboard',
      '/destinations',
      '/alert-rules',
      '/logs',
      '/logs/incoming',
      '/signal',
      '/signal-recovery',
      '/signal-recovery/timeline/2026-07',
      '/analytics/curated',
      '/explore/saved-queries'
    ]) {
      const res = await handler(portalReq(sub))
      expect(res.status, sub).toBe(200)
      expect(res.headers.get('cache-control'), sub).toBe('no-store')
    }
  })

  it('POST routes and rejections', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(
      KV_KEY_PORTAL_SAVED_QUERIES,
      JSON.stringify([{ id: 'q1', name: 'q', sql: 'SELECT 1', updatedAt: '2026-07-25T00:00:00.000Z' }])
    )
    const saved = await handler(
      postJson('/explore/saved-queries', { name: 'n', sql: 'SELECT eventName FROM events' })
    )
    expect(saved.headers.get('cache-control')).toBe('no-store')
    const removed = await handler(postJson('/explore/saved-queries/remove', { id: 'nope' }))
    expect(removed.headers.get('cache-control')).toBe('no-store')
    const pinned = await handler(postJson('/explore/saved-queries/pin', { id: 'q1', pinned: true }))
    expect(pinned.headers.get('cache-control')).toBe('no-store')
    expect(((await pinned.json()) as { success: boolean }).success).toBe(true)
    const curated = await handler(
      postJson('/analytics/curated', {
        chartId: 'events-volume',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-25'
      })
    )
    expect(curated.headers.get('cache-control')).toBe('no-store')
    const status = await handler(postJson('/analytics/warehouse-status', {}))
    expect(status.headers.get('cache-control')).toBe('no-store')
  })

  it('GET /strategies with NO stored KV serves the fallback as no-store', async () => {
    const { handler } = makeHandler()
    const res = await handler(portalReq('/strategies'))
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ builtin: [], proofLayer: [] })
  })

  it('POST /explore/query success responses are no-store with the result envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ eventName: 'pv' }], meta: [{ name: 'eventName' }] }), {
        status: 200
      })
    )
    const { handler } = makeHandler({
      CONSENT_TOKEN_SECRET: SECRET,
      CLICKHOUSE_QUERY_URL: 'http://ch'
    })
    const res = await handler(
      postJson('/explore/query', { sql: 'SELECT eventName FROM events LIMIT 10' })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      columns: ['eventName'],
      rows: [{ eventName: 'pv' }],
      rowCount: 1,
      truncated: false
    })
  })

  it('equal from/to dates are a VALID curated range', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      postJson('/analytics/curated', {
        chartId: 'events-volume',
        dateFrom: '2026-07-25',
        dateTo: '2026-07-25'
      })
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { state: string }).state).toBe('not_configured')
  })

  it('portal POST with invalid JSON → exact envelope', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      portalReq('/explore/query', { method: 'POST', body: '{nope' })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_json' })
  })
})

describe('portal shared-secret gate (P7.3) — content binding', () => {
  const PORTAL_SECRET = 'portal-secret-32-chars-long-ok!!'

  it('same-length wrong secrets are rejected (compare is content-, not length-, based)', async () => {
    const { handler } = makeHandler({
      CONSENT_TOKEN_SECRET: SECRET,
      PORTAL_API_SHARED_SECRET: PORTAL_SECRET
    })
    const wrong = `${PORTAL_SECRET.slice(0, -1)}?`
    expect(wrong).toHaveLength(PORTAL_SECRET.length)
    const res = await handler(
      portalReq('/site-config', { headers: { [PORTAL_SHARED_SECRET_HEADER]: wrong } })
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('portal_unauthorized')
    expect(body.message).toBe(
      `Portal API shared secret is configured; send the ${PORTAL_SHARED_SECRET_HEADER} header.`
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('an EMPTY configured secret disables the gate (not lock-everyone-out)', async () => {
    const { handler } = makeHandler({
      CONSENT_TOKEN_SECRET: SECRET,
      PORTAL_API_SHARED_SECRET: ''
    })
    const res = await handler(portalReq('/site-config'))
    expect(res.status).toBe(200)
  })

  it('a missing header is never treated as the literal string "null"', async () => {
    const { handler } = makeHandler({
      CONSENT_TOKEN_SECRET: SECRET,
      PORTAL_API_SHARED_SECRET: 'null'
    })
    const res = await handler(portalReq('/site-config'))
    expect(res.status).toBe(401)
  })
})

describe('per-user pin identity + cap', () => {
  it('normalizes the Access email (trim + lowercase) and defaults to the anonymous user', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(
      KV_KEY_PORTAL_SAVED_QUERIES,
      JSON.stringify([{ id: 'q1', name: 'q', sql: 'SELECT 1', updatedAt: '2026-07-25T00:00:00.000Z' }])
    )
    await handler(
      postJson(
        '/explore/saved-queries/pin',
        { id: 'q1', pinned: true },
        { 'Cf-Access-Authenticated-User-Email': '  Analyst@Example.COM  ' }
      )
    )
    let list = JSON.parse((await host.kv.get(KV_KEY_PORTAL_SAVED_QUERIES))!) as {
      pins?: { user: string }[]
    }[]
    expect(list[0]!.pins!.map((p) => p.user)).toEqual(['analyst@example.com'])

    await handler(postJson('/explore/saved-queries/pin', { id: 'q1', pinned: true }))
    list = JSON.parse((await host.kv.get(KV_KEY_PORTAL_SAVED_QUERIES))!) as {
      pins?: { user: string }[]
    }[]
    expect(list[0]!.pins!.map((p) => p.user)).toEqual(['analyst@example.com', ''])
  })

  it('caps pins at 50 per entry, dropping the oldest', async () => {
    const { host, handler } = makeHandler()
    const pins = Array.from({ length: 50 }, (_, i) => ({
      user: `u${i}@x.com`,
      pinnedAt: '2026-07-25T00:00:00.000Z',
      chart: { chartType: 'table' }
    }))
    await host.kv.put(
      KV_KEY_PORTAL_SAVED_QUERIES,
      JSON.stringify([
        { id: 'q1', name: 'q', sql: 'SELECT 1', updatedAt: '2026-07-25T00:00:00.000Z', pins }
      ])
    )
    await handler(
      postJson(
        '/explore/saved-queries/pin',
        { id: 'q1', pinned: true },
        { 'Cf-Access-Authenticated-User-Email': 'new@x.com' }
      )
    )
    const list = JSON.parse((await host.kv.get(KV_KEY_PORTAL_SAVED_QUERIES))!) as {
      pins: { user: string }[]
    }[]
    expect(list[0]!.pins).toHaveLength(50)
    expect(list[0]!.pins[0]!.user).toBe('u1@x.com')
    expect(list[0]!.pins[49]!.user).toBe('new@x.com')
  })
})

describe('portal validation binding per field', () => {
  it('saved-queries: numeric name with valid sql is invalid_body, not a crash', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      postJson('/explore/saved-queries', { name: 5, sql: 'SELECT eventName FROM events' })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_body',
      details: { code: 'saved_query_name_sql_required' }
    })
  })

  it('pin: numeric id with boolean pinned is invalid_body (400, not 404)', async () => {
    const { handler } = makeHandler()
    const res = await handler(postJson('/explore/saved-queries/pin', { id: 5, pinned: true }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { details: { code: string } }).details.code).toBe(
      'saved_query_pin_body_invalid'
    )
  })

  it('toggle: numeric id with boolean enabled is invalid_body and writes nothing', async () => {
    const { host, handler } = makeHandler()
    const res = await handler(postJson('/strategies/toggle', { id: 5, enabled: true }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(await host.kv.get(KV_KEY_PORTAL_STRATEGIES)).toBeNull()
  })

  it('toggle on empty/absent and non-array KV normalizes to {builtin: []}', async () => {
    const { host, handler } = makeHandler()
    await handler(postJson('/strategies/toggle', { id: 'a', enabled: true }))
    expect(JSON.parse((await host.kv.get(KV_KEY_PORTAL_STRATEGIES))!)).toEqual({ builtin: [] })
    await host.kv.put(KV_KEY_PORTAL_STRATEGIES, '{"builtin":42}')
    await handler(postJson('/strategies/toggle', { id: 'a', enabled: true }))
    expect(JSON.parse((await host.kv.get(KV_KEY_PORTAL_STRATEGIES))!)).toEqual({ builtin: [] })
  })

  it('alert-rules with no KV configured reads as exactly []', async () => {
    const { handler } = makeHandler()
    expect(await (await handler(portalReq('/alert-rules'))).json()).toEqual([])
  })
})

describe('fetch-handler leftovers', () => {
  it('POST /privacy and GET /t/event are not their counterpart routes', async () => {
    const { handler } = makeHandler()
    const post = await handler(new Request('https://t.example.com/privacy', { method: 'POST' }))
    expect(post.headers.get('content-type')).toContain('json')
    const getTrack = await handler(new Request('https://t.example.com/t/event'))
    const body = (await getTrack.json()) as Record<string, unknown>
    expect(body).toEqual({ ok: true, consentDecision: null })
    expect(getTrack.headers.get('cache-control')).toBe('no-store')
  })
})

describe('CORS: exact-host matching must not rely on the host:port fallback', () => {
  it('allows an https origin on a non-default port for the apex domain', () => {
    expect(
      isOriginAllowed('https://example.com:8443', { domain: 'example.com', trustedDomains: [] })
    ).toBe(true)
  })
})

describe('warehouse parse fallbacks + tinybird status mapping', () => {
  it('a JSON body without data/meta parses as zero rows and columns', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    const res = await executeExploreSql(host, 'SELECT 1')
    expect(res).toEqual({ ok: true, columns: [], rows: [], rowCount: 0, truncated: false })
  })

  it('tinybird HTTP 400 passes through as 400 with a 500-char reason slice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('q'.repeat(700), { status: 400 })
    )
    const host = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    const res = await executeExploreSql(host, 'SELECT 1')
    expect(res).toEqual({
      ok: false,
      status: 400,
      error: 'explore_warehouse_http_error',
      details: { reason: 'q'.repeat(500), status: 400, target: 'tinybird' }
    })
  })
})

describe('observability leftovers', () => {
  const NOW = new Date('2020-01-15T10:30:00.000Z')

  it('pins the full delivery-descriptor table (ids, names, secret requirements)', () => {
    expect(DELIVERY_STRATEGY_DESCRIPTORS).toEqual([
      { id: 'meta-capi', name: 'Meta Conversions API', secrets: ['META_ACCESS_TOKEN', 'META_PIXEL_ID'] },
      {
        id: 'google-mp',
        name: 'Google Measurement Protocol',
        secrets: ['GOOGLE_MP_API_SECRET', 'GOOGLE_MEASUREMENT_ID']
      },
      {
        id: 'tiktok-events',
        name: 'TikTok Events API',
        secrets: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_PIXEL_ID']
      },
      {
        id: 'microsoft-uet',
        name: 'Microsoft UET offline conversions',
        secrets: ['MICROSOFT_UET_ACCESS_TOKEN', 'MICROSOFT_UET_TAG_ID']
      },
      { id: 'clickhouse', name: 'ClickHouse HTTP sink', secrets: ['CLICKHOUSE_HTTP_URL'] },
      { id: 'tinybird', name: 'Tinybird Events API', secrets: ['TINYBIRD_TOKEN'] },
      { id: 'otel', name: 'OpenTelemetry (OTLP logs) sink', secrets: ['OTEL_EXPORTER_OTLP_ENDPOINT'] }
    ])
  })

  it('log keys carry the 48h TTL', async () => {
    expect(LOG_TTL_SECONDS).toBe(172_800)
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await recordIngestObservability(host, { host, request: new Request('https://x/') } as never, 5, NOW)
    const logPut = put.mock.calls.find((c) => (c[0] as string).startsWith('attestrack:obs:log:'))
    expect((logPut![2] as { expirationTtl?: number }).expirationTtl).toBe(172_800)
  })

  it('ingest counting passes the observed `now` down to the sampled counter', async () => {
    const host = createMockHostRuntime()
    const dayKey = `${KV_KEY_OBS_EVENTS_PREFIX}2020-01-15`
    await host.kv.put(dayKey, JSON.stringify({ count: 5000 }))
    // Lucky sampled roll: +10 lands on the OBSERVED day key, nothing else.
    vi.spyOn(Math, 'random').mockReturnValue(0.05)
    await recordIngestObservability(host, { host, request: new Request('https://x/') } as never, 5, NOW)
    expect(JSON.parse((await host.kv.get(dayKey))!)).toEqual({ count: 5010 })
  })

  it('non-array garbage in a log bucket reads as no entries', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(logKeyForHour(NOW), '{"a":1}')
    expect(await readRecentLogs(host.kv, NOW)).toEqual([])
  })

  it('status: error-only history (never an ok) is degraded even with no attempts today', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    await host.kv.put(
      `${KV_KEY_OBS_DELIVERY_PREFIX}clickhouse`,
      JSON.stringify({
        ok: 0, error: 2, okToday: 0, errorToday: 0, day: '2020-01-14', lastErrorAt: '2020-01-14T10:00:00Z'
      })
    )
    const row = (await buildDestinationRows(host, null)).find((r) => r.id === 'clickhouse')!
    expect(row.status).toBe('degraded')
    expect(row.successRate).toBe(0)
  })

  it('status: recorded stats with zero attempts anywhere stay healthy at rate 0', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    await host.kv.put(
      `${KV_KEY_OBS_DELIVERY_PREFIX}clickhouse`,
      JSON.stringify({ ok: 0, error: 0, okToday: 0, errorToday: 0, day: '' })
    )
    const row = (await buildDestinationRows(host, null)).find((r) => r.id === 'clickhouse')!
    expect(row.successRate).toBe(0)
    expect(row.status).toBe('healthy')
  })

  it('status: success history without error timestamps never degrades', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    await host.kv.put(
      `${KV_KEY_OBS_DELIVERY_PREFIX}clickhouse`,
      JSON.stringify({
        ok: 5, error: 0, okToday: 0, errorToday: 0, day: '2020-01-14', lastOkAt: '2020-01-14T10:00:00Z'
      })
    )
    const row = (await buildDestinationRows(host, null)).find((r) => r.id === 'clickhouse')!
    expect(row.status).toBe('healthy')
  })

  it('dashboard lists MULTIPLE degraded destinations comma-separated', async () => {
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'http://ch', TINYBIRD_TOKEN: 'tok' }
    })
    for (const id of ['clickhouse', 'tinybird']) {
      await host.kv.put(
        `${KV_KEY_OBS_DELIVERY_PREFIX}${id}`,
        JSON.stringify({
          ok: 0, error: 2, okToday: 0, errorToday: 0, day: '2020-01-14', lastErrorAt: '2020-01-14T10:00:00Z'
        })
      )
    }
    const { computeDashboardMetrics } = await import('../../src/observability.js')
    const { defaultSiteConfig } = await import('../../src/config.js')
    const cfg = {
      ...defaultSiteConfig,
      driftDetection: { ...defaultSiteConfig.driftDetection, enabled: false }
    }
    const metrics = await computeDashboardMetrics(host, cfg, null, NOW)
    expect(metrics.strategySummary).toBe(
      'ClickHouse HTTP sink, Tinybird Events API reporting delivery errors'
    )
  })

  it('status: today window dominated by errors is degraded (sum, not difference)', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    await host.kv.put(
      `${KV_KEY_OBS_DELIVERY_PREFIX}clickhouse`,
      JSON.stringify({
        ok: 10, error: 7, okToday: 3, errorToday: 7, day: new Date().toISOString().slice(0, 10),
        lastOkAt: '2026-07-25T11:00:00Z', lastErrorAt: '2026-07-25T10:00:00Z'
      })
    )
    const row = (await buildDestinationRows(host, null)).find((r) => r.id === 'clickhouse')!
    expect(row.successRate).toBe(30)
    expect(row.status).toBe('degraded')
  })
})

describe('curated analytics leftovers', () => {
  const FROM = '2026-07-01'
  const TO = '2026-07-25'

  it('date validation is fully anchored and rejects datetime strings', () => {
    expect(isValidCuratedDate('2026-07-25T10:00:00Z')).toBe(false)
    expect(isValidCuratedDate(' 2026-07-25')).toBe(false)
    expect(isValidCuratedDate('x 2026-07-25')).toBe(false)
  })

  it('pins the exact chart metadata catalog', () => {
    expect(listCuratedChartDescriptors()).toEqual([
      {
        id: 'events-volume',
        title: 'Events ingested per day',
        description: 'Rows written to your events table per UTC day (includes bot-labeled rows).',
        unit: 'count',
        source: 'warehouse'
      },
      {
        id: 'consent-rate-by-jurisdiction',
        title: 'Consent rate by jurisdiction',
        description:
          'Granted share of events carrying an explicit recorded consent decision, per UTC day.',
        unit: 'percent',
        source: 'warehouse'
      },
      {
        id: 'destination-success-rate',
        title: 'Destination success rate',
        description:
          'Delivery success per configured destination from recorded outcomes (all recorded traffic; not date-range filtered).',
        unit: 'percent',
        source: 'delivery_stats'
      },
      {
        id: 'bot-share',
        title: 'Bot share of ingested events',
        description:
          'Share of events per UTC day the troll-shield labeled as bot traffic (kept in the warehouse, never delivered to ad destinations).',
        unit: 'percent',
        source: 'warehouse'
      }
    ])
  })

  it('consent-rate ranks by decided volume, NOT input order, and labels blank jurisdictions UNKNOWN', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    // Insertion order J1..J7 with INVERTED decided volume — ranking must flip it.
    const rows = Array.from({ length: 7 }, (_, i) => ({
      day: '2026-07-01',
      jurisdiction: `J${i + 1}`,
      granted: 1,
      decided: 10 * (i + 1)
    }))
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: rows, meta: [] }), { status: 200 }))
    const chart = await computeCuratedChart(host, null, 'consent-rate-by-jurisdiction', FROM, TO)
    // The consent-rate canned SQL (not another chart's) went to the warehouse.
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body).toContain(
      "countIf(consentDecision = 'granted') AS granted, countIf(consentDecision IS NOT NULL) AS decided"
    )
    expect(chart.series.map((s) => s.name)).toEqual(['J7', 'J6', 'J5', 'J4', 'J3', 'J2', 'OTHER'])
    // OTHER == J1 alone: 1/10 → 10%.
    expect(chart.series.at(-1)!.points).toEqual([{ label: '2026-07-01', value: 10 }])

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ day: '2026-07-01', jurisdiction: '', granted: 1, decided: 2 }], meta: [] }),
        { status: 200 }
      )
    )
    const unknown = await computeCuratedChart(host, null, 'consent-rate-by-jurisdiction', FROM, TO)
    expect(unknown.series.map((s) => s.name)).toEqual(['UNKNOWN'])
  })

  it('events-volume labels a missing day as the empty string (defensive str())', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ events: 4 }], meta: [] }), { status: 200 })
    )
    const chart = await computeCuratedChart(host, null, 'events-volume', FROM, TO)
    expect(chart.series[0]!.points).toEqual([{ label: '', value: 4 }])
  })

  it('destination-success-rate includes degraded destinations (with data), not only healthy ones', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    await host.kv.put(
      `${KV_KEY_OBS_DELIVERY_PREFIX}clickhouse`,
      JSON.stringify({
        ok: 1, error: 9, okToday: 0, errorToday: 0, day: '2026-07-24', lastErrorAt: '2026-07-25T10:00:00Z'
      })
    )
    const chart = await computeCuratedChart(host, null, 'destination-success-rate', FROM, TO)
    expect(chart.state).toBe('ok')
    expect(chart.series[0]!.points).toEqual([{ label: 'ClickHouse HTTP sink', value: 10 }])
  })
})
