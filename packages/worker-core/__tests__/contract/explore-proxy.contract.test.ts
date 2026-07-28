import { describe, expect, it, vi, afterEach } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { noopStrategyLoader, createMockHostRuntime } from '@attestrack/sdk'

/** INV-B-14 / INV-B-15 — Explore gate + warehouse contract. */
describe('portal explore/query contract', () => {
  const queryUrl = 'https://x/__attestrack__/portal/v1/explore/query'
  const savedListUrl = 'https://x/__attestrack__/portal/v1/explore/saved-queries'

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

  it('rejects empty SQL with invalid_sql + details.code', async () => {
    const res = await handler()(
      new Request(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: '' })
      })
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: string
      reason?: string
      details?: { code?: string }
    }
    expect(json.error).toBe('invalid_sql')
    expect(json.details?.code).toBe('explore_sql_empty')
    expect(json.reason).toMatch(/empty/i)
  })

  it('rejects query without FROM (allowlist)', async () => {
    const res = await handler()(
      new Request(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' })
      })
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { details?: { code?: string } }
    expect(json.details?.code).toBe('explore_sql_no_from')
  })

  it('rejects non-allowlisted table (INV-B-15)', async () => {
    const res = await handler()(
      new Request(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT * FROM secret_table' })
      })
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { details?: { code?: string } }
    expect(json.details?.code).toBe('explore_sql_table_not_allowed')
  })

  it('returns explore_warehouse_not_configured when no warehouse secrets', async () => {
    const res = await handler()(
      new Request(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1 AS x FROM events LIMIT 5' })
      })
    )
    expect(res.status).toBe(503)
    const json = (await res.json()) as { error: string; details?: { code?: string } }
    expect(json.error).toBe('explore_warehouse_not_configured')
    expect(json.details?.code).toBe('explore_warehouse_not_configured')
  })

  it('executes ClickHouse when CLICKHOUSE_QUERY_URL is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ meta: [{ name: 'x', type: 'Int32' }], data: [{ x: 1 }] }), {
          status: 200
        })
      )
    )
    const host = createMockHostRuntime({
      secrets: {
        CLICKHOUSE_QUERY_URL: 'https://ch.example:8443',
        CLICKHOUSE_USER: 'u',
        CLICKHOUSE_PASSWORD: 'p'
      }
    })
    const res = await handler(host)(
      new Request(queryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT x FROM events LIMIT 10' })
      })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      columns: string[]
      rows: { x: number }[]
      rowCount: number
    }
    expect(json.columns).toContain('x')
    expect(json.rows[0]?.x).toBe(1)
    expect(json.rowCount).toBe(1)
    expect(vi.mocked(fetch)).toHaveBeenCalled()
  })

  it('lists and mutates saved queries in KV (INV-B-17)', async () => {
    const host = createMockHostRuntime()
    const h = handler(host)
    const list0 = await h(new Request(savedListUrl, { method: 'GET' }))
    expect(list0.status).toBe(200)
    expect(await list0.json()).toEqual([])

    const save = await h(
      new Request(savedListUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Q1', sql: 'SELECT 1 AS n FROM events' })
      })
    )
    expect(save.status).toBe(200)
    const saved = (await save.json()) as { query: { id: string } }
    const id = saved.query.id

    const list1 = await h(new Request(savedListUrl, { method: 'GET' }))
    const arr = (await list1.json()) as { id: string }[]
    expect(arr).toHaveLength(1)

    const del = await h(
      new Request('https://x/__attestrack__/portal/v1/explore/saved-queries/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      })
    )
    expect(del.status).toBe(200)

    const list2 = await h(new Request(savedListUrl, { method: 'GET' }))
    expect(await list2.json()).toEqual([])
  })
})
