import { describe, expect, it } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { noopStrategyLoader, createMockHostRuntime } from '@attestrack/sdk'
import { KV_KEY_PORTAL_SAVED_QUERIES } from '@attestrack/types'

/**
 * P4.4 — Saved queries: Zod-validated KV shape (INV-B-17) + per-user pinning
 * (EXP.10) keyed on the `Cf-Access-Authenticated-User-Email` header.
 */
describe('portal explore/saved-queries pinning contract (P4.4 / EXP.10)', () => {
  const listUrl = 'https://x/__attestrack__/portal/v1/explore/saved-queries'
  const pinUrl = 'https://x/__attestrack__/portal/v1/explore/saved-queries/pin'

  function handler(host = createMockHostRuntime()) {
    return createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
  }

  function jsonReq(url: string, body: unknown, email?: string): Request {
    return new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(email ? { 'Cf-Access-Authenticated-User-Email': email } : {})
      },
      body: JSON.stringify(body)
    })
  }

  async function saveOne(h: ReturnType<typeof handler>): Promise<string> {
    const res = await h(
      jsonReq(listUrl, { name: 'Daily events', sql: 'SELECT count() AS c FROM events' })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { query: { id: string; pinned: boolean } }
    expect(json.query.pinned).toBe(false)
    return json.query.id
  }

  it('pins per user: pin is visible to its owner only (personal, EXP.10)', async () => {
    const host = createMockHostRuntime()
    const h = handler(host)
    const id = await saveOne(h)

    const pin = await h(
      jsonReq(
        pinUrl,
        { id, pinned: true, chart: { chartType: 'line', xColumn: 'day', yColumn: 'c' } },
        'analyst@example.com'
      )
    )
    expect(pin.status).toBe(200)
    const pinned = (await pin.json()) as {
      query: { pinned: boolean; pinnedChart?: { chartType: string } }
    }
    expect(pinned.query.pinned).toBe(true)
    expect(pinned.query.pinnedChart?.chartType).toBe('line')

    // Owner sees the pin…
    const mine = await h(
      new Request(listUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Authenticated-User-Email': 'Analyst@Example.com' } // case-insensitive
      })
    )
    const mineJson = (await mine.json()) as { pinned: boolean; pinnedChart?: unknown }[]
    expect(mineJson[0]?.pinned).toBe(true)
    expect(mineJson[0]?.pinnedChart).toBeDefined()

    // …a different user does not (and never sees other users' pin records).
    const theirs = await h(
      new Request(listUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Authenticated-User-Email': 'other@example.com' }
      })
    )
    const theirsJson = (await theirs.json()) as Record<string, unknown>[]
    expect(theirsJson[0]?.pinned).toBe(false)
    expect(theirsJson[0]?.pinnedChart).toBeUndefined()
    expect(theirsJson[0]?.pins).toBeUndefined()
  })

  it('unpins only the requesting user', async () => {
    const host = createMockHostRuntime()
    const h = handler(host)
    const id = await saveOne(h)
    await h(jsonReq(pinUrl, { id, pinned: true, chart: { chartType: 'bar' } }, 'a@x.com'))
    await h(jsonReq(pinUrl, { id, pinned: true, chart: { chartType: 'pie' } }, 'b@x.com'))
    await h(jsonReq(pinUrl, { id, pinned: false }, 'a@x.com'))

    const aList = (await (
      await h(
        new Request(listUrl, {
          method: 'GET',
          headers: { 'Cf-Access-Authenticated-User-Email': 'a@x.com' }
        })
      )
    ).json()) as { pinned: boolean }[]
    expect(aList[0]?.pinned).toBe(false)

    const bList = (await (
      await h(
        new Request(listUrl, {
          method: 'GET',
          headers: { 'Cf-Access-Authenticated-User-Email': 'b@x.com' }
        })
      )
    ).json()) as { pinned: boolean; pinnedChart?: { chartType: string } }[]
    expect(bList[0]?.pinned).toBe(true)
    expect(bList[0]?.pinnedChart?.chartType).toBe('pie')
  })

  it('missing Access header falls back to a single shared anonymous identity', async () => {
    const host = createMockHostRuntime()
    const h = handler(host)
    const id = await saveOne(h)
    await h(jsonReq(pinUrl, { id, pinned: true, chart: { chartType: 'area' } }))
    const anon = (await (await h(new Request(listUrl, { method: 'GET' }))).json()) as {
      pinned: boolean
    }[]
    expect(anon[0]?.pinned).toBe(true)
  })

  it('rejects invalid pin bodies and unknown ids', async () => {
    const host = createMockHostRuntime()
    const h = handler(host)
    const id = await saveOne(h)

    const badBody = await h(jsonReq(pinUrl, { id }, 'a@x.com'))
    expect(badBody.status).toBe(400)
    expect(((await badBody.json()) as { details?: { code?: string } }).details?.code).toBe(
      'saved_query_pin_body_invalid'
    )

    const badChart = await h(
      jsonReq(pinUrl, { id, pinned: true, chart: { chartType: 'sunburst' } }, 'a@x.com')
    )
    expect(badChart.status).toBe(400)
    expect(((await badChart.json()) as { details?: { code?: string } }).details?.code).toBe(
      'saved_query_chart_invalid'
    )

    const missing = await h(jsonReq(pinUrl, { id: 'nope', pinned: true }, 'a@x.com'))
    expect(missing.status).toBe(404)
  })

  it('caps pins at the Zod shape bound (50) by dropping the oldest — the entry never fails read-side validation', async () => {
    const host = createMockHostRuntime()
    const h = handler(host)
    const id = await saveOne(h)
    for (let i = 0; i < 52; i += 1) {
      const res = await h(
        jsonReq(pinUrl, { id, pinned: true, chart: { chartType: 'bar' } }, `u${i}@x.com`)
      )
      expect(res.status).toBe(200)
    }
    // The most recent pinner still sees their pin (entry survived validation)…
    const latest = (await (
      await h(
        new Request(listUrl, {
          method: 'GET',
          headers: { 'Cf-Access-Authenticated-User-Email': 'u51@x.com' }
        })
      )
    ).json()) as { pinned: boolean }[]
    expect(latest).toHaveLength(1)
    expect(latest[0]?.pinned).toBe(true)
    // …while the oldest pin was dropped by the cap.
    const oldest = (await (
      await h(
        new Request(listUrl, {
          method: 'GET',
          headers: { 'Cf-Access-Authenticated-User-Email': 'u0@x.com' }
        })
      )
    ).json()) as { pinned: boolean }[]
    expect(oldest[0]?.pinned).toBe(false)
  })

  it('drops corrupt KV entries via the Zod shape instead of serving them', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(
      KV_KEY_PORTAL_SAVED_QUERIES,
      JSON.stringify([
        { id: 'ok1', name: 'Valid', sql: 'SELECT 1 FROM events', updatedAt: 'now' },
        { id: '', name: '', sql: '', updatedAt: '' },
        'garbage',
        { id: 'ok1-evil', name: 'x', sql: 'SELECT 1 FROM events', updatedAt: 'now', extra: 1 }
      ])
    )
    const res = await handler(host)(new Request(listUrl, { method: 'GET' }))
    const list = (await res.json()) as { id: string }[]
    expect(list.map((q) => q.id)).toEqual(['ok1'])
  })
})
