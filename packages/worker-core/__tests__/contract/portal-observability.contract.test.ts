import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMockHostRuntime,
  flushMockBackgroundTasks,
  incrementDailyCounter,
  noopStrategyLoader,
  recordDeliveryResult
} from '@attestrack/sdk'
import { allBundledStrategies } from '@attestrack/strategies'
import {
  KV_KEY_DRIFT_MISMATCH,
  KV_KEY_OBS_BOTS_PREFIX,
  KV_KEY_PORTAL_ALERT_RULES
} from '@attestrack/types'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import type { DashboardMetricsPayload, DestinationStatusRow, RequestLogEntry } from '../../src/observability.js'

const PORTAL = 'https://t.example.com/__attestrack__/portal/v1'

function makeHandler(secrets: Record<string, string | undefined> = {}) {
  const host = createMockHostRuntime({
    secrets: { CONSENT_TOKEN_SECRET: 's'.repeat(32), ...secrets }
  })
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: allBundledStrategies(),
    strategyLoader: noopStrategyLoader
  })
  return { host, handler }
}

function trackingBody(eventName = 'page_view') {
  return JSON.stringify({
    v: 1,
    eventName,
    siteId: 'local',
    occurredAt: new Date().toISOString()
  })
}

afterEach(() => vi.restoreAllMocks())

