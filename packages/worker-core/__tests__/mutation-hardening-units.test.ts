import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime } from '@attestrack/sdk'
import type { Strategy } from '@attestrack/sdk'
import { EXPLORE_MAX_ROWS } from '@attestrack/schema'
import { KV_KEY_OBS_DELIVERY_PREFIX, KV_KEY_OBS_LOG_PREFIX, KV_KEY_DRIFT_MISMATCH } from '@attestrack/types'
import {
  runDestinationStrategiesParallel,
  runMandatoryStrategies,
  runStrategiesForStage
} from '../src/composite.js'
import { defaultSiteConfig, effectiveSiteMode, readSiteConfig } from '../src/config.js'
import {
  corsHeaders,
  isOriginAllowed,
  preflightResponse,
  resolveCorsOrigin,
  withCors
} from '../src/cors.js'
import { filterStrategiesByEnabledKv, parseEnabledStrategiesKv } from '../src/enabled-strategies.js'
import { executeExploreSql, isExploreWarehouseConfigured } from '../src/explore-warehouse.js'
import {
  appendRequestLog,
  buildDestinationRows,
  computeDashboardMetrics,
  computeSignalRecovery,
  consentLogLabel,
  ingestLogStatus,
  logKeyForHour,
  readDriftMismatch,
  readRecentLogs,
  recordIngestObservability
} from '../src/observability.js'

/**
 * Mutation-hardening suite (Stryker) — unit level. Pins the CORS allowlist
 * edges, pipeline short-circuit semantics, enabled-KV validation, warehouse
 * executor wire format + error payloads, and the observability math
 * (success-rate windows, degradation boundaries, log ring, sampling).
 */

afterEach(() => vi.restoreAllMocks())

function strategy(id: string, stage: Strategy['stage'], run: Strategy['run']): Strategy {
  return { id, stage, run }
}

describe('composite pipeline short-circuits', () => {
  it('mandatory stage stops at continuePipeline:false and isolates ONLY troll-shield throws', async () => {
    const calls: string[] = []
    const stop = strategy('gate', 'mandatory', async () => {
      calls.push('gate')
      return { continuePipeline: false }
    })
    const after = strategy('after', 'mandatory', async () => {
      calls.push('after')
      return { continuePipeline: true }
    })
    await runMandatoryStrategies({} as never, [stop, after])
    expect(calls).toEqual(['gate'])

    // A non-troll-shield mandatory failure must propagate (fail-closed).
    const boom = strategy('other', 'mandatory', async () => {
      throw new Error('boom')
    })
    await expect(runMandatoryStrategies({} as never, [boom])).rejects.toThrow('boom')

    // troll-shield failures are isolated and the pipeline continues.
    const shield = strategy('troll-shield', 'mandatory', async () => {
      throw new Error('detector down')
    })
    const tail = strategy('tail', 'mandatory', async () => {
      calls.push('tail')
      return { continuePipeline: true }
    })
    await runMandatoryStrategies({} as never, [shield, tail])
    expect(calls).toEqual(['gate', 'tail'])
  })

  it('staged (analytics) execution stops at continuePipeline:false', async () => {
    const calls: string[] = []
    const first = strategy('a1', 'analytics', async () => {
      calls.push('a1')
      return { continuePipeline: false }
    })
    const second = strategy('a2', 'analytics', async () => {
      calls.push('a2')
      return { continuePipeline: true }
    })
    await runStrategiesForStage('analytics', {} as never, [first, second])
    expect(calls).toEqual(['a1'])
  })

  it('destination stage isolates individual failures', async () => {
    const calls: string[] = []
    const bad = strategy('d1', 'destination', async () => {
      throw new Error('down')
    })
    const good = strategy('d2', 'destination', async () => {
      calls.push('d2')
      return { continuePipeline: true }
    })
    await runDestinationStrategiesParallel({} as never, [bad, good])
    expect(calls).toEqual(['d2'])
  })
})

