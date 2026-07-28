import { describe, expect, it } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { isOriginAllowed } from '../../src/cors.js'
import {
  createPrivacyConsentToken,
  noopStrategyLoader,
  verifyPrivacyConsentToken,
  createMockHostRuntime
} from '@attestrack/sdk'
import { KV_KEY_PORTAL_SITE_CONFIG } from '@attestrack/types'
import { TRACKING_EVENT_PATH } from '../../src/constants.js'

const SECRET = 'contract-secret-32-chars-min!!!!'

function siteConfigJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    siteId: 'site_1',
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
  const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: SECRET } })
  await host.kv.put(KV_KEY_PORTAL_SITE_CONFIG, siteConfigJson(siteConfigOverrides))
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: [],
    strategyLoader: noopStrategyLoader
  })
  return { host, handler }
}

describe('CORS topology (P2.1)', () => {
  it('answers OPTIONS preflight for the consent commit route from an allowed subdomain origin', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://www.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type'
        }
      })
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.example.com')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type')
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('answers OPTIONS preflight for /t/event', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request(`https://t.example.com${TRACKING_EVENT_PATH}`, {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' }
      })
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com')
  })

  it('never reflects a disallowed origin (no allow-origin header on preflight)', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example.net', 'access-control-request-method': 'POST' }
      })
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('adds credentialed CORS headers to POST /t/event responses from allowed origins', async () => {
    const { handler, host } = await makeHandler()
    const res = await handler(
      new Request(`https://t.example.com${TRACKING_EVENT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://www.example.com' },
        body: JSON.stringify({
          v: 1,
          eventName: 'page_view',
          siteId: 'site_1',
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.example.com')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    void host
  })

  it('honors trustedDomains entries from site config', async () => {
    const { handler } = await makeHandler({ trustedDomains: ['partner.example.org'] })
    const res = await handler(
      new Request(`https://t.example.com${TRACKING_EVENT_PATH}`, {
        method: 'OPTIONS',
        headers: { origin: 'https://partner.example.org', 'access-control-request-method': 'POST' }
      })
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('https://partner.example.org')
  })

  it('allowlist unit semantics: subdomains yes, suffix-attack and http no', () => {
    const cfg = { domain: 'example.com', trustedDomains: ['localhost:5173'] }
    expect(isOriginAllowed('https://example.com', cfg)).toBe(true)
    expect(isOriginAllowed('https://www.example.com', cfg)).toBe(true)
    expect(isOriginAllowed('https://deep.a.example.com', cfg)).toBe(true)
    expect(isOriginAllowed('https://notexample.com', cfg)).toBe(false)
    expect(isOriginAllowed('https://example.com.evil.net', cfg)).toBe(false)
    expect(isOriginAllowed('http://www.example.com', cfg)).toBe(false)
    expect(isOriginAllowed('http://localhost:5173', cfg)).toBe(true)
    expect(isOriginAllowed('http://localhost:9999', cfg)).toBe(false)
    expect(isOriginAllowed('not-a-url', cfg)).toBe(false)
  })
})

