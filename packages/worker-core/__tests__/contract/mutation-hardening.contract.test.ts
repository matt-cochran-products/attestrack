import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMockHostRuntime,
  flushMockBackgroundTasks,
  noopStrategyLoader,
  createPrivacyConsentToken,
  verifyPrivacyConsentToken
} from '@attestrack/sdk'
import { defaultCommunityStrategies } from '@attestrack/strategies'
import {
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_CONSENT_EVENT_PREFIX,
  KV_KEY_PORTAL_ALERT_RULES,
  KV_KEY_PORTAL_SAVED_QUERIES,
  KV_KEY_PORTAL_SITE_CONFIG,
  KV_KEY_PORTAL_STRATEGIES,
  KV_KEY_POLICY_PRIVACY,
  KV_KEY_POLICY_TERMS,
  KV_KEY_DRIFT_MISMATCH
} from '@attestrack/types'
import { buildConsentCookie, createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  computeCuratedChart,
  isCuratedChartId,
  isValidCuratedDate,
  listCuratedChartDescriptors
} from '../../src/curated-analytics.js'
import { logKeyForHour } from '../../src/observability.js'
import { PORTAL_API_PREFIX } from '../../src/portal.js'

/**
 * Mutation-hardening suite (Stryker) — request-path contracts. Pins the exact
 * route/method bindings, response bodies (error codes, details, headers) and
 * cookie/curated-chart wire formats that broad status-only assertions let
 * mutants slip through.
 */

const SECRET = 'wc-hardening-secret-32-chars!!!!'

afterEach(() => vi.restoreAllMocks())

function makeHandler(secrets: Record<string, string> = { CONSENT_TOKEN_SECRET: SECRET }, strategies = false) {
  const host = createMockHostRuntime({ secrets })
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: strategies ? defaultCommunityStrategies('CONSENT_TOKEN_SECRET') : [],
    strategyLoader: noopStrategyLoader
  })
  return { host, handler }
}

describe('buildConsentCookie', () => {
  const config = { domain: 'example.com', state1TokenTTL: 86400 }

  it('emits the exact attribute list joined by "; " when the domain applies', () => {
    expect(buildConsentCookie('tok', config, 't.example.com')).toBe(
      'at_consent=tok; Domain=example.com; Path=/; Max-Age=86400; Secure; SameSite=Lax'
    )
    expect(buildConsentCookie('tok', config, 'example.com')).toBe(
      'at_consent=tok; Domain=example.com; Path=/; Max-Age=86400; Secure; SameSite=Lax'
    )
  })

  it('falls back to a host-only cookie when the worker host is outside the domain', () => {
    expect(buildConsentCookie('tok', config, 'other.net')).toBe(
      'at_consent=tok; Path=/; Max-Age=86400; Secure; SameSite=Lax'
    )
    // Suffix-but-not-subdomain must NOT apply the Domain attribute.
    expect(buildConsentCookie('tok', config, 'notexample.com')).toBe(
      'at_consent=tok; Path=/; Max-Age=86400; Secure; SameSite=Lax'
    )
  })

  it('never emits Domain= for an empty configured domain (even for dot-terminated hosts)', () => {
    expect(buildConsentCookie('tok', { ...config, domain: '' }, 'x.com.')).toBe(
      'at_consent=tok; Path=/; Max-Age=86400; Secure; SameSite=Lax'
    )
  })

  it('prefers cookieDomain over domain and URL-encodes the token', () => {
    expect(
      buildConsentCookie('a b', { ...config, cookieDomain: 'cookies.example.com' }, 'cookies.example.com')
    ).toBe('at_consent=a%20b; Domain=cookies.example.com; Path=/; Max-Age=86400; Secure; SameSite=Lax')
  })
})