describe('site config defaults + parsing', () => {
  it('pins the exact community defaults (INV-B-03 SHADOW start)', () => {
    expect(defaultSiteConfig.mode).toBe('SHADOW')
    expect(defaultSiteConfig.workerVersion).toBe('0.0.0')
    expect(defaultSiteConfig.consentConfigured).toBe(true)
    expect(defaultSiteConfig.ipHandling).toBe('hash_salt')
    expect(defaultSiteConfig.trustedDomains).toEqual([])
    expect(defaultSiteConfig.driftDetection).toEqual({
      enabled: true,
      quarantineNew: false,
      alertThreshold: 0.05
    })
    expect(defaultSiteConfig.state1TokenTTL).toBe(86400)
  })

  it('readSiteConfig returns the SAME default object for absent and corrupt KV', async () => {
    const empty = createMockHostRuntime()
    expect(await readSiteConfig(empty)).toBe(defaultSiteConfig)
    const corrupt = createMockHostRuntime()
    await corrupt.kv.put('attestrack:portal:site_config', '{not json')
    expect(await readSiteConfig(corrupt)).toBe(defaultSiteConfig)
  })

  it('effectiveSiteMode: only explicit ENFORCEMENT enforces', () => {
    expect(effectiveSiteMode({ mode: 'ENFORCEMENT' })).toBe('ENFORCEMENT')
    expect(effectiveSiteMode({ mode: 'SHADOW' })).toBe('SHADOW')
    expect(effectiveSiteMode({ mode: 'NOT_CONFIGURED' })).toBe('SHADOW')
  })
})

describe('enabled-strategies KV validation', () => {
  it('rejects arrays with any non-string entry; accepts pure string arrays', () => {
    expect(parseEnabledStrategiesKv('["a",1]')).toBeNull()
    expect(parseEnabledStrategiesKv('[1]')).toBeNull()
    expect(parseEnabledStrategiesKv('["clickhouse","otel"]')).toEqual(['clickhouse', 'otel'])
    expect(parseEnabledStrategiesKv('[]')).toEqual([])
  })

  it('filterStrategiesByEnabledKv keeps mandatory always, filters the rest', () => {
    const list = [
      strategy('consent', 'mandatory', async () => ({ continuePipeline: true })),
      strategy('meta-capi', 'destination', async () => ({ continuePipeline: true })),
      strategy('otel', 'analytics', async () => ({ continuePipeline: true }))
    ]
    expect(filterStrategiesByEnabledKv(list, ['otel']).map((s) => s.id)).toEqual([
      'consent',
      'otel'
    ])
    expect(filterStrategiesByEnabledKv(list, null).map((s) => s.id)).toEqual([
      'consent',
      'meta-capi',
      'otel'
    ])
  })
})

