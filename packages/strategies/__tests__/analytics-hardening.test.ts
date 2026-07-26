import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime, readDeliveryStats } from '@attestrack/sdk'
import type { TrackingEventV1 } from '@attestrack/types'
import {
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_DRIFT_CURRENT,
  KV_KEY_DRIFT_EXPECTED,
  KV_KEY_DRIFT_MISMATCH
} from '@attestrack/types'
import {
  buildClickHouseInsertUrl,
  createClickHouseStrategy,
  toClickHouseRow
} from '../src/analytics/clickhouse.js'
import { createOtelStrategy } from '../src/analytics/otel.js'
import { createTinybirdStrategy } from '../src/analytics/tinybird.js'
import { createDriftDetectionStrategy } from '../src/drift/detection.js'

/**
 * Mutation-hardening suite (Stryker) for the analytics sinks + drift
 * detection: URL assembly branches, auth gating, projection fallback chains,
 * OTLP attribute typing/filtering, header parsing and the exact recorded
 * outcomes. These pin the literals and operators plain smoke tests miss.
 */

const tracking: TrackingEventV1 = {
  v: 1,
  eventName: 'cta_click',
  siteId: 'site-1',
  occurredAt: '2026-07-25T10:00:00.000Z'
}

afterEach(() => vi.restoreAllMocks())

describe('clickhouse strategy hardening', () => {
  it('exposes the exact manifest and strategy identity', () => {
    const s = createClickHouseStrategy()
    expect(s.id).toBe('clickhouse')
    expect(s.stage).toBe('analytics')
    expect(s.manifest).toEqual({
      id: 'clickhouse',
      stage: 'analytics',
      displayName: 'ClickHouse HTTP sink',
      defaultEnabled: false
    })
  })

  it('buildClickHouseInsertUrl: bare base gets ?query=, query-string base gets &query=', () => {
    expect(buildClickHouseInsertUrl('http://ch:8123')).toBe(
      `http://ch:8123?query=${encodeURIComponent('INSERT INTO events FORMAT JSONEachRow')}&date_time_input_format=best_effort`
    )
    expect(buildClickHouseInsertUrl('http://ch:8123/?user=default')).toBe(
      `http://ch:8123/?user=default&query=${encodeURIComponent('INSERT INTO events FORMAT JSONEachRow')}&date_time_input_format=best_effort`
    )
    // Operator-embedded query= (any case) is used verbatim.
    expect(buildClickHouseInsertUrl('http://ch:8123/?QUERY=INSERT%20INTO%20t')).toBe(
      'http://ch:8123/?QUERY=INSERT%20INTO%20t'
    )
  })

  it('toClickHouseRow: consentWouldAllow maps undefined→null, true→1, false→0', () => {
    const resolved = { consentDecision: null, jurisdiction: null }
    expect(toClickHouseRow(tracking, resolved).consentWouldAllow).toBeNull()
    expect(
      toClickHouseRow({ ...tracking, consentWouldAllow: true }, resolved).consentWouldAllow
    ).toBe(1)
    expect(
      toClickHouseRow({ ...tracking, consentWouldAllow: false }, resolved).consentWouldAllow
    ).toBe(0)
  })

  it('no tracking / no URL secret → no fetch, no recorded outcome, pipeline continues', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const configured = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    expect(
      await createClickHouseStrategy().run({ host: configured, request: new Request('https://x/') } as never)
    ).toStrictEqual({ continuePipeline: true })
    const unconfigured = createMockHostRuntime({ secrets: {} })
    expect(
      await createClickHouseStrategy().run({
        host: unconfigured,
        request: new Request('https://x/'),
        tracking
      } as never)
    ).toStrictEqual({ continuePipeline: true })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await readDeliveryStats(configured.kv, 'clickhouse')).toBeNull()
    expect(await readDeliveryStats(unconfigured.kv, 'clickhouse')).toBeNull()
  })

  it('records a non-Error rejection as a generic network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('boom')
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch:8123' } })
    const res = await createClickHouseStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect((await readDeliveryStats(host.kv, 'clickhouse'))?.lastError).toBe('network error')
  })

  it('sends Basic auth ONLY when both user and password are present', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
    const userOnly = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'http://ch:8123', CLICKHOUSE_USER: 'u' }
    })
    await createClickHouseStrategy().run({ host: userOnly, request: new Request('https://x/'), tracking } as never)
    let [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })

    fetchSpy.mockClear()
    const both = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'http://ch:8123', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p' }
    })
    await createClickHouseStrategy().run({ host: both, request: new Request('https://x/'), tracking } as never)
    ;[, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({
      Authorization: `Basic ${btoa('u:p')}`,
      'content-type': 'application/json'
    })
  })

  it('projects the tracking-row consentDecision/jurisdiction fallbacks when no verified token exists', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch:8123' } })
    await createClickHouseStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking: { ...tracking, consentDecision: 'declined', jurisdiction: 'EU' }
    } as never)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const row = JSON.parse(init.body as string) as Record<string, unknown>
    expect(row.consentDecision).toBe('declined')
    expect(row.jurisdiction).toBe('EU')
  })
})

