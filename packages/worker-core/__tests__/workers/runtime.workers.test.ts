/**
 * P6.1 — Worker RUNTIME contract tests (workerd, not Node).
 *
 * These run inside actual workerd via @cloudflare/vitest-pool-workers with a
 * REAL KV namespace binding and a REAL ExecutionContext, wired through the
 * production adapter `createCloudflareHostRuntime` — the exact host the deploy
 * scaffold uses (packages/deploy/src/worker-template.ts). They cover the
 * behaviors the in-process Node mock cannot honestly prove:
 *
 * - KV semantics (expirationTtl floor of 60s, real serialization round-trips)
 * - `waitUntil` background scheduling (via `waitOnExecutionContext`)
 * - `cf-ipcountry` geo resolution (jurisdiction rows)
 * - `Set-Cookie` handling in real workerd Headers (`getSetCookie`)
 *
 * Run with: pnpm --filter @attestrack/worker-core test:workers
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { createCloudflareHostRuntime } from '@attestrack/host-cloudflare-worker'
import {
  createPrivacyConsentToken,
  keyringFromSecretValues,
  noopStrategyLoader
} from '@attestrack/sdk'
import { allBundledStrategies } from '@attestrack/strategies'
import {
  KV_KEY_CONSENT_EVENT_PREFIX,
  KV_KEY_PORTAL_SITE_CONFIG,
  DEFAULT_CONSENT_EVENT_TTL_SECONDS
} from '@attestrack/types'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { TRACKING_EVENT_PATH } from '../../src/constants.js'

const SECRET = 'workerd-suite-secret-32-chars!!!'

// vitest-pool-workers 0.13+ (vitest 4 line) removed the per-test isolated
// storage the 0.5.x pool provided implicitly — KV state now persists across
// tests in a file. Restore the hermetic-per-test semantics these contracts
// were written against (e.g. "anonymous ingest writes NO record" must not see
// the record a previous test wrote) by wiping the namespace before each test.
beforeEach(async () => {
  const { keys } = await env.ATTESTRACK_KV.list()
  await Promise.all(keys.map((k) => env.ATTESTRACK_KV.delete(k.name)))
})

function siteConfigJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    siteId: 'site_workerd',
    domain: 'example.com',
    workerVersion: '0.0.0',
    shadowStart: '2026-01-01T00:00:00.000Z',
    enforcementStart: null,
    mode: 'SHADOW',
    consentConfigured: true,
    state1TokenTTL: 86400,
    ipHandling: 'hash_salt',
    trustedDomains: [],
    driftDetection: { enabled: true, quarantineNew: false, alertThreshold: 0.05 },
    ...overrides
  })
}

async function makeHandler(siteConfigOverrides: Record<string, unknown> = {}) {
  const ctx = createExecutionContext()
  const host = createCloudflareHostRuntime({
    bindings: { kv: env.ATTESTRACK_KV },
    executionCtx: ctx,
    secretValues: { CONSENT_TOKEN_SECRET: SECRET }
  })
  await env.ATTESTRACK_KV.put(KV_KEY_PORTAL_SITE_CONFIG, siteConfigJson(siteConfigOverrides))
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: allBundledStrategies('CONSENT_TOKEN_SECRET'),
    strategyLoader: noopStrategyLoader
  })
  return { ctx, host, handler }
}

async function mintToken(decision: 'granted' | 'declined', ioa: string[] = ['primary']) {
  const keyring = keyringFromSecretValues(SECRET, undefined)
  return createPrivacyConsentToken(
    keyring,
    {
      siteId: 'site_workerd',
      decision,
      policyHash: 'sha256:workerd',
      ...(decision === 'granted' ? { ioa } : {})
    },
    { ttlSeconds: 3600 }
  )
}

describe('real KV semantics (miniflare KV, not the in-memory mock)', () => {
  it('rejects expirationTtl below the 60s Cloudflare KV floor', async () => {
    // The Node MemoryKv mock silently accepts any TTL; real KV throws. This
    // pins the runtime constraint so pipeline TTLs are never set below it.
    await expect(
      env.ATTESTRACK_KV.put('attestrack:test:ttl-floor', 'x', { expirationTtl: 30 })
    ).rejects.toThrow(/60|invalid expiration/i)
  })

  it('default consent-event TTL clears the KV floor', () => {
    expect(DEFAULT_CONSENT_EVENT_TTL_SECONDS).toBeGreaterThanOrEqual(60)
  })

  it('round-trips JSON values with expirationTtl through real KV', async () => {
    const key = 'attestrack:test:roundtrip'
    await env.ATTESTRACK_KV.put(key, JSON.stringify({ v: 1 }), { expirationTtl: 120 })
    expect(JSON.parse((await env.ATTESTRACK_KV.get(key)) ?? '{}')).toEqual({ v: 1 })
  })
})

describe('waitUntil background pipeline (real ExecutionContext)', () => {
  it('POST /t/event responds immediately and writes the consent-event record in waitUntil', async () => {
    const { ctx, handler } = await makeHandler()
    const token = await mintToken('granted')
    const res = await handler(
      new Request(`https://t.example.com${TRACKING_EVENT_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `at_consent=${encodeURIComponent(token)}`,
          'cf-ipcountry': 'DE'
        },
        body: JSON.stringify({
          v: 1,
          eventName: 'workerd_e2e',
          siteId: 'site_workerd',
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, accepted: true })

    // Before the ExecutionContext settles, the background pipeline may not
    // have run; after waitOnExecutionContext it MUST have written the
    // evidence-unsigned record keyed by the token signature.
    await waitOnExecutionContext(ctx)
    const listed = await env.ATTESTRACK_KV.list({ prefix: KV_KEY_CONSENT_EVENT_PREFIX })
    expect(listed.keys.length).toBeGreaterThan(0)
    const record = JSON.parse((await env.ATTESTRACK_KV.get(listed.keys[0]!.name)) ?? 'null') as {
      v: number
      siteId: string
      decision: string
      jurisdictionKey: string
      ioaAttested: boolean
    }
    expect(record).toMatchObject({
      v: 1,
      siteId: 'site_workerd',
      decision: 'granted',
      jurisdictionKey: 'EU',
      ioaAttested: true
    })
  })

  it('writes NO consent-event record for anonymous traffic (P7.1 flood mitigation) under workerd', async () => {
    const { ctx, handler } = await makeHandler()
    const res = await handler(
      new Request(`https://t.example.com${TRACKING_EVENT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-ipcountry': 'US' },
        body: JSON.stringify({
          v: 1,
          eventName: 'anon',
          siteId: 'site_workerd',
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(res.status).toBe(200)
    await waitOnExecutionContext(ctx)
    const listed = await env.ATTESTRACK_KV.list({ prefix: KV_KEY_CONSENT_EVENT_PREFIX })
    expect(listed.keys).toHaveLength(0)
  })
})

describe('cf-ipcountry geo resolution (real header, production host adapter)', () => {
  it('resolves DE to the EU opt-in row on /__attestrack__/consent/context', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', {
        headers: { 'cf-ipcountry': 'DE' }
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { jurisdictionKey: string; row: { mechanism: string } }
    expect(body.jurisdictionKey).toBe('EU')
    expect(body.row.mechanism).toBe('opt-in')
  })

  it('falls back to DEFAULT opt-out row when cf-ipcountry is absent', async () => {
    const { handler } = await makeHandler()
    const res = await handler(new Request('https://t.example.com/__attestrack__/consent/context'))
    const body = (await res.json()) as { jurisdictionKey: string; row: { mechanism: string } }
    expect(body.jurisdictionKey).toBe('DEFAULT')
    expect(body.row.mechanism).toBe('opt-out')
  })
})

describe('Set-Cookie in real workerd Headers', () => {
  it('consent commit emits a single cross-subdomain Set-Cookie readable via getSetCookie()', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://www.example.com' },
        body: JSON.stringify({
          siteId: 'site_workerd',
          decision: 'granted',
          policyHash: 'sha256:workerd',
          ioaAccepted: ['primary']
        })
      })
    )
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(1)
    const cookie = cookies[0]!
    expect(cookie).toMatch(/^at_consent=/)
    expect(cookie).toContain('Domain=example.com')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=86400')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    // Credentialed CORS so the browser accepts the cookie cross-origin (P2.1).
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.example.com')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('omits the Domain attribute when the worker host is outside the configured domain', async () => {
    const { handler } = await makeHandler({ domain: 'other.example' })
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site_workerd',
          decision: 'declined',
          policyHash: 'sha256:workerd'
        })
      })
    )
    expect(res.status).toBe(200)
    const cookie = res.headers.getSetCookie()[0]!
    expect(cookie).not.toContain('Domain=')
  })
})