describe('CORS allowlist (P2.1/P7 credentialed-CORS edges)', () => {
  const cfg = { domain: 'example.com', trustedDomains: [] as string[] }

  it('allows the apex and subdomains over https only', () => {
    expect(isOriginAllowed('https://example.com', cfg)).toBe(true)
    expect(isOriginAllowed('https://app.example.com', cfg)).toBe(true)
    expect(isOriginAllowed('http://example.com', cfg)).toBe(false)
    expect(isOriginAllowed('https://evil.com', cfg)).toBe(false)
    expect(isOriginAllowed('https://notexample.com', cfg)).toBe(false)
  })

  it('an empty allowlist entry never matches — not even dot-terminated hostnames', () => {
    const emptyDomain = { domain: '', trustedDomains: [] as string[] }
    expect(isOriginAllowed('https://anything.com', emptyDomain)).toBe(false)
    expect(isOriginAllowed('https://x.com.', emptyDomain)).toBe(false)
  })

  it('loopback origins (any scheme/port) require an EXPLICIT listing', () => {
    expect(isOriginAllowed('http://localhost:5173', cfg)).toBe(false)
    expect(
      isOriginAllowed('http://localhost:5173', { ...cfg, trustedDomains: ['localhost'] })
    ).toBe(true)
    expect(
      isOriginAllowed('http://127.0.0.1:3000', { ...cfg, trustedDomains: ['127.0.0.1'] })
    ).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:3000', cfg)).toBe(false)
    expect(isOriginAllowed('http://[::1]:8080', { ...cfg, trustedDomains: ['[::1]'] })).toBe(true)
    expect(isOriginAllowed('http://[::1]:8080', cfg)).toBe(false)
  })

  it('host:port entries match on url.host for loopback and https origins', () => {
    expect(
      isOriginAllowed('http://localhost:5173', { ...cfg, trustedDomains: ['localhost:5173'] })
    ).toBe(true)
    expect(
      isOriginAllowed('https://app.example.org:8443', {
        ...cfg,
        trustedDomains: ['app.example.org:8443']
      })
    ).toBe(true)
  })

  it('resolveCorsOrigin: absent and literal-null origins resolve to null', () => {
    expect(resolveCorsOrigin(new Request('https://x/'), cfg)).toBeNull()
    expect(
      resolveCorsOrigin(new Request('https://x/', { headers: { origin: 'null' } }), cfg)
    ).toBeNull()
    expect(
      resolveCorsOrigin(
        new Request('https://x/', { headers: { origin: 'https://app.example.com' } }),
        cfg
      )
    ).toBe('https://app.example.com')
  })

  it('withCors leaves a response untouched for a null origin (no acao leakage)', () => {
    const res = withCors(new Response('x'), null)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const allowed = withCors(new Response('x'), 'https://app.example.com')
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')
    expect(allowed.headers.get('vary')).toBe('Origin')
  })

  it('preflight: disallowed origins get a bare 204 with Vary only; allowed get the full header set', () => {
    const denied = preflightResponse(
      new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.com' } }),
      cfg,
      'GET, POST, OPTIONS'
    )
    expect(denied.status).toBe(204)
    expect(denied.headers.get('vary')).toBe('Origin')
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()

    const ok = preflightResponse(
      new Request('https://x/', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com', 'access-control-request-headers': 'x-foo' }
      }),
      cfg,
      'GET, POST, OPTIONS'
    )
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(ok.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
    expect(ok.headers.get('access-control-allow-headers')).toBe('x-foo')
    expect(ok.headers.get('access-control-max-age')).toBe('86400')

    const noReqHeaders = preflightResponse(
      new Request('https://x/', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com' }
      }),
      cfg,
      'GET, POST, OPTIONS'
    )
    expect(noReqHeaders.headers.get('access-control-allow-headers')).toBe('content-type')
  })

  it('corsHeaders emits exactly the credentialed trio', () => {
    expect(corsHeaders('https://a.example.com')).toEqual({
      'access-control-allow-origin': 'https://a.example.com',
      'access-control-allow-credentials': 'true',
      vary: 'Origin'
    })
  })
})