describe('otel strategy hardening', () => {
  const secrets = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/' }

  function lastPayload(fetchSpy: ReturnType<typeof vi.spyOn>) {
    const [url, init] = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit]
    return { url, init, body: JSON.parse(init.body as string) }
  }

  function attrsOf(body: { resourceLogs: { scopeLogs: { logRecords: { attributes: { key: string; value: Record<string, unknown> }[] }[] }[] }[] }) {
    return body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes
  }

  it('exposes the exact manifest and strategy identity', () => {
    const s = createOtelStrategy()
    expect(s.id).toBe('otel')
    expect(s.stage).toBe('analytics')
    expect(s.manifest).toEqual({
      id: 'otel',
      stage: 'analytics',
      displayName: 'OpenTelemetry (OTLP logs) sink',
      defaultEnabled: false
    })
  })

  it('no tracking → no fetch and an unchanged pipeline result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({ secrets })
    const res = await createOtelStrategy().run({ host, request: new Request('https://x/') } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('no endpoint secret → no fetch AND no delivery outcome recorded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({ secrets: {} })
    const res = await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await readDeliveryStats(host.kv, 'otel')).toBeNull()
  })

  it('strips a trailing slash and posts to /v1/logs with defaulted service name', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    const { url, init, body } = lastPayload(fetchSpy)
    expect(url).toBe('http://collector:4318/v1/logs')
    expect(init.method).toBe('POST')
    const resourceAttrs = body.resourceLogs[0].resource.attributes
    expect(resourceAttrs).toEqual([
      { key: 'service.name', value: { stringValue: 'attestrack-tracking' } }
    ])
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0]
    expect(body.resourceLogs[0].scopeLogs[0].scope).toEqual({ name: 'attestrack.tflo' })
    expect(record.severityNumber).toBe(9)
    expect(record.severityText).toBe('INFO')
    expect(record.body).toEqual({ stringValue: 'cta_click' })
    // Exact nanosecond timestamp from occurredAt.
    expect(record.timeUnixNano).toBe(String(Date.parse(tracking.occurredAt) * 1_000_000))
  })

  it('falls back to now-ish nanos when occurredAt is unparseable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    const before = Date.now()
    await createOtelStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking: { ...tracking, occurredAt: 'not-a-date' }
    } as never)
    const after = Date.now()
    const { body } = lastPayload(fetchSpy)
    const nano = Number(body.resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano)
    expect(nano).toBeGreaterThanOrEqual(before * 1_000_000)
    expect(nano).toBeLessThanOrEqual(after * 1_000_000)
  })

  it('types attribute values: int→intValue string, float→doubleValue, bool→boolValue, string→stringValue', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    await createOtelStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking: {
        ...tracking,
        dwellMs: 1200,
        webVitalValue: 1240.5,
        pagePath: '/pricing',
        // Defensive branch: a non-string params value must map to boolValue,
        // not be stringified — pinned via cast since upstream zod keeps it string.
        params: true as unknown as string
      }
    } as never)
    const attrs = attrsOf(lastPayload(fetchSpy).body)
    const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]))
    expect(byKey.dwellMs).toEqual({ intValue: '1200' })
    expect(byKey.webVitalValue).toEqual({ doubleValue: 1240.5 })
    expect(byKey.pagePath).toEqual({ stringValue: '/pricing' })
    expect(byKey.params).toEqual({ boolValue: true })
  })

  it('omits null/undefined promoted fields and defaults consent/jurisdiction attrs', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    const attrs = attrsOf(lastPayload(fetchSpy).body)
    const keys = attrs.map((a) => a.key)
    expect(keys).toEqual(['event.name', 'consent.decision', 'jurisdiction', 'siteId'])
    const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]))
    expect(byKey['event.name']).toEqual({ stringValue: 'cta_click' })
    expect(byKey['consent.decision']).toEqual({ stringValue: 'unknown' })
    expect(byKey.jurisdiction).toEqual({ stringValue: '' })
  })

  it('prefers the verified token decision and the pipeline jurisdiction key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    await createOtelStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking: { ...tracking, consentDecision: 'declined', jurisdiction: 'US-CA' },
      consent: { raw: 'r', payload: { decision: 'granted' } },
      jurisdictionKey: 'EU'
    } as never)
    const byKey = Object.fromEntries(attrsOf(lastPayload(fetchSpy).body).map((a) => [a.key, a.value]))
    expect(byKey['consent.decision']).toEqual({ stringValue: 'granted' })
    expect(byKey.jurisdiction).toEqual({ stringValue: 'EU' })
  })

  it('falls back to the tracking-row decision when no token verified', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    await createOtelStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking: { ...tracking, consentDecision: 'withdrawn', jurisdiction: 'US-CA' }
    } as never)
    const byKey = Object.fromEntries(attrsOf(lastPayload(fetchSpy).body).map((a) => [a.key, a.value]))
    expect(byKey['consent.decision']).toEqual({ stringValue: 'withdrawn' })
    expect(byKey.jurisdiction).toEqual({ stringValue: 'US-CA' })
  })

  it('parses OTEL_EXPORTER_OTLP_HEADERS pairs with trimming; malformed pairs are dropped', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({
      secrets: {
        ...secrets,
        OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=abc, authorization = Bearer tok,junk,=orphan,eq=a=b'
      }
    })
    await createOtelStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    const { init } = lastPayload(fetchSpy)
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'abc',
      authorization: 'Bearer tok',
      eq: 'a=b'
    })
  })

  it('records delivery outcomes: ok on 2xx, HTTP status detail otherwise, network error on throw', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const host = createMockHostRuntime({ secrets })
    const ctx = { host, request: new Request('https://x/'), tracking } as never
    await createOtelStrategy().run(ctx)
    expect((await readDeliveryStats(host.kv, 'otel'))?.ok).toBe(1)

    fetchSpy.mockResolvedValue(new Response(null, { status: 503 }))
    await createOtelStrategy().run(ctx)
    expect((await readDeliveryStats(host.kv, 'otel'))?.lastError).toBe('HTTP 503')

    fetchSpy.mockRejectedValue('non-error')
    const res = await createOtelStrategy().run(ctx)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect((await readDeliveryStats(host.kv, 'otel'))?.lastError).toBe('network error')
  })
})

