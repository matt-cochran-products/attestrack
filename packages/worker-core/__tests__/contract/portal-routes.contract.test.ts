/**
 * P6.4 — portal API route contract sweep: config/strategy/alert routes, the
 * ADR-010 `requires_attestrue` 403 surface, and method/unknown-route handling.
 * Complements portal-auth / curated-analytics / saved-queries-pin contracts.
 */
import { describe, expect, it } from 'vitest'
import { createMockHostRuntime } from '@attestrack/sdk'
import {
  KV_KEY_ENABLED_STRATEGIES,
  KV_KEY_PORTAL_SITE_CONFIG
} from '@attestrack/types'
import { handlePortalRequest, PORTAL_API_PREFIX } from '../../src/portal.js'

const BASE = `https://t.example.com${PORTAL_API_PREFIX}`

function makeHost() {
  return createMockHostRuntime({ secrets: {} })
}

async function get(host: ReturnType<typeof makeHost>, sub: string) {
  return handlePortalRequest(new Request(`${BASE}${sub}`), host)
}

async function post(host: ReturnType<typeof makeHost>, sub: string, body: unknown) {
  return handlePortalRequest(
    new Request(`${BASE}${sub}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    host
  )
}

describe('portal GET routes', () => {
  it('ignores non-portal paths (returns null)', async () => {
    const res = await handlePortalRequest(new Request('https://t.example.com/health'), makeHost())
    expect(res).toBeNull()
  })

  it('serves site config from KV with defaults for missing fields', async () => {
    const host = makeHost()
    await host.kv.put(KV_KEY_PORTAL_SITE_CONFIG, JSON.stringify({ siteId: 'p6', domain: 'p6.example' }))
    const res = await get(host, '/site-config')
    expect(res?.status).toBe(200)
    const cfg = (await res!.json()) as { siteId: string; mode: string }
    expect(cfg.siteId).toBe('p6')
    expect(cfg.mode).toBe('SHADOW')
  })

  it('serves default strategies JSON when KV is empty and parses stored JSON otherwise', async () => {
    const host = makeHost()
    const empty = await get(host, '/strategies')
    expect(await empty!.json()).toEqual({ builtin: [], proofLayer: [] })
    await host.kv.put(
      'attestrack:portal:strategies',
      JSON.stringify({ builtin: [{ id: 'consent', status: 'active' }], proofLayer: [] })
    )
    const filled = await get(host, '/strategies')
    const parsed = (await filled!.json()) as { builtin: { id: string }[] }
    expect(parsed.builtin[0]!.id).toBe('consent')
  })

  it('serves operator alert rules and tolerates malformed KV JSON', async () => {
    const host = makeHost()
    await host.kv.put('attestrack:portal:alert_rules', '{corrupt')
    const res = await get(host, '/alert-rules')
    expect(await res!.json()).toEqual([])
    await host.kv.put(
      'attestrack:portal:alert_rules',
      JSON.stringify([{ destination: 'clickhouse', condition: 'errors > 0', email: '', active: true }])
    )
    const filled = (await (await get(host, '/alert-rules'))!.json()) as unknown[]
    expect(filled).toHaveLength(1)
  })

  it('signal timeline is an empty series (never invented points — P3.3)', async () => {
    const res = await get(makeHost(), '/signal-recovery/timeline')
    expect(await res!.json()).toEqual([])
  })

  it('curated metadata lists chart descriptors + warehouse flag', async () => {
    const res = await get(makeHost(), '/analytics/curated')
    const body = (await res!.json()) as { charts: unknown[]; warehouseConfigured: boolean }
    expect(Array.isArray(body.charts)).toBe(true)
    expect(body.charts.length).toBeGreaterThan(0)
    expect(body.warehouseConfigured).toBe(false)
  })

  it('licensed-portal GET surfaces answer 403 requires_attestrue (ADR-010)', async () => {
    for (const sub of ['/policy', '/policy-versions', '/banner', '/banner/history']) {
      const res = await get(makeHost(), sub)
      expect(res?.status).toBe(403)
      expect(((await res!.json()) as { error: string }).error).toBe('requires_attestrue')
    }
  })
})

describe('portal POST routes', () => {
  it('rejects invalid JSON bodies with 400', async () => {
    const res = await handlePortalRequest(
      new Request(`${BASE}/strategies/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope'
      }),
      makeHost()
    )
    expect(res?.status).toBe(400)
  })

  it('licensed-portal POST surfaces answer 403 requires_attestrue', async () => {
    for (const sub of ['/site-config/mode', '/policy-versions', '/banner']) {
      const res = await post(makeHost(), sub, {})
      expect(res?.status).toBe(403)
      expect(((await res!.json()) as { error: string }).error).toBe('requires_attestrue')
    }
  })

  it('writes trusted domains (valid) and rejects non-string arrays', async () => {
    const host = makeHost()
    const ok = await post(host, '/site-config/trusted-domains', { domains: ['cdn.example.com'] })
    expect(ok?.status).toBe(200)
    const stored = JSON.parse((await host.kv.get(KV_KEY_PORTAL_SITE_CONFIG)) ?? '{}') as {
      trustedDomains: string[]
    }
    expect(stored.trustedDomains).toEqual(['cdn.example.com'])
    const bad = await post(host, '/site-config/trusted-domains', { domains: [1, 2] })
    expect(bad?.status).toBe(400)
  })

  it('reports warehouse status from configured secrets', async () => {
    const unconfigured = await post(makeHost(), '/analytics/warehouse-status', {})
    expect((await unconfigured!.json()) as object).toMatchObject({ configured: false })
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'https://ch.example' } })
    const configured = await post(host, '/analytics/warehouse-status', {})
    expect((await configured!.json()) as object).toMatchObject({ configured: true })
  })

  it('toggles a builtin strategy status in KV and validates the body', async () => {
    const host = makeHost()
    await host.kv.put(
      'attestrack:portal:strategies',
      JSON.stringify({ builtin: [{ id: 'clickhouse', status: 'active' }], proofLayer: [] })
    )
    const ok = await post(host, '/strategies/toggle', { id: 'clickhouse', enabled: false })
    expect(ok?.status).toBe(200)
    const stored = JSON.parse((await host.kv.get('attestrack:portal:strategies')) ?? '{}') as {
      builtin: { id: string; status: string }[]
    }
    expect(stored.builtin[0]!.status).toBe('inactive')
    const bad = await post(host, '/strategies/toggle', { id: 42 })
    expect(bad?.status).toBe(400)
  })

  it('unknown POST routes are 404; non-GET/POST methods are 405', async () => {
    const notFound = await post(makeHost(), '/nope', {})
    expect(notFound?.status).toBe(404)
    const put = await handlePortalRequest(
      new Request(`${BASE}/site-config`, { method: 'PUT' }),
      makeHost()
    )
    expect(put?.status).toBe(405)
  })
})

describe('enabled-strategies KV filter input (P6.4 glue)', () => {
  it('dashboard tolerates malformed enabled-strategies KV', async () => {
    const host = makeHost()
    await host.kv.put(KV_KEY_ENABLED_STRATEGIES, '{malformed')
    const res = await get(host, '/dashboard')
    expect(res?.status).toBe(200)
  })
})