describe('P3 portal observability endpoints (computed, never seeded)', () => {
  it('GET /logs returns entries recorded by real /t/event ingests — no KV seeding', async () => {
    const { host, handler } = makeHandler()
    for (const name of ['page_view', 'cta_click']) {
      const res = await handler(
        new Request('https://t.example.com/t/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: trackingBody(name)
        })
      )
      expect(res.status).toBe(200)
    }
    await flushMockBackgroundTasks(host)

    const logsRes = await handler(new Request(`${PORTAL}/logs/incoming`, { method: 'GET' }))
    expect(logsRes.status).toBe(200)
    const logs = (await logsRes.json()) as RequestLogEntry[]
    expect(logs.length).toBe(2)
    // Newest first.
    expect(logs[0]?.event).toBe('cta_click')
    expect(logs[1]?.event).toBe('page_view')
    expect(logs[0]?.source).toBe('browser')
    expect(logs[0]?.status).toBe('PROCESSED')
    // Jurisdiction resolved by the real pipeline (no geo in mock → DEFAULT row).
    expect(logs[0]?.jurisdiction).toBe('DEFAULT')
    expect(typeof logs[0]?.processingTime).toBe('number')
  })

  it('GET /dashboard computes eventsToday from the ingest counter and IGNORES seeded dashboard JSON', async () => {
    const { host, handler } = makeHandler()
    // A leftover operator-seeded value must NOT surface (launch honesty rule).
    await host.kv.put(
      'attestrack:portal:dashboard',
      JSON.stringify({ eventsToday: 999999, driftAlertCount: 42 })
    )

    const res = await handler(
      new Request('https://t.example.com/t/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: trackingBody()
      })
    )
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)

    const dashRes = await handler(new Request(`${PORTAL}/dashboard`, { method: 'GET' }))
    expect(dashRes.status).toBe(200)
    const dash = (await dashRes.json()) as DashboardMetricsPayload
    expect(dash.eventsToday).toBe(1)
    expect(dash.driftAlertCount).toBe(0)
    expect(dash.driftAlert).toBeNull()
    // Nothing configured in this deployment → honest 'inactive', not fake health.
    expect(dash.strategyStatus).toBe('inactive')
    expect(dash.shadowModeLabel).toContain('Shadow')
  })

  it('GET /dashboard surfaces a real drift mismatch (P3.5)', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(
      KV_KEY_DRIFT_MISMATCH,
      JSON.stringify({ at: '2026-07-25T09:00:00.000Z', expected: 'aaa', current: 'bbb' })
    )
    const dash = (await (
      await handler(new Request(`${PORTAL}/dashboard`, { method: 'GET' }))
    ).json()) as DashboardMetricsPayload
    expect(dash.driftAlertCount).toBe(1)
    expect(dash.driftAlert).toEqual({
      at: '2026-07-25T09:00:00.000Z',
      expected: 'aaa',
      current: 'bbb'
    })
  })

  it('GET /destinations derives status/auth from secrets + recorded delivery stats', async () => {
    const { host, handler } = makeHandler({ CLICKHOUSE_HTTP_URL: 'https://ch.example.com/' })
    await recordDeliveryResult(host.kv, 'clickhouse', { ok: true })
    await recordDeliveryResult(host.kv, 'clickhouse', { ok: true })
    await recordDeliveryResult(host.kv, 'clickhouse', { ok: false, detail: 'HTTP 500' })

    const res = await handler(new Request(`${PORTAL}/destinations`, { method: 'GET' }))
    expect(res.status).toBe(200)
    const rows = (await res.json()) as DestinationStatusRow[]

    const ch = rows.find((r) => r.id === 'clickhouse')
    expect(ch?.auth).toBe('configured')
    // Last attempt failed → degraded, with an honest success rate.
    expect(ch?.status).toBe('degraded')
    expect(ch?.successRate).toBeCloseTo(66.7, 1)
    expect(ch?.eventsToday).toBe(2)
    expect(ch?.lastEvent).toBeTruthy()

    const meta = rows.find((r) => r.id === 'meta-capi')
    expect(meta?.status).toBe('inactive')
    expect(meta?.auth).toBe('not configured')
  })

  it('GET /destinations reports configured-but-quiet endpoints as no_data (not fake health)', async () => {
    const { handler } = makeHandler({ TINYBIRD_TOKEN: 'tok' })
    const rows = (await (
      await handler(new Request(`${PORTAL}/destinations`, { method: 'GET' }))
    ).json()) as DestinationStatusRow[]
    const tb = rows.find((r) => r.id === 'tinybird')
    expect(tb?.status).toBe('no_data')
    expect(tb?.auth).toBe('configured')
    expect(tb?.successRate).toBe(0)
  })

  it('end-to-end: an ingest with a configured sink records delivery and healthies the row', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const { host, handler } = makeHandler({ CLICKHOUSE_HTTP_URL: 'https://ch.example.com/' })
    const res = await handler(
      new Request('https://t.example.com/t/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: trackingBody()
      })
    )
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)

    const rows = (await (
      await handler(new Request(`${PORTAL}/destinations`, { method: 'GET' }))
    ).json()) as DestinationStatusRow[]
    const ch = rows.find((r) => r.id === 'clickhouse')
    expect(ch?.status).toBe('healthy')
    expect(ch?.successRate).toBe(100)
    expect(ch?.eventsToday).toBe(1)
  })

  it('GET /signal reports the P3.3 de-scope honestly, with only the real bot counter', async () => {
    const { host, handler } = makeHandler()
    await incrementDailyCounter(host.kv, KV_KEY_OBS_BOTS_PREFIX)
    await incrementDailyCounter(host.kv, KV_KEY_OBS_BOTS_PREFIX)

    const res = await handler(new Request(`${PORTAL}/signal-recovery`, { method: 'GET' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      measured: boolean
      reason: string
      botRequestsFiltered: number
    }
    expect(body.measured).toBe(false)
    expect(body.reason).toBe('requires_beacon')
    expect(body.botRequestsFiltered).toBe(2)
  })

  it('GET /signal-recovery/timeline stays empty (de-scoped, never invented points)', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      new Request(`${PORTAL}/signal-recovery/timeline?days=7`, { method: 'GET' })
    )
    expect(await res.json()).toEqual([])
  })

  it('GET /alert-rules merges operator rules with a synthetic drift row when drift is active (P3.5)', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(
      KV_KEY_PORTAL_ALERT_RULES,
      JSON.stringify([
        { destination: 'Meta CAPI', condition: 'Success rate < 95%', email: 'ops@example.com', active: true }
      ])
    )
    await host.kv.put(
      KV_KEY_DRIFT_MISMATCH,
      JSON.stringify({ at: '2026-07-25T09:00:00.000Z', expected: 'aaa', current: 'bbb' })
    )
    const rules = (await (
      await handler(new Request(`${PORTAL}/alert-rules`, { method: 'GET' }))
    ).json()) as { destination: string; condition: string }[]
    expect(rules.length).toBe(2)
    expect(rules[0]?.destination).toBe('consent-config')
    expect(rules[0]?.condition).toContain('Drift detected')
    expect(rules[1]?.destination).toBe('Meta CAPI')
  })

  it('GET /alert-rules returns operator rules only when no drift is recorded', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(KV_KEY_PORTAL_ALERT_RULES, JSON.stringify([]))
    const rules = (await (
      await handler(new Request(`${PORTAL}/alert-rules`, { method: 'GET' }))
    ).json()) as unknown[]
    expect(rules).toEqual([])
  })
})