describe('tinybird strategy hardening', () => {
  it('exposes the exact manifest and strategy identity', () => {
    const s = createTinybirdStrategy()
    expect(s.id).toBe('tinybird')
    expect(s.stage).toBe('analytics')
    expect(s.manifest).toEqual({
      id: 'tinybird',
      stage: 'analytics',
      displayName: 'Tinybird Events API',
      defaultEnabled: false
    })
  })

  it('no tracking / no token → no fetch, strict continue', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const withToken = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    expect(
      await createTinybirdStrategy().run({ host: withToken, request: new Request('https://x/') } as never)
    ).toStrictEqual({ continuePipeline: true })
    const withoutToken = createMockHostRuntime({ secrets: {} })
    expect(
      await createTinybirdStrategy().run({
        host: withoutToken,
        request: new Request('https://x/'),
        tracking
      } as never)
    ).toStrictEqual({ continuePipeline: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs NDJSON to the Events API with the default datasource and Bearer auth', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }))
    const host = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    await createTinybirdStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking: { ...tracking, consentDecision: 'declined', jurisdiction: 'US-CA' }
    } as never)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.tinybird.co/v0/events?name=events')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
    const body = init.body as string
    expect(body.endsWith('\n')).toBe(true)
    expect(JSON.parse(body)).toEqual({
      ...tracking,
      consentDecision: 'declined',
      consent_decision: 'declined',
      jurisdiction: 'US-CA'
    })
  })

  it('URL-encodes a custom datasource and prefers token decision + pipeline jurisdiction', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }))
    const host = createMockHostRuntime({
      secrets: { TINYBIRD_TOKEN: 'tok', TINYBIRD_DATASOURCE: 'my events' }
    })
    await createTinybirdStrategy().run({
      host,
      request: new Request('https://x/'),
      tracking,
      consent: { raw: 'r', payload: { decision: 'granted' } },
      jurisdictionKey: 'EU'
    } as never)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.tinybird.co/v0/events?name=my%20events')
    const payload = JSON.parse(init.body as string) as Record<string, unknown>
    expect(payload.consent_decision).toBe('granted')
    expect(payload.jurisdiction).toBe('EU')
  })

  it('records HTTP failure detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 429 }))
    const host = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    await createTinybirdStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    const stats = await readDeliveryStats(host.kv, 'tinybird')
    expect(stats?.lastError).toBe('HTTP 429')
  })

  it('records a non-Error rejection as a generic network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('boom')
    const host = createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tok' } })
    const res = await createTinybirdStrategy().run({ host, request: new Request('https://x/'), tracking } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect((await readDeliveryStats(host.kv, 'tinybird'))?.lastError).toBe('network error')
  })
})