describe('route/method binding', () => {
  it('GET /health returns literal ok with 200; other methods fall through to the pipeline', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://t.example.com/health'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    const post = await handler(new Request('https://t.example.com/health', { method: 'POST' }))
    expect(post.headers.get('content-type')).toContain('json')
    expect(((await post.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('GET /privacy and /terms serve KV text (or defaults) as no-store plain text', async () => {
    const { host, handler } = makeHandler()
    const def = await handler(new Request('https://t.example.com/privacy'))
    expect(await def.text()).toBe(
      'Privacy policy not configured. Set KV key attestrack:policy:privacy.\n'
    )
    expect(def.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(def.headers.get('cache-control')).toBe('no-store')

    await host.kv.put(KV_KEY_POLICY_PRIVACY, 'Our privacy policy.')
    await host.kv.put(KV_KEY_POLICY_TERMS, 'Our terms.')
    expect(await (await handler(new Request('https://t.example.com/privacy'))).text()).toBe(
      'Our privacy policy.'
    )
    const terms = await handler(new Request('https://t.example.com/terms'))
    expect(await terms.text()).toBe('Our terms.')
    expect(terms.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(terms.headers.get('cache-control')).toBe('no-store')

    // POST on policy routes is NOT the policy route (falls through to pipeline JSON).
    const post = await handler(new Request('https://t.example.com/terms', { method: 'POST' }))
    expect(post.headers.get('content-type')).toContain('json')
  })

  it('default terms text is served when only /terms is unset', async () => {
    const { handler } = makeHandler()
    expect(await (await handler(new Request('https://t.example.com/terms'))).text()).toBe(
      'Terms of use not configured. Set KV key attestrack:policy:terms.\n'
    )
  })

  it('GET /consent.js is public-cacheable JS with a wildcard ACAO; POST is not the script route', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://t.example.com/consent.js'))
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const post = await handler(new Request('https://t.example.com/consent.js', { method: 'POST' }))
    expect(post.headers.get('content-type')).toContain('json')
  })

  it('OPTIONS preflight applies ONLY to the three browser-facing routes', async () => {
    const { handler } = makeHandler()
    const other = await handler(new Request('https://t.example.com/health', { method: 'OPTIONS' }))
    // Not a preflight-managed route: falls through to the pipeline JSON response.
    expect(other.status).not.toBe(204)
    const preflight = await handler(
      new Request('https://t.example.com/t/event', { method: 'OPTIONS' })
    )
    expect(preflight.status).toBe(204)
  })

  it('consent commit and context are method-bound (GET commit / POST context fall through)', async () => {
    const { handler } = makeHandler({})
    // GET on the commit path must NOT hit the commit handler (which would 503
    // for the missing secret) — it falls through to the pipeline response.
    const getCommit = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit')
    )
    expect(getCommit.status).toBe(200)
    expect((await getCommit.json()) as object).toEqual({ ok: true, consentDecision: null })

    const postContext = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', { method: 'POST' })
    )
    const body = (await postContext.json()) as Record<string, unknown>
    expect(body.jurisdictionKey).toBeUndefined()
    expect(body.ok).toBe(true)
  })
})

describe('consent commit contract', () => {
  it('503 consent_secret_not_configured when the secret is absent', async () => {
    const { handler } = makeHandler({})
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        body: JSON.stringify({ siteId: 'local', decision: 'granted', policyHash: 'h' })
      })
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'consent_secret_not_configured' })
  })

  it('400 invalid_json / invalid_body with exact error envelopes', async () => {
    const { handler } = makeHandler()
    const badJson = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        body: '{nope'
      })
    )
    expect(badJson.status).toBe(400)
    expect(await badJson.json()).toEqual({ error: 'invalid_json' })

    const badBody = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        body: JSON.stringify({ siteId: 'local' })
      })
    )
    expect(badBody.status).toBe(400)
    const parsed = (await badBody.json()) as { error: string; details: unknown }
    expect(parsed.error).toBe('invalid_body')
    expect(parsed.details).toBeDefined()
  })

  it('mints a site-TTL token carrying jurisdictionHint + accepted IOA, sets cookie + no-store', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        body: JSON.stringify({
          siteId: 'local',
          decision: 'granted',
          policyHash: 'sha256:x',
          jurisdictionHint: 'EU',
          ioaAccepted: ['privacy_policy']
        })
      })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { token } = (await res.json()) as { token: string }
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toBe(buildConsentCookie(token, { domain: 'example.com', state1TokenTTL: 86400 }, 't.example.com'))
    const v = await verifyPrivacyConsentToken(SECRET, token)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload.jurisdictionHint).toBe('EU')
      expect(v.payload.ioa).toEqual(['privacy_policy'])
      expect(v.payload.expiresAt).toBeDefined()
    }
    // Without hint/IOA the payload must omit those keys entirely.
    const bare = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        body: JSON.stringify({ siteId: 'local', decision: 'granted', policyHash: 'sha256:x' })
      })
    )
    const bareToken = ((await bare.json()) as { token: string }).token
    const bv = await verifyPrivacyConsentToken(SECRET, bareToken)
    if (bv.ok) {
      expect('jurisdictionHint' in bv.payload).toBe(false)
      expect('ioa' in bv.payload).toBe(false)
    }
  })
})

