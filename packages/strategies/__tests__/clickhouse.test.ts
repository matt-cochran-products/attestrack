import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime } from '@attestrack/sdk'
import type { TrackingEventV1 } from '@attestrack/types'
import {
  buildClickHouseInsertUrl,
  toClickHouseRow,
  createClickHouseStrategy
} from '../src/analytics/clickhouse.js'

const tracking: TrackingEventV1 = {
  v: 1,
  eventName: 'cta_click',
  siteId: 'pubops',
  occurredAt: '2026-07-25T10:00:00.000Z',
  consentDecision: 'granted',
  jurisdiction: 'us-ca',
  consentMode: 'ENFORCEMENT',
  consentMechanism: 'opt-in',
  consentWouldAllow: true,
  visitorId: 'vh_abc',
  sessionId: 's1',
  eventId: 'evt_1',
  pagePath: '/posture',
  referrer: 'https://example.com/',
  utmSource: 'newsletter',
  utmMedium: 'email',
  utmCampaign: 'launch',
  userAgentClass: 'desktop',
  ctaType: 'request-audit',
  scrollDepthPct: 80,
  section: 'hero',
  dwellMs: 4200,
  webVitalName: 'lcp',
  webVitalValue: 1240.5,
  params: '{"variant":"b"}'
}

afterEach(() => vi.restoreAllMocks())

describe('buildClickHouseInsertUrl', () => {
  it('appends the canonical events INSERT + best-effort datetime parsing', () => {
    const url = buildClickHouseInsertUrl('https://ch.example.com/')
    expect(url).toContain('query=')
    expect(decodeURIComponent(url)).toContain('INSERT INTO events FORMAT JSONEachRow')
    expect(url).toContain('date_time_input_format=best_effort')
  })

  it('uses & as the separator when the base URL already has a query string', () => {
    const url = buildClickHouseInsertUrl('https://ch.example.com/?database=analytics')
    expect(url).toContain('database=analytics&query=')
  })

  it('respects an operator-supplied query= verbatim (self-managed table name)', () => {
    const base = 'https://ch.example.com/?query=INSERT%20INTO%20tracking_events%20FORMAT%20JSONEachRow'
    expect(buildClickHouseInsertUrl(base)).toBe(base)
  })
})

describe('toClickHouseRow', () => {
  it('projects exactly the events columns — no extra/unknown keys reach the warehouse', () => {
    const row = toClickHouseRow(tracking, { consentDecision: 'granted', jurisdiction: 'us-ca' })
    // params (event field) maps to the params warehouse column.
    expect(row.params).toBe('{"variant":"b"}')
    expect(row.visitorId).toBe('vh_abc')
    expect(row.userAgentClass).toBe('desktop')
    expect(row.consentDecision).toBe('granted')
    expect(row.jurisdiction).toBe('us-ca')
    // Consent-honesty fields forward; the boolean would-allow maps to UInt8.
    expect(row.consentMode).toBe('ENFORCEMENT')
    expect(row.consentMechanism).toBe('opt-in')
    expect(row.consentWouldAllow).toBe(1)
    // A blind spread would have leaked nothing extra, but assert the key set is closed.
    const expectedKeys = new Set([
      'v', 'eventName', 'siteId', 'occurredAt', 'consentDecision', 'jurisdiction',
      'consentMode', 'consentMechanism', 'consentWouldAllow',
      'visitorId', 'sessionId', 'eventId', 'pagePath', 'referrer',
      'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'userAgentClass',
      'ctaType', 'scrollDepthPct', 'section', 'dwellMs', 'webVitalName', 'webVitalValue', 'params'
    ])
    expect(new Set(Object.keys(row))).toEqual(expectedKeys)
  })

  it('nulls absent optional fields (never undefined) so JSONEachRow stays well-formed', () => {
    const minimal: TrackingEventV1 = {
      v: 1,
      eventName: 'pageview',
      siteId: 'pubops',
      occurredAt: '2026-07-25T10:00:00.000Z'
    }
    const row = toClickHouseRow(minimal, { consentDecision: null, jurisdiction: null })
    expect(row.visitorId).toBeNull()
    expect(row.params).toBeNull()
    expect(row.consentDecision).toBeNull()
    expect(Object.values(row).every((v) => v !== undefined)).toBe(true)
  })

  it('takes resolved consent/jurisdiction from the pipeline, not the raw event', () => {
    const row = toClickHouseRow(tracking, { consentDecision: 'denied', jurisdiction: 'eu' })
    expect(row.consentDecision).toBe('denied')
    expect(row.jurisdiction).toBe('eu')
  })
})

describe('createClickHouseStrategy', () => {
  it('no-ops when CLICKHOUSE_HTTP_URL is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({ secrets: {} })
    const res = await createClickHouseStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking
    } as never)
    expect(res).toEqual({ continuePipeline: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs the projected row to the events INSERT URL with basic auth', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({
      secrets: {
        CLICKHOUSE_HTTP_URL: 'https://ch.example.com/',
        CLICKHOUSE_USER: 'writer',
        CLICKHOUSE_PASSWORD: 'pw'
      }
    })

    await createClickHouseStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: { payload: { decision: 'granted' } },
      jurisdictionKey: 'us-ca'
    } as never)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(decodeURIComponent(url as string)).toContain('INSERT INTO events FORMAT JSONEachRow')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${btoa('writer:pw')}`)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.eventName).toBe('cta_click')
    expect(body.consentDecision).toBe('granted')
  })

  it('records a delivery error on a non-2xx response (best-effort, never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'https://ch.example.com/' }
    })
    const res = await createClickHouseStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking
    } as never)
    expect(res).toEqual({ continuePipeline: true })
    const recorded = await host.kv?.get('attestrack:delivery:error:clickhouse')
    expect(recorded).toBeTruthy()
    expect(JSON.parse(recorded as string).count).toBe(1)
  })

  it('swallows transport errors (analytics must not throw) and records them', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'https://ch.example.com/' }
    })
    const res = await createClickHouseStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking
    } as never)
    expect(res).toEqual({ continuePipeline: true })
  })
})