describe('drift detection hardening', () => {
  async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  it('exposes the exact manifest and strategy identity', () => {
    const s = createDriftDetectionStrategy()
    expect(s.id).toBe('drift-detection')
    expect(s.stage).toBe('analytics')
    expect(s.manifest).toEqual({
      id: 'drift-detection',
      stage: 'analytics',
      displayName: 'Configuration drift detection'
    })
  })

  it('an ABSENT consent config hashes as the empty string (matches an empty-config fingerprint)', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(KV_KEY_DRIFT_EXPECTED, await sha256Hex(''))
    const res = await createDriftDetectionStrategy().run({ host, request: new Request('https://x/') } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect(await host.kv.get(KV_KEY_DRIFT_CURRENT)).toBe(await sha256Hex(''))
    expect(await host.kv.get(KV_KEY_DRIFT_MISMATCH)).toBeNull()
  })

  it('writes the mismatch record with a 1-hour TTL', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await host.kv.put(KV_KEY_CONSENT_CONFIG, '{"v":2}')
    await host.kv.put(KV_KEY_DRIFT_EXPECTED, await sha256Hex('{"v":1}'))
    put.mockClear()
    await createDriftDetectionStrategy().run({ host, request: new Request('https://x/') } as never)
    const mismatchCall = put.mock.calls.find((c) => c[0] === KV_KEY_DRIFT_MISMATCH)
    expect(mismatchCall).toBeDefined()
    expect(mismatchCall![2]).toEqual({ expirationTtl: 3600 })
  })
})