describe('explore warehouse executor', () => {
  const SQL = 'SELECT eventName FROM events LIMIT 10'

  it('not configured: exact error envelope', async () => {
    const host = createMockHostRuntime({ secrets: {} })
    expect(isExploreWarehouseConfigured(host)).toBe(false)
    const res = await executeExploreSql(host, SQL)
    expect(res).toEqual({
      ok: false,
      status: 503,
      error: 'explore_warehouse_not_configured',
      details: {
        reason:
          'No warehouse credentials: set TINYBIRD_TOKEN or CLICKHOUSE_QUERY_URL (or CLICKHOUSE_HTTP_URL for origin-only query base).',
        code: 'explore_warehouse_not_configured'
      }
    })
  })

  it('clickhouse: POSTs text/plain SQL + FORMAT JSON to <base>/ with Basic auth only when user+pass', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{"data":[],"meta":[]}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'http://ch:8123/', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p' }
    })
    await executeExploreSql(host, SQL)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://ch:8123/')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: `Basic ${btoa('u:p')}`,
      'content-type': 'text/plain; charset=utf-8'
    })
    expect(init.body).toBe(`${SQL}\nFORMAT JSON\n`)

    fetchSpy.mockClear()
    const noPass = createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'http://ch:8123', CLICKHOUSE_USER: 'u' }
    })
    await executeExploreSql(noPass, SQL)
    const [, init2] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init2.headers).toEqual({ 'content-type': 'text/plain; charset=utf-8' })
  })

  it('derives the clickhouse query base from CLICKHOUSE_HTTP_URL origin', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"data":[],"meta":[]}', { status: 200 }))
    const host = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'http://ch:8123/ingest?query=INSERT' }
    })
    expect(isExploreWarehouseConfigured(host)).toBe(true)
    await executeExploreSql(host, SQL)
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[0]).toBe('http://ch:8123/')
  })

  it('non-JSON warehouse response: bad_response with a 200-char sample', async () => {
    const long = 'x'.repeat(250)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(long, { status: 200 }))
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    const res = await executeExploreSql(host, SQL)
    expect(res).toEqual({
      ok: false,
      status: 502,
      error: 'explore_warehouse_bad_response',
      details: { reason: 'ClickHouse returned non-JSON.', sample: 'x'.repeat(200) }
    })
  })

  it('in-band ClickHouse exception: 400 rejected with the exception as reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"exception":"Code: 62. Syntax error"}', { status: 200 })
    )
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    const res = await executeExploreSql(host, SQL)
    expect(res).toEqual({
      ok: false,
      status: 400,
      error: 'explore_warehouse_rejected',
      details: { reason: 'Code: 62. Syntax error' }
    })
  })

  it('HTTP errors: 400 passes through, others map to 502; reason is a 500-char slice', async () => {
    const long = 'e'.repeat(600)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(long, { status: 500 }))
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    const res = await executeExploreSql(host, SQL)
    expect(res).toEqual({
      ok: false,
      status: 502,
      error: 'explore_warehouse_http_error',
      details: { reason: 'e'.repeat(500), status: 500, target: 'clickhouse' }
    })
    fetchSpy.mockResolvedValue(new Response('bad query', { status: 400 }))
    const res400 = await executeExploreSql(host, SQL)
    expect(res400).toEqual({
      ok: false,
      status: 400,
      error: 'explore_warehouse_http_error',
      details: { reason: 'bad query', status: 400, target: 'clickhouse' }
    })
  })

  it('parses rows/columns, filters empty column names, and flags truncation at EXPLORE_MAX_ROWS', async () => {
    const rows = Array.from({ length: EXPLORE_MAX_ROWS }, (_, i) => ({ n: i }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: rows, meta: [{ name: 'n' }, { name: '' }] }), {
        status: 200
      })
    )
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch' } })
    const res = await executeExploreSql(host, SQL)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.columns).toEqual(['n'])
      expect(res.rowCount).toBe(EXPLORE_MAX_ROWS)
      expect(res.truncated).toBe(true)
    }
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: rows.slice(1), meta: [{ name: 'n' }] }), { status: 200 })
    )
    const under = await executeExploreSql(host, SQL)
    expect(under.ok && under.truncated).toBe(false)
  })

  it('tinybird takes precedence: GET v0/sql with encoded query, Bearer auth, tinybird-tagged errors', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('teapot', { status: 418 }))
    const host = createMockHostRuntime({
      secrets: { TINYBIRD_TOKEN: 'tok', CLICKHOUSE_QUERY_URL: 'http://ch' }
    })
    const res = await executeExploreSql(host, SQL)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://api.tinybird.co/v0/sql?q=${encodeURIComponent(SQL)}&default_format=JSON`
    )
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(res).toEqual({
      ok: false,
      status: 502,
      error: 'explore_warehouse_http_error',
      details: { reason: 'teapot', status: 418, target: 'tinybird' }
    })
  })

  it('tinybird: custom TINYBIRD_API_URL loses its trailing slash; network failure is tagged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('dns down'))
    const host = createMockHostRuntime({
      secrets: { TINYBIRD_TOKEN: 'tok', TINYBIRD_API_URL: 'https://tb.internal/' }
    })
    const res = await executeExploreSql(host, SQL)
    expect((fetchSpy.mock.calls[0] as [string])[0].startsWith('https://tb.internal/v0/sql?q=')).toBe(
      true
    )
    expect(res).toEqual({
      ok: false,
      status: 502,
      error: 'explore_warehouse_fetch_failed',
      details: { reason: 'dns down', target: 'tinybird' }
    })
  })
})

