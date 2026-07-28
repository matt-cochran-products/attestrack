/**
 * P7.3 — Portal API authn contract.
 *
 * Default mode: portal routes are unauthenticated by design (Cloudflare Access
 * assumed in front — PORTAL.1). Optional mode: when the Worker secret
 * PORTAL_API_SHARED_SECRET is configured, EVERY portal-prefix request (reads
 * and writes) must carry x-attestrack-portal-secret or receives 401.
 */
import { describe, expect, it } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  PORTAL_API_PREFIX,
  PORTAL_SHARED_SECRET_HEADER,
  PORTAL_SHARED_SECRET_NAME
} from '../../src/portal.js'
import { createMockHostRuntime, noopStrategyLoader } from '@attestrack/sdk'

const CONSENT_SECRET = 'portal-auth-secret-32-chars-min!'
const PORTAL_SECRET = 'portal-shared-secret-for-tests!!'

function makeHandler(secrets: Record<string, string>) {
  const host = createMockHostRuntime({
    secrets: { CONSENT_TOKEN_SECRET: CONSENT_SECRET, ...secrets }
  })
  return {
    host,
    handler: createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
  }
}

function portalGet(headers: Record<string, string> = {}) {
  return new Request(`https://t.example.com${PORTAL_API_PREFIX}/site-config`, { headers })
}

function portalPost(sub: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://t.example.com${PORTAL_API_PREFIX}${sub}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

describe('portal API authn (P7.3 contract)', () => {
  describe('default mode — no shared secret configured (Access-fronted)', () => {
    it('GET routes respond without any auth header (unchanged contract)', async () => {
      const { handler } = makeHandler({})
      const res = await handler(portalGet())
      expect(res.status).toBe(200)
    })

    it('config writes respond without any auth header (unchanged contract)', async () => {
      const { handler } = makeHandler({})
      const res = await handler(
        portalPost('/site-config/trusted-domains', { domains: ['app.example.com'] })
      )
      expect(res.status).toBe(200)
    })
  })

  describe('shared-secret mode — PORTAL_API_SHARED_SECRET configured', () => {
    const secrets = { [PORTAL_SHARED_SECRET_NAME]: PORTAL_SECRET }

    it('GET without the header → 401 portal_unauthorized', async () => {
      const { handler } = makeHandler(secrets)
      const res = await handler(portalGet())
      expect(res.status).toBe(401)
      const json = (await res.json()) as { error: string }
      expect(json.error).toBe('portal_unauthorized')
    })

    it('write without the header → 401 (config API is not world-writable)', async () => {
      const { handler } = makeHandler(secrets)
      for (const [sub, body] of [
        ['/site-config/trusted-domains', { domains: ['evil.example'] }],
        ['/strategies/toggle', { id: 'meta-capi', enabled: true }],
        ['/explore/saved-queries', { name: 'q', sql: 'SELECT event_name FROM events LIMIT 1' }],
        ['/explore/saved-queries/remove', { id: 'x' }]
      ] as const) {
        const res = await handler(portalPost(sub, body))
        expect(res.status, `${sub} must be gated`).toBe(401)
      }
    })

    it('wrong header value → 401', async () => {
      const { handler } = makeHandler(secrets)
      const res = await handler(portalGet({ [PORTAL_SHARED_SECRET_HEADER]: 'wrong-value' }))
      expect(res.status).toBe(401)
    })

    it('correct header → routes behave exactly as in the default mode', async () => {
      const { handler } = makeHandler(secrets)
      const auth = { [PORTAL_SHARED_SECRET_HEADER]: PORTAL_SECRET }
      const get = await handler(portalGet(auth))
      expect(get.status).toBe(200)
      const write = await handler(
        portalPost('/site-config/trusted-domains', { domains: ['app.example.com'] }, auth)
      )
      expect(write.status).toBe(200)
      const json = (await write.json()) as { success: boolean }
      expect(json.success).toBe(true)
    })

    it('gates apply before route dispatch: unknown subpaths also 401 (no surface probing)', async () => {
      const { handler } = makeHandler(secrets)
      const res = await handler(
        new Request(`https://t.example.com${PORTAL_API_PREFIX}/does-not-exist`)
      )
      expect(res.status).toBe(401)
    })

    it('does not gate non-portal routes (consent/tracking paths unaffected)', async () => {
      const { handler } = makeHandler(secrets)
      const health = await handler(new Request('https://t.example.com/health'))
      expect(health.status).toBe(200)
    })
  })
})
