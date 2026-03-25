import { describe, expect, it } from 'vitest'
import { createAttestrackFetchHandler } from '../src/create-fetch-handler.js'
import {
  createPrivacyConsentToken,
  noopStrategyLoader,
  verifyPrivacyConsentToken,
  createMockHostRuntime
} from '@attestrue/sdk'
import { defaultCommunityStrategies } from '@attestrue/strategies'

describe('createAttestrackFetchHandler', () => {
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
})
