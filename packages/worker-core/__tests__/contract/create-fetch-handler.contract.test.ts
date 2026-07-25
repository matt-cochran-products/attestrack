import { describe, expect, it } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  createPrivacyConsentToken,
  noopStrategyLoader,
  verifyPrivacyConsentToken,
  createMockHostRuntime,
  flushMockBackgroundTasks,
  type Strategy
} from '@attestrack/sdk'
import { defaultCommunityStrategies } from '@attestrack/strategies'
import { KV_KEY_ENABLED_STRATEGIES, KV_KEY_PORTAL_SITE_CONFIG } from '@attestrack/types'
import { TRACKING_EVENT_PATH } from '../../src/constants.js'

describe('createAttestrackFetchHandler (contract)', () => {
  it('mints consent token on commit path', async () => {
    const host = createMockHostRuntime({
      secrets: { CONSENT_TOKEN_SECRET: 'test-secret-32-chars-minimum!!' }
    })
    const fetch = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })

    const req = new Request('https://example.com/__attestrack__/consent/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: 's1',
        decision: 'granted',
        policyHash: 'sha256:x'
      })
    })
    const res = await fetch(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { token: string }
    const v = await verifyPrivacyConsentToken('test-secret-32-chars-minimum!!', json.token)
    expect(v.ok).toBe(true)
  })

  it('runs mandatory strategies for generic GET', async () => {
    const secret = 'x'.repeat(32)
    const host = createMockHostRuntime({
      secrets: { CONSENT_TOKEN_SECRET: secret }
    })
    const token = await createPrivacyConsentToken(secret, {
      siteId: 's',
      decision: 'granted',
      policyHash: 'h'
    })
    const fetch = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: defaultCommunityStrategies('CONSENT_TOKEN_SECRET'),
      strategyLoader: noopStrategyLoader
    })

    const req = new Request('https://example.com/page', {
      method: 'GET',
      headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
    })
    const res = await fetch(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { consentDecision: string | null }
    expect(json.consentDecision).toBe('granted')
  })

  it('filters destination strategies using KV_KEY_ENABLED_STRATEGIES', async () => {
    let destA = false
    let destB = false
    const mandatory: Strategy = {
      id: 'man',
      stage: 'mandatory',
      async run() {
        return { continuePipeline: true }
      }
    }
    const dest1: Strategy = {
      id: 'dest-a',
      stage: 'destination',
      async run() {
        destA = true
        return { continuePipeline: true }
      }
    }
    const dest2: Strategy = {
      id: 'dest-b',
      stage: 'destination',
      async run() {
        destB = true
        return { continuePipeline: true }
      }
    }
    const host = createMockHostRuntime()
    await host.kv.put(KV_KEY_ENABLED_STRATEGIES, JSON.stringify(['dest-a']))
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [mandatory, dest1, dest2],
      strategyLoader: noopStrategyLoader
    })
    const body = {
      v: 1 as const,
      eventName: 'page_view',
      siteId: 's',
      occurredAt: new Date().toISOString()
    }
    const res = await handler(
      new Request(`https://x${TRACKING_EVENT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    )
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)
    expect(destA).toBe(true)
    expect(destB).toBe(false)
  })

  it('accepts tracking event then runs pipeline in background', async () => {
    let ran = false
    const mark: Strategy = {
      id: 'mark',
      stage: 'mandatory',
      async run() {
        ran = true
        return { continuePipeline: true }
      }
    }
    const host = createMockHostRuntime()
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [mark],
      strategyLoader: noopStrategyLoader
    })
    const body = {
      v: 1 as const,
      eventName: 'page_view',
      siteId: 's',
      occurredAt: new Date().toISOString()
    }
    const res = await handler(
      new Request(`https://x${TRACKING_EVENT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    )
    expect(ran).toBe(false)
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)
    expect(ran).toBe(true)
  })

  it('returns 403 requires_attestrue for GET portal policy-versions', async () => {
    const host = createMockHostRuntime()
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
    const res = await handler(
      new Request('https://x/__attestrack__/portal/v1/policy-versions', { method: 'GET' })
    )
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string; handoff?: string }
    expect(json.error).toBe('requires_attestrue')
    expect(json.handoff).toContain('attestrue.com')
  })

  it('returns 403 requires_attestrue for POST portal site-config/mode', async () => {
    const host = createMockHostRuntime()
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
    const res = await handler(
      new Request('https://x/__attestrack__/portal/v1/site-config/mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'ENFORCEMENT' })
      })
    )
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('requires_attestrue')
  })

  it('returns portal site-config from KV', async () => {
    const host = createMockHostRuntime()
    await host.kv.put(
      KV_KEY_PORTAL_SITE_CONFIG,
      JSON.stringify({
        siteId: 'x',
        domain: 'd',
        workerVersion: '1',
        shadowStart: 't',
        enforcementStart: null,
        mode: 'ENFORCEMENT',
        consentConfigured: true,
        state1TokenTTL: 1,
        ipHandling: 'x',
        trustedDomains: [],
        driftDetection: { enabled: false, quarantineNew: false, alertThreshold: 0 }
      })
    )
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
    const res = await handler(
      new Request('https://x/__attestrack__/portal/v1/site-config', { method: 'GET' })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { mode: string }
    expect(json.mode).toBe('ENFORCEMENT')
  })

  it('serves privacy text from KV or default', async () => {
    const host = createMockHostRuntime()
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'X',
      bundledStrategies: [],
      strategyLoader: noopStrategyLoader
    })
    const res = await handler(new Request('https://x/privacy', { method: 'GET' }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(0)
  })
})
