import { describe, expect, it } from 'vitest'
import { createPrivacyConsentToken, verifyPrivacyConsentToken } from '../src/consent-token.js'

describe('privacy consent token', () => {
  it('round-trips mint and verify', async () => {
    const secret = 'unit-test-secret-32chars!!'
    const token = await createPrivacyConsentToken(secret, {
      siteId: 'site_1',
      decision: 'granted',
      policyHash: 'sha256:abc',
      jurisdictionHint: 'EU'
    })
    const v = await verifyPrivacyConsentToken(secret, token)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload.siteId).toBe('site_1')
      expect(v.payload.decision).toBe('granted')
      expect(v.payload.policyHash).toBe('sha256:abc')
      expect(v.payload.jurisdictionHint).toBe('EU')
    }
  })

  it('rejects wrong secret', async () => {
    const token = await createPrivacyConsentToken('secret-a-sixteen-bytes!!', {
      siteId: 's',
      decision: 'declined',
      policyHash: 'h'
    })
    const v = await verifyPrivacyConsentToken('secret-b-sixteen-bytes!!', token)
    expect(v.ok).toBe(false)
  })
})
