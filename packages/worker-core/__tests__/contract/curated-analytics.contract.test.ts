import { describe, expect, it, vi, afterEach } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { noopStrategyLoader, createMockHostRuntime } from '@attestrack/sdk'

/**
 * P4.3 — Curated analytics contract (ANA.2/ANA.3/ANA.6 + launch rule §3).
 * Warehouse-backed charts run CANNED SQL through the SAME Explore gate +
 * executor as user queries; the destination chart derives from recorded
 * delivery stats. No state ever contains invented series.
 */
describe('portal analytics/curated contract (P4.3)', () => {
  const curatedUrl = 'https://x/__attestrack__/portal/v1/analytics/curated'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function handler(host = createMockHostRuntime()) {
    return createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
  }

  function post(body: unknown): Request {
    return new Request(curatedUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  const range = { dateFrom: '2026-07-18', dateTo: '2026-07-25' }

  it('GET returns chart descriptors + warehouse status, never series data', async () => {
    const res = await handler()(new Request(curatedUrl, { method: 'GET' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      charts: { id: string; title: string; source: string }[]
      warehouseConfigured: boolean
    }
    expect(json.warehouseConfigured).toBe(false)
    expect(json.charts.map((c) => c.id)).toEqual([
      'events-volume',
      'consent-rate-by-jurisdiction',
      'destination-success-rate',
      'bot-share'
    ])
    for (const c of json.charts) {
      expect('series' in c).toBe(false)
    }
  })

  it('POST rejects unknown chart ids and malformed dates', async () => {
    for (const body of [
      { chartId: 'nope', ...range },
      { chartId: 'events-volume', dateFrom: 'not-a-date', dateTo: '2026-07-25' },
      { chartId: 'events-volume', dateFrom: '2026-07-25', dateTo: '2026-07-18' },
      { chartId: 'events-volume' }
    ]) {
      const res = await handler()(post(body))
      expect(res.status).toBe(400)
      const json = (await res.json()) as { details?: { code?: string } }
      expect(json.details?.code).toBe('curated_chart_request_invalid')
    }
  })

  it('warehouse chart without warehouse secrets → state not_configured, empty series', async () => {
    const res = await handler()(post({ chartId: 'events-volume', ...range }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { state: string; series: unknown[]; message?: string }
    expect(json.state).toBe('not_configured')
    expect(json.series).toEqual([])
    expect(json.message).toMatch(/warehouse/i)
  })

  it('events-volume runs canned SQL through the gate + ClickHouse executor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: [
            { name: 'day', type: 'Date' },
            { name: 'events', type: 'UInt64' }
          ],
          // ClickHouse FORMAT JSON quotes UInt64 — values arrive as strings.
          data: [
            { day: '2026-07-24', events: '120' },
            { day: '2026-07-25', events: 80 }
          ]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example:8443' }
    })
    const res = await handler(host)(post({ chartId: 'events-volume', ...range }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      state: string
      unit: string
      series: { name: string; points: { label: string; value: number }[] }[]
    }
    expect(json.state).toBe('ok')
    expect(json.unit).toBe('count')
    expect(json.series[0]?.points).toEqual([
      { label: '2026-07-24', value: 120 },
      { label: '2026-07-25', value: 80 }
    ])

    // Single warehouse path: exactly one fetch, to the ClickHouse base, with the
    // gated canned SQL (allowlisted bare table + clamped LIMIT) in the body.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('https://ch.example:8443/')
    expect(init.body).toContain('FROM events')
    expect(init.body).toContain("toDate(occurredAt) >= '2026-07-18'")
    expect(init.body).toContain('LIMIT 500')
  })

  it('consent-rate-by-jurisdiction builds per-jurisdiction percent series from decided events only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            meta: [],
            data: [
              { day: '2026-07-24', jurisdiction: 'EU', granted: '3', decided: '4' },
              { day: '2026-07-25', jurisdiction: 'EU', granted: 1, decided: 2 },
              { day: '2026-07-25', jurisdiction: 'US-CA', granted: 0, decided: 5 },
              // decided = 0 → no explicit decisions; must be skipped, not shown as 0%
              { day: '2026-07-25', jurisdiction: 'DEFAULT', granted: 0, decided: 0 }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example:8443' }
    })
    const res = await handler(host)(post({ chartId: 'consent-rate-by-jurisdiction', ...range }))
    const json = (await res.json()) as {
      state: string
      unit: string
      series: { name: string; points: { label: string; value: number }[] }[]
    }
    expect(json.state).toBe('ok')
    expect(json.unit).toBe('percent')
    const names = json.series.map((s) => s.name)
    expect(names).toContain('EU')
    expect(names).toContain('US-CA')
    expect(names).not.toContain('DEFAULT')
    const eu = json.series.find((s) => s.name === 'EU')
    expect(eu?.points).toEqual([
      { label: '2026-07-24', value: 75 },
      { label: '2026-07-25', value: 50 }
    ])
  })

  it('consent-rate with zero recorded decisions → state empty (no invented rate)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            meta: [],
            data: [{ day: '2026-07-25', jurisdiction: 'DEFAULT', granted: 0, decided: 0 }]
          }),
          { status: 200 }
        )
      )
    )
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example:8443' }
    })
    const res = await handler(host)(post({ chartId: 'consent-rate-by-jurisdiction', ...range }))
    const json = (await res.json()) as { state: string; series: unknown[]; message?: string }
    expect(json.state).toBe('empty')
    expect(json.series).toEqual([])
    expect(json.message).toMatch(/consent decision/i)
  })

  it('warehouse error propagates as state error, never fake data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example:8443' }
    })
    const res = await handler(host)(post({ chartId: 'bot-share', ...range }))
    const json = (await res.json()) as { state: string; series: unknown[]; message?: string }
    expect(json.state).toBe('error')
    expect(json.series).toEqual([])
    expect(json.message).toMatch(/boom/)
  })

  it('destination-success-rate derives from recorded delivery stats (STR.4), empty when none', async () => {
    // No stats recorded → honest empty state.
    const emptyRes = await handler()(post({ chartId: 'destination-success-rate', ...range }))
    const emptyJson = (await emptyRes.json()) as { state: string; message?: string }
    expect(emptyJson.state).toBe('empty')
    expect(emptyJson.message).toMatch(/no delivery outcomes/i)

    // Recorded stats + configured secret → real success rate points.
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'https://ch.example:8443/?query=INSERT' }
    })
    await host.kv.put(
      'attestrack:obs:delivery:clickhouse',
      JSON.stringify({
        ok: 90,
        error: 10,
        okToday: 9,
        errorToday: 1,
        day: new Date().toISOString().slice(0, 10),
        lastOkAt: '2026-07-25T10:00:00.000Z'
      })
    )
    const res = await handler(host)(post({ chartId: 'destination-success-rate', ...range }))
    const json = (await res.json()) as {
      state: string
      series: { name: string; points: { label: string; value: number }[] }[]
    }
    expect(json.state).toBe('ok')
    const points = json.series[0]?.points ?? []
    expect(points).toHaveLength(1)
    expect(points[0]?.label).toBe('ClickHouse HTTP sink')
    expect(points[0]?.value).toBe(90)
  })
})