describe('/t/event ingest contract', () => {
  it('rejects invalid JSON and invalid bodies with exact error envelopes', async () => {
    const { handler } = makeHandler()
    const badJson = await handler(
      new Request('https://t.example.com/t/event', { method: 'POST', body: '{nope' })
    )
    expect(badJson.status).toBe(400)
    expect(await badJson.json()).toEqual({ error: 'invalid_json' })

    const badBody = await handler(
      new Request('https://t.example.com/t/event', { method: 'POST', body: JSON.stringify({ v: 1 }) })
    )
    expect(badBody.status).toBe(400)
    const parsed = (await badBody.json()) as { error: string }
    expect(parsed.error).toBe('invalid_body')
  })

  it('accepts events, runs the pipeline in the background and logs a sane processing time', async () => {
    const { host, handler } = makeHandler()
    const res = await handler(
      new Request('https://t.example.com/t/event', {
        method: 'POST',
        body: JSON.stringify({
          v: 1,
          eventName: 'pv',
          siteId: 'local',
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(await res.json()).toEqual({ ok: true, accepted: true })
    expect(res.headers.get('cache-control')).toBe('no-store')
    await flushMockBackgroundTasks(host)
    const logs = JSON.parse((await host.kv.get(logKeyForHour(new Date())))!) as {
      event: string
      processingTime: number
    }[]
    expect(logs[0]!.event).toBe('pv')
    // Elapsed wall-clock ms — a mutant summing epochs lands in the 10^12 range.
    expect(logs[0]!.processingTime).toBeLessThan(60_000)
  })

  it('P2.5: the pipeline sees the site consentEventTtlSeconds from config (evidence-log TTL)', async () => {
    const { host, handler } = makeHandler({ CONSENT_TOKEN_SECRET: SECRET }, true)
    await host.kv.put(
      KV_KEY_PORTAL_SITE_CONFIG,
      JSON.stringify({ siteId: 'local', domain: 'example.com', consentEventTtlSeconds: 1234 })
    )
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 'local',
      decision: 'granted',
      policyHash: 'h'
    })
    const put = vi.spyOn(host.kv, 'put')
    const res = await handler(
      new Request('https://t.example.com/t/event', {
        method: 'POST',
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` },
        body: JSON.stringify({
          v: 1,
          eventName: 'pv',
          siteId: 'local',
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)
    const evidencePut = put.mock.calls.find((c) =>
      (c[0] as string).startsWith(KV_KEY_CONSENT_EVENT_PREFIX)
    )
    expect(evidencePut).toBeDefined()
    expect((evidencePut![2] as { expirationTtl?: number }).expirationTtl).toBe(1234)
  })
})

describe('consent context contract', () => {
  it('maps known policy documents to worker routes and drops unknown refs', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(
      KV_KEY_CONSENT_CONFIG,
      JSON.stringify({
        jurisdictions: {
          DEFAULT: {
            profile: 'standard',
            mechanism: 'opt-out',
            ioa_assertions: [{ id: 'a', text: 't' }],
            documents: ['privacy_policy', 'terms', 'cookie_notice', 'unknown_doc'],
            gpc_honor: false
          }
        }
      })
    )
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context')
    )
    const body = (await res.json()) as { policyRefs: Record<string, string>; mode: string }
    expect(body.policyRefs).toEqual({
      privacy_policy: '/privacy',
      terms: '/terms',
      cookie_notice: '/privacy'
    })
    expect(body.mode).toBe('SHADOW')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('portal API exact payloads', () => {
  function portalReq(sub: string, init?: RequestInit) {
    return new Request(`https://t.example.com${PORTAL_API_PREFIX}${sub}`, init)
  }
  function postJson(sub: string, body: unknown) {
    return portalReq(sub, { method: 'POST', body: JSON.stringify(body) })
  }

  it('unknown GET/POST subs return {error:not_found} 404; other methods 405', async () => {
    const { handler } = makeHandler()
    const get = await handler(portalReq('/nope'))
    expect(get.status).toBe(404)
    expect(await get.json()).toEqual({ error: 'not_found' })
    const post = await handler(postJson('/nope', {}))
    expect(post.status).toBe(404)
    expect(await post.json()).toEqual({ error: 'not_found' })
    const del = await handler(portalReq('/site-config', { method: 'DELETE' }))
    expect(del.status).toBe(405)
    expect(await del.json()).toEqual({ error: 'method_not_allowed' })
  })

  it('Attestrue-only routes return the exact upgrade envelope', async () => {
    const { handler } = makeHandler()
    for (const sub of ['/policy', '/policy-versions', '/banner', '/banner/history']) {
      const res = await handler(portalReq(sub))
      expect(res.status).toBe(403)
      const body = (await res.json()) as Record<string, string>
      expect(body.error).toBe('requires_attestrue')
      expect(body.handoff).toBe('https://attestrue.com/upgrade')
      expect(body.message).toContain('Attestrue extensions')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    for (const sub of ['/site-config/mode', '/policy-versions', '/banner']) {
      const res = await handler(postJson(sub, {}))
      expect(res.status).toBe(403)
      expect(((await res.json()) as { error: string }).error).toBe('requires_attestrue')
    }
  })

  it('/strategies falls back to the empty descriptor set on corrupt KV (no-store)', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(KV_KEY_PORTAL_STRATEGIES, '{not json')
    const res = await handler(portalReq('/strategies'))
    expect(await res.json()).toEqual({ builtin: [], proofLayer: [] })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('/alert-rules: non-array KV reads as [], drift prepends the synthetic rule', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(KV_KEY_PORTAL_ALERT_RULES, '{"not":"array"}')
    expect(await (await handler(portalReq('/alert-rules'))).json()).toEqual([])

    await host.kv.put(KV_KEY_PORTAL_ALERT_RULES, '[{"destination":"ops"}]')
    await host.kv.put(
      KV_KEY_DRIFT_MISMATCH,
      JSON.stringify({ at: '2026-07-25T00:00:00Z', expected: 'aa', current: 'bb' })
    )
    const rules = (await (await handler(portalReq('/alert-rules'))).json()) as Record<
      string,
      unknown
    >[]
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual({
      destination: 'consent-config',
      condition:
        'Drift detected at 2026-07-25T00:00:00Z: consent config fingerprint no longer matches the deploy-time expected value',
      email: '',
      active: true
    })
    expect(rules[1]).toEqual({ destination: 'ops' })
  })

  it('explore/query: non-string sql is gated as an EMPTY query (not coerced)', async () => {
    const { handler } = makeHandler()
    const res = await handler(postJson('/explore/query', { sql: 12345 }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details: { code: string } }
    expect(body.error).toBe('invalid_sql')
    expect(body.details.code).toBe('explore_sql_empty')
  })

  it('saved-queries POST: exact validation envelopes, cap, trim + Untitled fallback', async () => {
    const { host, handler } = makeHandler()
    const missing = await handler(postJson('/explore/saved-queries', { name: 'x' }))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({
      error: 'invalid_body',
      details: { code: 'saved_query_name_sql_required' }
    })

    const gated = await handler(
      postJson('/explore/saved-queries', { name: 'x', sql: 'DROP TABLE events' })
    )
    expect(gated.status).toBe(400)
    const gatedBody = (await gated.json()) as { error: string; reason: string }
    expect(gatedBody.error).toBe('invalid_sql')
    expect(typeof gatedBody.reason).toBe('string')

    const saved = await handler(
      postJson('/explore/saved-queries', {
        name: `  ${'n'.repeat(150)}  `,
        sql: '  SELECT eventName FROM events LIMIT 5  '
      })
    )
    const savedBody = (await saved.json()) as {
      success: boolean
      query: { name: string; sql: string; pinned: boolean }
    }
    expect(savedBody.success).toBe(true)
    expect(savedBody.query.name).toBe('n'.repeat(120))
    expect(savedBody.query.sql).toBe('SELECT eventName FROM events LIMIT 5')
    expect(savedBody.query.pinned).toBe(false)

    const untitled = await handler(
      postJson('/explore/saved-queries', { name: '   ', sql: 'SELECT eventName FROM events' })
    )
    expect(((await untitled.json()) as { query: { name: string } }).query.name).toBe('Untitled')

    // Cap: fill to 100 entries → the next save is rejected with the exact envelope.
    const full = Array.from({ length: 100 }, (_, i) => ({
      id: `q${i}`,
      name: `q${i}`,
      sql: 'SELECT 1',
      updatedAt: '2026-07-25T00:00:00.000Z'
    }))
    await host.kv.put(KV_KEY_PORTAL_SAVED_QUERIES, JSON.stringify(full))
    const capped = await handler(
      postJson('/explore/saved-queries', { name: 'x', sql: 'SELECT eventName FROM events' })
    )
    expect(capped.status).toBe(400)
    expect(await capped.json()).toEqual({
      error: 'saved_queries_limit',
      details: { code: 'saved_queries_limit', max: 100 }
    })
  })

  it('saved-queries remove: id validation envelope and actual removal', async () => {
    const { host, handler } = makeHandler()
    const bad = await handler(postJson('/explore/saved-queries/remove', {}))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({
      error: 'invalid_body',
      details: { code: 'saved_query_id_required' }
    })
    await host.kv.put(
      KV_KEY_PORTAL_SAVED_QUERIES,
      JSON.stringify([
        { id: 'keep', name: 'k', sql: 'SELECT 1', updatedAt: '2026-07-25T00:00:00.000Z' },
        { id: 'drop', name: 'd', sql: 'SELECT 1', updatedAt: '2026-07-25T00:00:00.000Z' }
      ])
    )
    const res = await handler(postJson('/explore/saved-queries/remove', { id: 'drop' }))
    expect(await res.json()).toEqual({ success: true })
    const left = JSON.parse((await host.kv.get(KV_KEY_PORTAL_SAVED_QUERIES))!) as { id: string }[]
    expect(left.map((q) => q.id)).toEqual(['keep'])
  })

  it('saved-queries pin: body/chart validation, 404, and the table-chart default', async () => {
    const { host, handler } = makeHandler()
    await host.kv.put(
      KV_KEY_PORTAL_SAVED_QUERIES,
      JSON.stringify([{ id: 'q1', name: 'q', sql: 'SELECT 1', updatedAt: '2026-07-25T00:00:00.000Z' }])
    )
    const badBody = await handler(postJson('/explore/saved-queries/pin', { id: 'q1' }))
    expect(badBody.status).toBe(400)
    expect(await badBody.json()).toEqual({
      error: 'invalid_body',
      details: { code: 'saved_query_pin_body_invalid' }
    })

    const missing = await handler(postJson('/explore/saved-queries/pin', { id: 'zz', pinned: true }))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: 'not_found',
      details: { code: 'saved_query_not_found' }
    })

    const badChart = await handler(
      postJson('/explore/saved-queries/pin', { id: 'q1', pinned: true, chart: { chartType: 'sunburst' } })
    )
    expect(badChart.status).toBe(400)
    const badChartBody = (await badChart.json()) as { error: string; details: { code: string } }
    expect(badChartBody.error).toBe('invalid_body')
    expect(badChartBody.details.code).toBe('saved_query_chart_invalid')

    const pinned = await handler(postJson('/explore/saved-queries/pin', { id: 'q1', pinned: true }))
    const pinnedBody = (await pinned.json()) as {
      success: boolean
      query: { pinned: boolean; pinnedChart?: { chartType: string } }
    }
    expect(pinnedBody.query.pinned).toBe(true)
    expect(pinnedBody.query.pinnedChart).toEqual({ chartType: 'table' })
  })

  it('site-config/trusted-domains: invalid_domains envelope and persisted write', async () => {
    const { host, handler } = makeHandler()
    const bad = await handler(postJson('/site-config/trusted-domains', { domains: ['x', 1] }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_domains' })
    const ok = await handler(postJson('/site-config/trusted-domains', { domains: ['app.example.com'] }))
    expect(await ok.json()).toEqual({ success: true })
    const cfg = JSON.parse((await host.kv.get(KV_KEY_PORTAL_SITE_CONFIG))!) as {
      trustedDomains: string[]
    }
    expect(cfg.trustedDomains).toEqual(['app.example.com'])
  })

  it('strategies/toggle: validates body, tolerates corrupt KV, flips only the target row', async () => {
    const { host, handler } = makeHandler()
    const bad = await handler(postJson('/strategies/toggle', { id: 'x' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_body' })

    await host.kv.put(KV_KEY_PORTAL_STRATEGIES, '{not json')
    await handler(postJson('/strategies/toggle', { id: 'x', enabled: true }))
    expect(JSON.parse((await host.kv.get(KV_KEY_PORTAL_STRATEGIES))!)).toEqual({ builtin: [] })

    await host.kv.put(
      KV_KEY_PORTAL_STRATEGIES,
      JSON.stringify({ builtin: [{ id: 'a', status: 'inactive' }, { id: 'b', status: 'active' }], extra: 1 })
    )
    const toggled = await handler(postJson('/strategies/toggle', { id: 'a', enabled: true }))
    expect(await toggled.json()).toEqual({ success: true })
    expect(JSON.parse((await host.kv.get(KV_KEY_PORTAL_STRATEGIES))!)).toEqual({
      builtin: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }],
      extra: 1
    })
    // Toggling b must NOT touch a (only the matching row flips).
    await handler(postJson('/strategies/toggle', { id: 'b', enabled: false }))
    expect(JSON.parse((await host.kv.get(KV_KEY_PORTAL_STRATEGIES))!)).toEqual({
      builtin: [{ id: 'a', status: 'active' }, { id: 'b', status: 'inactive' }],
      extra: 1
    })
  })

  it('analytics/curated POST validates chart id + date range shape', async () => {
    const { handler } = makeHandler()
    for (const body of [
      { chartId: 'nope', dateFrom: '2026-07-01', dateTo: '2026-07-25' },
      { chartId: 'events-volume', dateFrom: '01-07-2026', dateTo: '2026-07-25' },
      { chartId: 'events-volume', dateFrom: '2026-07-25', dateTo: '2026-07-01' }
    ]) {
      const res = await handler(postJson('/analytics/curated', body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: 'invalid_body',
        details: { code: 'curated_chart_request_invalid' }
      })
    }
  })

  it('analytics/warehouse-status reflects credential presence with exact messages', async () => {
    const { handler } = makeHandler()
    const unset = await handler(postJson('/analytics/warehouse-status', {}))
    const unsetBody = (await unset.json()) as { configured: boolean; message: string }
    expect(unsetBody.configured).toBe(false)
    expect(unsetBody.message).toContain('Configure TINYBIRD_TOKEN')

    const { handler: withWh } = makeHandler({ CONSENT_TOKEN_SECRET: SECRET, TINYBIRD_TOKEN: 't' })
    const set = await withWh(postJson('/analytics/warehouse-status', {}))
    const setBody = (await set.json()) as { configured: boolean; message: string }
    expect(setBody.configured).toBe(true)
    expect(setBody.message).toBe('Warehouse credentials detected for Explore.')
  })
})

describe('curated analytics computation', () => {
  const FROM = '2026-07-01'
  const TO = '2026-07-25'

  function whHost() {
    return createMockHostRuntime({ secrets: { CLICKHOUSE_QUERY_URL: 'http://ch:8123' } })
  }

  function mockRows(rows: Record<string, unknown>[]) {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: rows, meta: [] }), { status: 200 }))
  }

  it('validators: date shape + real-date + string-only; chart id membership', () => {
    expect(isValidCuratedDate('2026-07-25')).toBe(true)
    expect(isValidCuratedDate('2026-7-25')).toBe(false)
    expect(isValidCuratedDate('2026-99-99')).toBe(false)
    expect(isValidCuratedDate(['2026-07-25'])).toBe(false)
    expect(isCuratedChartId('events-volume')).toBe(true)
    expect(isCuratedChartId('bot-share')).toBe(true)
    expect(isCuratedChartId('sunburst')).toBe(false)
  })

  it('descriptor list carries exact metadata for all four charts', () => {
    const list = listCuratedChartDescriptors()
    expect(list.map((d) => d.id)).toEqual([
      'events-volume',
      'consent-rate-by-jurisdiction',
      'destination-success-rate',
      'bot-share'
    ])
    const volume = list.find((d) => d.id === 'events-volume')!
    expect(volume.unit).toBe('count')
    expect(volume.source).toBe('warehouse')
    const dest = list.find((d) => d.id === 'destination-success-rate')!
    expect(dest.source).toBe('delivery_stats')
    expect(dest.unit).toBe('percent')
  })

  it('unconfigured warehouse → not_configured with the operator hint', async () => {
    const host = createMockHostRuntime({ secrets: {} })
    const chart = await computeCuratedChart(host, null, 'events-volume', FROM, TO)
    expect(chart.state).toBe('not_configured')
    expect(chart.message).toContain('No analytics warehouse configured')
    expect(chart.series).toEqual([])
  })

  it('events-volume: canned per-day SQL through the gate; numeric coercion is honest', async () => {
    const host = whHost()
    const fetchSpy = mockRows([
      { day: '2026-07-01', events: '5' },
      { day: 20260702, events: 7 },
      { day: '2026-07-03', events: true }
    ])
    const chart = await computeCuratedChart(host, null, 'events-volume', FROM, TO)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const sql = init.body as string
    expect(sql).toContain('SELECT toDate(occurredAt) AS day, count() AS events FROM events WHERE')
    expect(sql).toContain(`toDate(occurredAt) >= '${FROM}' AND toDate(occurredAt) <= '${TO}'`)
    expect(sql).toContain('GROUP BY day ORDER BY day ASC LIMIT 500')
    expect(chart.state).toBe('ok')
    expect(chart.truncated).toBe(false)
    expect(chart.series).toEqual([
      {
        name: 'Events',
        points: [
          { label: '2026-07-01', value: 5 },
          { label: '20260702', value: 7 },
          // Booleans are NOT coerced — only numbers and numeric strings count.
          { label: '2026-07-03', value: 0 }
        ]
      }
    ])
  })

  it('empty result set → the honest empty state, never placeholder series', async () => {
    const host = whHost()
    mockRows([])
    const chart = await computeCuratedChart(host, null, 'events-volume', FROM, TO)
    expect(chart.state).toBe('empty')
    expect(chart.message).toContain('No matching events recorded')
    expect(chart.series).toEqual([])
  })

  it('warehouse failure → error state with the executor reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    const chart = await computeCuratedChart(whHost(), null, 'events-volume', FROM, TO)
    expect(chart.state).toBe('error')
    expect(chart.message).toBe('Warehouse query failed: boom')
  })

  it('bot-share: per-day percentage with zero-total guarded to 0', async () => {
    const host = whHost()
    const fetchSpy = mockRows([
      { day: '2026-07-01', bots: 1, total: 3 },
      { day: '2026-07-02', bots: 0, total: 0 }
    ])
    const chart = await computeCuratedChart(host, null, 'bot-share', FROM, TO)
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body).toContain(
      "countIf(userAgentClass = 'bot') AS bots, count() AS total FROM events"
    )
    expect(chart.state).toBe('ok')
    expect(chart.series).toEqual([
      {
        name: 'Bot share',
        points: [
          { label: '2026-07-01', value: 33.3 },
          { label: '2026-07-02', value: 0 }
        ]
      }
    ])
  })

  it('consent-rate: top-6 by decided volume, OTHER aggregation, day-sorted, zero-decided dropped', async () => {
    const host = whHost()
    const rows: Record<string, unknown>[] = []
    // 7 jurisdictions – J1 has the most decided, J7 the least (goes to OTHER).
    for (let j = 1; j <= 7; j += 1) {
      rows.push({ day: '2026-07-02', jurisdiction: `J${j}`, granted: 1, decided: 10 * (8 - j) })
      rows.push({ day: '2026-07-01', jurisdiction: `J${j}`, granted: 3, decided: 10 * (8 - j) })
    }
    rows.push({ day: '2026-07-03', jurisdiction: 'GHOST', granted: 0, decided: 0 })
    rows.push({ day: '2026-07-03', jurisdiction: '', granted: 1, decided: 2 })
    mockRows(rows)
    const chart = await computeCuratedChart(host, null, 'consent-rate-by-jurisdiction', FROM, TO)
    expect(chart.state).toBe('ok')
    const names = chart.series.map((s) => s.name)
    expect(names).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'OTHER'])
    // Days sorted ascending inside each series despite reversed input order.
    expect(chart.series[0]!.points.map((p) => p.label)).toEqual(['2026-07-01', '2026-07-02'])
    expect(chart.series[0]!.points[0]!.value).toBe(4.3) // 3/70 → 4.3%
    // OTHER aggregates J7 (10 decided/day) + the ''→UNKNOWN row... UNKNOWN ranks
    // by decided=2 below J7, both beyond the top-6 cut.
    const other = chart.series.find((s) => s.name === 'OTHER')!
    expect(other.points).toEqual([
      { label: '2026-07-01', value: 30 },
      { label: '2026-07-02', value: 10 },
      { label: '2026-07-03', value: 50 }
    ])
    expect(names).not.toContain('GHOST')
  })

  it('consent-rate: rows exist but none decided → the honest empty message', async () => {
    const host = whHost()
    mockRows([{ day: '2026-07-01', jurisdiction: 'EU', granted: 0, decided: 0 }])
    const chart = await computeCuratedChart(host, null, 'consent-rate-by-jurisdiction', FROM, TO)
    expect(chart.state).toBe('empty')
    expect(chart.message).toContain('none carry a recorded consent decision')
  })

  it('destination-success-rate reads recorded delivery stats, not the warehouse', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createMockHostRuntime({ secrets: { CLICKHOUSE_HTTP_URL: 'http://ch' } })
    const emptyChart = await computeCuratedChart(host, null, 'destination-success-rate', FROM, TO)
    expect(emptyChart.state).toBe('empty')
    expect(emptyChart.message).toContain('No delivery outcomes recorded yet')

    await host.kv.put(
      'attestrack:obs:delivery:clickhouse',
      JSON.stringify({ ok: 9, error: 1, okToday: 0, errorToday: 0, day: '2026-07-24', lastOkAt: '2026-07-24T10:00:00Z' })
    )
    const chart = await computeCuratedChart(host, null, 'destination-success-rate', FROM, TO)
    expect(chart.state).toBe('ok')
    expect(chart.series).toEqual([
      { name: 'Success rate', points: [{ label: 'ClickHouse HTTP sink', value: 90 }] }
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
