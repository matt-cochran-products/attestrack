import { describe, expect, it } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { createMockHostRuntime, noopStrategyLoader } from '@attestrack/sdk'
import type { JurisdictionConsentRow } from '@attestrack/types'
import { KV_KEY_CONSENT_CONFIG, KV_KEY_PORTAL_SITE_CONFIG } from '@attestrack/types'

interface ConsentContextBody {
  siteId: string
  mode: string
  jurisdictionKey: string
  row: JurisdictionConsentRow
  policyRefs: Record<string, string>
}

function makeHandler(opts: { geoCountry?: string | null } = {}) {
  const host = createMockHostRuntime({
    secrets: { CONSENT_TOKEN_SECRET: 's'.repeat(32) },
    geoCountry: opts.geoCountry ?? null
  })
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: [],
    strategyLoader: noopStrategyLoader
  })
  return { host, handler }
}

describe('GET /__attestrack__/consent/context (P2.3)', () => {
  it('resolves the EU row for an EU geo signal with policy refs', async () => {
    const { handler } = makeHandler({ geoCountry: 'DE' })
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', { method: 'GET' })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as ConsentContextBody
    expect(body.jurisdictionKey).toBe('EU')
    expect(body.row.mechanism).toBe('opt-in')
    expect(body.row.ioa_assertions.length).toBeGreaterThan(0)
    expect(body.policyRefs.privacy_policy).toBe('/privacy')
  })

  it('falls back to the DEFAULT (opt-out) row when geo is unknown', async () => {
    const { handler } = makeHandler({ geoCountry: null })
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', { method: 'GET' })
    )
    const body = (await res.json()) as ConsentContextBody
    expect(body.jurisdictionKey).toBe('DEFAULT')
    expect(body.row.mechanism).toBe('opt-out')
  })

  it('INV-B-03: reports SHADOW mode for a fresh deployment (no site config)', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', { method: 'GET' })
    )
    const body = (await res.json()) as ConsentContextBody
    expect(body.mode).toBe('SHADOW')
  })

  it('reflects operator KV consent config and site mode', async () => {
    const { host, handler } = makeHandler({ geoCountry: 'US' })
    await host.kv.put(
      KV_KEY_CONSENT_CONFIG,
      JSON.stringify({
        jurisdictions: {
          US: {
            profile: 'standard',
            mechanism: 'opt-out',
            ioa_assertions: [{ id: 'us_notice', text: 'US notice', required: true }],
            documents: ['privacy_policy'],
            gpc_honor: true
          },
          DEFAULT: {
            profile: 'standard',
            mechanism: 'opt-in',
            ioa_assertions: [{ id: 'primary', text: 'x', required: true }],
            documents: ['privacy_policy'],
            gpc_honor: false
          }
        }
      })
    )
    await host.kv.put(
      KV_KEY_PORTAL_SITE_CONFIG,
      JSON.stringify({ siteId: 'site_9', domain: 'example.com', mode: 'ENFORCEMENT' })
    )
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', { method: 'GET' })
    )
    const body = (await res.json()) as ConsentContextBody
    expect(body.siteId).toBe('site_9')
    expect(body.mode).toBe('ENFORCEMENT')
    expect(body.jurisdictionKey).toBe('US')
    expect(body.row.ioa_assertions[0]?.id).toBe('us_notice')
  })

  it('serves credentialed CORS headers for allowed origins and answers preflight', async () => {
    const { handler } = makeHandler()
    const res = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', {
        method: 'GET',
        headers: { origin: 'https://www.example.com' }
      })
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.example.com')

    const preflight = await handler(
      new Request('https://t.example.com/__attestrack__/consent/context', {
        method: 'OPTIONS',
        headers: { origin: 'https://www.example.com', 'access-control-request-method': 'GET' }
      })
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET')
  })
})