describe('observability: log ring + labels', () => {
  const NOW = new Date('2026-07-25T10:30:00.000Z')

  function entry(n: number) {
    return {
      timestamp: `t${n}`,
      event: `e${n}`,
      source: 'browser',
      jurisdiction: 'EU',
      consent: 'NONE',
      processingTime: n,
      status: 'PROCESSED'
    }
  }

  it('bounds each hourly bucket to 60 entries, dropping the oldest', async () => {
    const host = createMockHostRuntime()
    for (let i = 0; i < 61; i += 1) {
      await appendRequestLog(host.kv, entry(i), NOW)
    }
    const raw = await host.kv.get(logKeyForHour(NOW))
    const list = JSON.parse(raw!) as { event: string }[]
    expect(list).toHaveLength(60)
    expect(list[0]!.event).toBe('e1')
    expect(list[59]!.event).toBe('e60')
  })

  it('readRecentLogs merges the freshest 3 hourly buckets newest-first and honors the limit', async () => {
    const host = createMockHostRuntime()
    const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000)
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000)
    await appendRequestLog(host.kv, entry(1), hourAgo)
    await appendRequestLog(host.kv, entry(2), NOW)
    await appendRequestLog(host.kv, entry(3), NOW)
    // A bucket 3 hours back is OUTSIDE the read window (current + previous 2).
    await appendRequestLog(host.kv, entry(9), threeHoursAgo)

    const logs = await readRecentLogs(host.kv, NOW)
    expect(logs.map((l) => l.event)).toEqual(['e3', 'e2', 'e1'])

    const limited = await readRecentLogs(host.kv, NOW, 2)
    expect(limited.map((l) => l.event)).toEqual(['e3', 'e2'])
  })

  it('consentLogLabel covers every branch', () => {
    expect(consentLogLabel({})).toBe('NONE')
    expect(
      consentLogLabel({
        consentGate: {
          mode: 'ENFORCEMENT',
          mechanism: 'opt-in',
          tokenDecision: 'granted',
          effectiveDecision: 'declined',
          gpcApplied: true,
          wouldAllow: false,
          allowDestinations: false
        }
      })
    ).toBe('GPC_DECLINED')
    expect(
      consentLogLabel({
        consentGate: {
          mode: 'ENFORCEMENT',
          mechanism: 'opt-in',
          tokenDecision: 'granted',
          effectiveDecision: 'granted',
          gpcApplied: false,
          wouldAllow: true,
          allowDestinations: true
        }
      })
    ).toBe('GRANTED')
    expect(
      consentLogLabel({
        consentGate: {
          mode: 'SHADOW',
          mechanism: 'opt-in',
          tokenDecision: null,
          effectiveDecision: null,
          gpcApplied: false,
          wouldAllow: false,
          allowDestinations: true
        }
      })
    ).toBe('SHADOW_NONE')
    expect(
      consentLogLabel({
        consentGate: {
          mode: 'ENFORCEMENT',
          mechanism: 'opt-in',
          tokenDecision: null,
          effectiveDecision: null,
          gpcApplied: false,
          wouldAllow: false,
          allowDestinations: false
        }
      })
    ).toBe('NONE')
  })

  it('ingestLogStatus: bot beats gate beats processed', () => {
    expect(ingestLogStatus({ botDetection: { isBot: true, reasons: [] } })).toBe('BOT_FILTERED')
    expect(
      ingestLogStatus({
        consentGate: {
          mode: 'ENFORCEMENT',
          mechanism: 'opt-in',
          tokenDecision: null,
          effectiveDecision: null,
          gpcApplied: false,
          wouldAllow: false,
          allowDestinations: false
        }
      })
    ).toBe('BLOCKED_ENFORCEMENT')
    expect(ingestLogStatus({})).toBe('PROCESSED')
  })

  it('recordIngestObservability: sampled counter, clamped rounded processing time, defaulted labels', async () => {
    const host = createMockHostRuntime()
    // Pre-seed the day counter to the sampling threshold; an unlucky roll must
    // SKIP the increment because ingest counting is sampled (P3.2).
    const dayKey = `attestrack:obs:events:${NOW.toISOString().slice(0, 10)}`
    await host.kv.put(dayKey, JSON.stringify({ count: 5000 }))
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    await recordIngestObservability(host, { host, request: new Request('https://x/') } as never, -5.4, NOW)
    expect(JSON.parse((await host.kv.get(dayKey))!)).toEqual({ count: 5000 })

    const logs = JSON.parse((await host.kv.get(logKeyForHour(NOW)))!) as Record<string, unknown>[]
    expect(logs[0]).toEqual({
      timestamp: NOW.toISOString(),
      event: 'unknown',
      source: 'browser',
      jurisdiction: 'UNKNOWN',
      consent: 'NONE',
      processingTime: 0,
      status: 'PROCESSED'
    })
  })
})

