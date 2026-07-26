/**
 * P6.4 — Explore warehouse executor (EXP.1 path): ClickHouse + Tinybird HTTP
 * behavior with a stubbed fetch. The SQL reaching this module has ALREADY
 * passed the gate (validateAndNormalizeExploreSql) — these tests pin the
 * transport contract: URLs, auth headers, FORMAT JSON parsing, error mapping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime } from '@attestrack/sdk'
import {
  executeExploreSql,
  isExploreWarehouseConfigured
} from '../src/explore-warehouse.js'

const SQL = 'SELECT eventName FROM events LIMIT 10'

function chJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    meta: [{ name: 'eventName' }],
    data: [{ eventName: 'page_view' }],
    rows: 1,
    ...overrides
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isExploreWarehouseConfigured', () => {
  it('false with no credentials; true with CLICKHOUSE_QUERY_URL or TINYBIRD_TOKEN', () => {
    expect(isExploreWarehouseConfigured(createMockHostRuntime())).toBe(false)
    expect(
      isExploreWarehouseConfigured(
        createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example' } })
      )
    ).toBe(true)
    expect(
      isExploreWarehouseConfigured(createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 't' } }))
    ).toBe(true)
  })

  it('derives a query base from CLICKHOUSE_HTTP_URL origin, rejecting invalid URLs', () => {
    expect(
      isExploreWarehouseConfigured(
        createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'https://ch.example:8443/ingest' } })
      )
    ).toBe(true)
    expect(
      isExploreWarehouseConfigured(
        createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'not a url' } })
      )
    ).toBe(false)
  })
})

describe('executeExploreSql — unconfigured', () => {
  it('returns 503 explore_warehouse_not_configured without any fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await executeExploreSql(createMockHostRuntime(), SQL)
    expect(res).toMatchObject({ ok: false, status: 503, error: 'explore_warehouse_not_configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('executeExploreSql — ClickHouse', () => {
  function host(secrets: Record<string, string> = {}) {
    return createMockHostRuntime({
      secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example', ...secrets }
    })
  }

  it('POSTs the normalized SQL with FORMAT JSON and basic auth when credentials are set', async () => {
    const fetchSpy = vi.fn(async () => new Response(chJson(), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const res = await executeExploreSql(
      host({ CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p' }),
      SQL
    )
    expect(res).toMatchObject({ ok: true, columns: ['eventName'], rowCount: 1, truncated: false })
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ch.example/')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain(SQL)
    expect(String(init.body)).toContain('FORMAT JSON')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('u:p')}`)
  })

  it('omits Authorization without credentials', async () => {
    const fetchSpy = vi.fn(async () => new Response(chJson(), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await executeExploreSql(host(), SQL)
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('maps a ClickHouse exception body to 400 explore_warehouse_rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ exception: 'DB::Exception: boom' }), { status: 200 }))
    )
    const res = await executeExploreSql(host(), SQL)
    expect(res).toMatchObject({ ok: false, status: 400, error: 'explore_warehouse_rejected' })
  })

  it('maps non-JSON bodies to 502 explore_warehouse_bad_response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })))
    const res = await executeExploreSql(host(), SQL)
    expect(res).toMatchObject({ ok: false, status: 502, error: 'explore_warehouse_bad_response' })
  })

  it('maps upstream HTTP 400 to 400 and other failures to 502 explore_warehouse_http_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('syntax error', { status: 400 })))
    expect(await executeExploreSql(host(), SQL)).toMatchObject({
      ok: false,
      status: 400,
      error: 'explore_warehouse_http_error'
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    expect(await executeExploreSql(host(), SQL)).toMatchObject({
      ok: false,
      status: 502,
      error: 'explore_warehouse_http_error'
    })
  })

  it('maps network failures to 502 explore_warehouse_fetch_failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused')
      })
    )
    const res = await executeExploreSql(host(), SQL)
    expect(res).toMatchObject({ ok: false, status: 502, error: 'explore_warehouse_fetch_failed' })
    expect((res as { details: { target: string } }).details.target).toBe('clickhouse')
  })
})

describe('executeExploreSql — Tinybird', () => {
  function host(secrets: Record<string, string> = {}) {
    return createMockHostRuntime({ secrets: { TINYBIRD_TOKEN: 'tb-token', ...secrets } })
  }

  it('GETs /v0/sql with bearer auth against the default API root', async () => {
    const fetchSpy = vi.fn(async () => new Response(chJson(), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const res = await executeExploreSql(host(), SQL)
    expect(res).toMatchObject({ ok: true, rowCount: 1 })
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://api.tinybird.co/v0/sql?q=')
    expect(url).toContain(encodeURIComponent(SQL))
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tb-token')
  })

  it('honors TINYBIRD_API_URL and takes precedence over ClickHouse credentials', async () => {
    const fetchSpy = vi.fn(async () => new Response(chJson(), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await executeExploreSql(
      host({ TINYBIRD_API_URL: 'https://tb.example/', CLICKHOUSE_QUERY_URL: 'https://ch.example' }),
      SQL
    )
    const [url] = fetchSpy.mock.calls[0] as unknown as [string]
    expect(url.startsWith('https://tb.example/v0/sql')).toBe(true)
  })

  it('maps network failures to 502 with target tinybird', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('dns')
      })
    )
    const res = await executeExploreSql(host(), SQL)
    expect(res).toMatchObject({ ok: false, status: 502, error: 'explore_warehouse_fetch_failed' })
    expect((res as { details: { target: string } }).details.target).toBe('tinybird')
  })
})
