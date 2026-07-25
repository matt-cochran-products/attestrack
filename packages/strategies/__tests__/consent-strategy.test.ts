import { describe, expect, it } from 'vitest'
import { createConsentCookieStrategy, verifyCommunityConsentToken } from '../src/mandatory/consent.js'
import { createPrivacyConsentToken, createMockHostRuntime } from '@attestrack/sdk'

describe('createConsentCookieStrategy', () => {
  it('honors GPC by downgrading granted token when jurisdiction requires it', async () => {
    const secret = 'y'.repeat(32)
    const token = await createPrivacyConsentToken(secret, {
      siteId: 'site',
      decision: 'granted',
      policyHash: 'sha256:abc'
    })
    const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: secret } })
    const strat = createConsentCookieStrategy('CONSENT_TOKEN_SECRET')
    const res = await strat.run({
      host,
      request: new Request('https://x/', {
        headers: {
          cookie: `at_consent=${encodeURIComponent(token)}`,
          'Sec-GPC': '1'
        }
      }),
      jurisdictionRow: {
        profile: 'standard',
        mechanism: 'opt-in',
        ioa_assertions: [{ id: 'a', text: 't' }],
        documents: ['p'],
        gpc_honor: true
      }
    })
    expect(res.consent?.payload.decision).toBe('declined')
  })

  it('parses cookie and verifies token', async () => {
    const secret = 'y'.repeat(32)
    const token = await createPrivacyConsentToken(secret, {
      siteId: 'site',
      decision: 'declined',
      policyHash: 'sha256:abc'
    })
    const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: secret } })
    const strat = createConsentCookieStrategy('CONSENT_TOKEN_SECRET')
    const res = await strat.run({
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
      })
    })
    expect(res.consent?.payload.decision).toBe('declined')
  })
})

describe('verifyCommunityConsentToken', () => {
  it('delegates to sdk verify', async () => {
    const secret = 'z'.repeat(32)
    const t = await createPrivacyConsentToken(secret, {
      siteId: 'a',
      decision: 'withdrawn',
      policyHash: 'h'
    })
    const v = await verifyCommunityConsentToken(secret, t)
    expect(v.ok).toBe(true)
  })
})