describe('observability: destination rows + dashboard', () => {
  const NOW = new Date('2026-07-25T10:30:00.000Z')

  async function seedStats(host: ReturnType<typeof createMockHostRuntime>, id: string, stats: Record<string, unknown>) {
    await host.kv.put(`${KV_KEY_OBS_DELIVERY_PREFIX}${id}`, JSON.stringify(stats))
  }

  function chRow(rows: Awaited<ReturnType<typeof buildDestinationRows>>) {
    return rows.find((r) => r.id === 'clickhouse')!
  }

  it('secrets must ALL be present and non-empty; disabled strategies read as inactive', async () => {
    const partial = createMockHostRuntime({ secrets: { META_ACCESS_TOKEN: 't' } })
    const rows = await buildDestinationRows(partial, null)
    const meta = rows.find((r) => r.id === 'meta-capi')!
    expect(meta.status).toBe('inactive')
    expect(meta.auth).toBe('not configured')

    const emptyString = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: '' } })
    expect(chRow(await buildDestinationRows(emptyString, null)).auth).toBe('not configured')

    const disabled = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    const disabledRow = chRow(await buildDestinationRows(disabled, []))
    expect(disabledRow.status).toBe('inactive')
    expect(disabledRow.auth).toBe('configured (strategy disabled)')
  })

  it('no recorded outcomes → no_data with a zero rate', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    const row = chRow(await buildDestinationRows(host, null))
    expect(row).toEqual({
      id: 'clickhouse',
      name: 'ClickHouse HTTP sink',
      status: 'no_data',
      successRate: 0,
      lastEvent: null,
      auth: 'configured',
      eventsToday: 0
    })
  })

  it('success rate prefers the same-day window and falls back to lifetime', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    // Lifetime 3 ok / 1 error, nothing today → 75% from lifetime.
    await seedStats(host, 'clickhouse', {
      ok: 3, error: 1, okToday: 0, errorToday: 0, day: '2026-07-24', lastOkAt: '2026-07-24T10:00:00Z'
    })
    expect(chRow(await buildDestinationRows(host, null)).successRate).toBe(75)

    // Today 1 ok / 3 error → 25% from today's window, not lifetime.
    await seedStats(host, 'clickhouse', {
      ok: 100, error: 0, okToday: 1, errorToday: 3, day: '2026-07-25', lastOkAt: '2026-07-25T10:00:00Z'
    })
    expect(chRow(await buildDestinationRows(host, null)).successRate).toBe(25)
  })

  it('degradation: most-recent-failure and sub-90 today-rate boundaries', async () => {
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    // lastErrorAt === lastOkAt counts as degraded (>=, not >).
    await seedStats(host, 'clickhouse', {
      ok: 1, error: 1, okToday: 0, errorToday: 0, day: '2026-07-24',
      lastOkAt: '2026-07-25T10:00:00Z', lastErrorAt: '2026-07-25T10:00:00Z'
    })
    expect(chRow(await buildDestinationRows(host, null)).status).toBe('degraded')

    // Recovered (ok after error) with today-rate exactly 90 → healthy (< 90, not <=).
    await seedStats(host, 'clickhouse', {
      ok: 10, error: 1, okToday: 9, errorToday: 1, day: '2026-07-25',
      lastOkAt: '2026-07-25T11:00:00Z', lastErrorAt: '2026-07-25T10:00:00Z'
    })
    const row = chRow(await buildDestinationRows(host, null))
    expect(row.successRate).toBe(90)
    expect(row.status).toBe('healthy')

    // Recovered but today's rate below 90 → degraded.
    await seedStats(host, 'clickhouse', {
      ok: 10, error: 3, okToday: 7, errorToday: 3, day: '2026-07-25',
      lastOkAt: '2026-07-25T11:00:00Z', lastErrorAt: '2026-07-25T10:00:00Z'
    })
    expect(chRow(await buildDestinationRows(host, null)).status).toBe('degraded')

    // Errors only in the LIFETIME window with a recovered lastOk and no
    // attempts today → healthy (the today-rate branch requires attempts today).
    await seedStats(host, 'clickhouse', {
      ok: 1, error: 3, okToday: 0, errorToday: 0, day: '2026-07-24',
      lastOkAt: '2026-07-25T11:00:00Z', lastErrorAt: '2026-07-25T10:00:00Z'
    })
    expect(chRow(await buildDestinationRows(host, null)).status).toBe('healthy')
  })

  it('dashboard summaries: inactive / singular healthy / plural healthy / degraded names', async () => {
    const cfg = { ...defaultSiteConfig, driftDetection: { ...defaultSiteConfig.driftDetection, enabled: false } }
    const none = createMockHostRuntime({ secrets: {} })
    const inactive = await computeDashboardMetrics(none, cfg, null, NOW)
    expect(inactive.strategyStatus).toBe('inactive')
    expect(inactive.strategySummary).toBe('No destination or analytics endpoints configured')
    expect(inactive.driftAlertCount).toBe(0)
    expect(inactive.shadowModeLabel).toBe(
      'Shadow — destinations run; the enforcement decision is recorded only'
    )

    const one = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    const single = await computeDashboardMetrics(one, cfg, null, NOW)
    expect(single.strategyStatus).toBe('all_healthy')
    expect(single.strategySummary).toBe('1 configured endpoint; no recent delivery errors')

    const two = createMockHostRuntime({
      secrets: { CLICKHOUSE_HTTP_URL: 'http://ch', TINYBIRD_TOKEN: 'tok' }
    })
    const plural = await computeDashboardMetrics(two, cfg, null, NOW)
    expect(plural.strategySummary).toBe('2 configured endpoints; no recent delivery errors')

    await seedStats(two, 'clickhouse', {
      ok: 0, error: 5, okToday: 0, errorToday: 5, day: '2026-07-25', lastErrorAt: '2026-07-25T10:00:00Z'
    })
    const degraded = await computeDashboardMetrics(two, cfg, null, NOW)
    expect(degraded.strategyStatus).toBe('degraded')
    expect(degraded.strategySummary).toBe('ClickHouse HTTP sink reporting delivery errors')

    const enforcing = await computeDashboardMetrics(none, { ...cfg, mode: 'ENFORCEMENT' }, null, NOW)
    expect(enforcing.shadowModeLabel).toBe(
      'Enforcement — the consent gate blocks non-consented destinations'
    )
  })

  it('readDriftMismatch: every field must be a string', async () => {
    const host = createMockHostRuntime()
    expect(await readDriftMismatch(host.kv)).toBeNull()
    await host.kv.put(KV_KEY_DRIFT_MISMATCH, '{not json')
    expect(await readDriftMismatch(host.kv)).toBeNull()
    for (const partial of [
      '{}',
      '{"at":"t","expected":"e"}',
      '{"at":"t","current":"c"}',
      '{"expected":"e","current":"c"}',
      '{"at":1,"expected":"e","current":"c"}'
    ]) {
      await host.kv.put(KV_KEY_DRIFT_MISMATCH, partial)
      expect(await readDriftMismatch(host.kv)).toBeNull()
    }
    await host.kv.put(KV_KEY_DRIFT_MISMATCH, '{"at":"t","expected":"e","current":"c"}')
    expect(await readDriftMismatch(host.kv)).toEqual({ at: 't', expected: 'e', current: 'c' })
  })

  it('computeSignalRecovery reports the de-scoped shape with the real bot counter', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(
      `attestrack:obs:bots:${NOW.toISOString().slice(0, 10)}`,
      JSON.stringify({ count: 7 })
    )
    const payload = await computeSignalRecovery(host, NOW)
    expect(payload.measured).toBe(false)
    expect(payload.reason).toBe('requires_beacon')
    expect(payload.botRequestsFiltered).toBe(7)
    expect(payload.message).toContain('requires a client beacon')
  })
})