describe('consent commit Set-Cookie (P2.1)', () => {
  it('sets at_consent with Domain from site config, Secure, SameSite=Lax, Max-Age=state1TokenTTL', async () => {
    const { handler } = await makeHandler({ state1TokenTTL: 3600 })
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://www.example.com' },
        body: JSON.stringify({ siteId: 'site_1', decision: 'granted', policyHash: 'sha256:x' })
      })
    )
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toBeTruthy()
    expect(cookie).toContain('at_consent=')
    expect(cookie).toContain('Domain=example.com')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=3600')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.example.com')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('minted token carries expiresAt derived from state1TokenTTL and verifies', async () => {
    const { handler } = await makeHandler({ state1TokenTTL: 60 })
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId: 'site_1', decision: 'granted', policyHash: 'sha256:x' })
      })
    )
    const { token } = (await res.json()) as { token: string }
    const v = await verifyPrivacyConsentToken(SECRET, token, { expectedSiteId: 'site_1' })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload.expiresAt).toBeDefined()
      const ttlMs = Date.parse(v.payload.expiresAt!) - Date.parse(v.payload.issuedAt)
      expect(ttlMs).toBe(60_000)
    }
    const expired = await verifyPrivacyConsentToken(SECRET, token, {
      now: new Date(Date.now() + 61_000)
    })
    expect(expired.ok).toBe(false)
  })

  it('prefers cookieDomain over domain when configured', async () => {
    const { handler } = await makeHandler({ cookieDomain: 'shop.example.com' })
    const res = await handler(
      new Request('https://t.shop.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId: 'site_1', decision: 'declined', policyHash: 'sha256:x' })
      })
    )
    expect(res.headers.get('set-cookie')).toContain('Domain=shop.example.com')
  })

  it('omits Domain (host-only cookie) when the worker host is outside the configured domain', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request('https://workers.dev/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId: 'site_1', decision: 'granted', policyHash: 'sha256:x' })
      })
    )
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toContain('at_consent=')
    expect(cookie).not.toContain('Domain=')
  })

  it('sets the cookie for declined and withdrawn decisions too (opt-out mechanism needs them)', async () => {
    const { handler } = await makeHandler()
    for (const decision of ['declined', 'withdrawn'] as const) {
      const res = await handler(
        new Request('https://t.example.com/__attestrack__/consent/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ siteId: 'site_1', decision, policyHash: 'sha256:x' })
        })
      )
      expect(res.headers.get('set-cookie')).toContain('at_consent=')
    }
  })

  it('accepts ioaAccepted on commit and embeds it as payload.ioa', async () => {
    const { handler } = await makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteId: 'site_1',
          decision: 'granted',
          policyHash: 'sha256:x',
          ioaAccepted: ['privacy_policy', 'terms']
        })
      })
    )
    const { token } = (await res.json()) as { token: string }
    const v = await verifyPrivacyConsentToken(SECRET, token)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.payload.ioa).toEqual(['privacy_policy', 'terms'])
  })

  it('verifies tokens minted under a rotated previous secret (CONSENT_TOKEN_SECRET_PREVIOUS)', async () => {
    const host = createMockHostRuntime({
      secrets: {
        CONSENT_TOKEN_SECRET: 'k2.rotated-current-secret-32chars!',
        CONSENT_TOKEN_SECRET_PREVIOUS: `k1.${SECRET}`
      }
    })
    await host.kv.put(KV_KEY_PORTAL_SITE_CONFIG, siteConfigJson())
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId: 'site_1', decision: 'granted', policyHash: 'sha256:x' })
      })
    )
    const { token } = (await res.json()) as { token: string }
    expect(token.startsWith('k2.')).toBe(true)
    // Old-key tokens still verify with the same keyring the worker consent gate uses.
    const oldToken = await createPrivacyConsentToken(SECRET, {
      siteId: 'site_1',
      decision: 'granted',
      policyHash: 'sha256:x'
    })
    const keyring = {
      keys: { k2: 'rotated-current-secret-32chars!', k1: SECRET },
      currentKeyId: 'k2'
    }
    const v = await verifyPrivacyConsentToken(keyring, oldToken)
    expect(v.ok).toBe(true)
  })
})

describe('GET /consent.js (P2.1 — scaffold script tag)', () => {
  it('serves the embedded consent-js bundle with etag + cache headers', async () => {
    const { handler } = await makeHandler()
    const res = await handler(new Request('https://t.example.com/consent.js', { method: 'GET' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/)
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
    const body = await res.text()
    expect(body.length).toBeGreaterThan(100)
    expect(body).toContain('AttestrackConsent')
  })

  it('returns 304 when If-None-Match matches the content hash', async () => {
    const { handler } = await makeHandler()
    const first = await handler(new Request('https://t.example.com/consent.js', { method: 'GET' }))
    const etag = first.headers.get('etag')!
    const second = await handler(
      new Request('https://t.example.com/consent.js', {
        method: 'GET',
        headers: { 'if-none-match': etag }
      })
    )
    expect(second.status).toBe(304)
    expect(second.headers.get('etag')).toBe(etag)
  })
})
