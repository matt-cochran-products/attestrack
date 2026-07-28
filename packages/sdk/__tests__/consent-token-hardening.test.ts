import { describe, expect, it } from 'vitest'
import {
  createPrivacyConsentToken,
  isConsentSecretStrongEnough,
  keyringFromSecretValues,
  parseConsentSecretValue,
  verifyPrivacyConsentToken
} from '../src/consent-token.js'
import type { ConsentDecision } from '@attestrack/types'

const SECRET = 'hardening-test-secret-32-chars!!'

/**
 * P2.2 token hardening suite. fast-check is not a repo dependency, so these are
 * exhaustive table/mutation tests over the same properties:
 * round-trip, tamper (every single-character mutation), non-canonical encoding,
 * truncation (every prefix), expiry, wrong-site binding, key rotation.
 */
describe('consent token hardening (P2.2)', () => {
  describe('property: round-trip over payload table', () => {
    const decisions: ConsentDecision[] = ['granted', 'declined', 'withdrawn']
    const hints = [undefined, 'EU', 'US-CA']
    const ioas: (string[] | undefined)[] = [undefined, ['primary'], ['privacy_policy', 'terms']]
    for (const decision of decisions) {
      for (const hint of hints) {
        for (const ioa of ioas) {
          it(`round-trips decision=${decision} hint=${hint ?? 'none'} ioa=${ioa?.join('+') ?? 'none'}`, async () => {
            const token = await createPrivacyConsentToken(
              SECRET,
              {
                siteId: 'site_rt',
                decision,
                policyHash: 'sha256:abc',
                ...(hint !== undefined ? { jurisdictionHint: hint } : {}),
                ...(ioa !== undefined ? { ioa } : {})
              },
              { ttlSeconds: 3600 }
            )
            expect(token.startsWith('k1.')).toBe(true)
            const v = await verifyPrivacyConsentToken(SECRET, token, { expectedSiteId: 'site_rt' })
            expect(v.ok).toBe(true)
            if (v.ok) {
              expect(v.keyId).toBe('k1')
              expect(v.payload.decision).toBe(decision)
              expect(v.payload.jurisdictionHint).toBe(hint)
              expect(v.payload.ioa).toEqual(ioa)
              expect(v.payload.expiresAt).toBeDefined()
            }
          })
        }
      }
    }
  })

  it('property: every single-character mutation of the token fails verification', async () => {
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'sha256:abc'
    })
    for (let i = 0; i < token.length; i++) {
      const orig = token[i]!
      const replacement = orig === 'A' ? 'B' : 'A'
      const mutated = token.slice(0, i) + replacement + token.slice(i + 1)
      const v = await verifyPrivacyConsentToken(SECRET, mutated)
      expect(v.ok, `mutation at index ${i} must be rejected`).toBe(false)
    }
  })

  it('property: every truncation of the token fails verification', async () => {
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'sha256:abc'
    })
    for (let len = 0; len < token.length; len++) {
      const v = await verifyPrivacyConsentToken(SECRET, token.slice(0, len))
      expect(v.ok, `truncation to length ${len} must be rejected`).toBe(false)
    }
  })

  it('rejects a correctly signed but non-canonical payload encoding', async () => {
    // Sign a payload whose JSON key order differs from the canonical sorted order.
    const nonCanonicalJson = JSON.stringify({
      v: 1,
      siteId: 's1',
      decision: 'granted',
      issuedAt: new Date().toISOString(),
      policyHash: 'sha256:abc'
    })
    // 'v' first is not sorted order → canonical check must fire even with a valid signature.
    const te = new TextEncoder()
    const b64url = (bytes: Uint8Array) => {
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
    }
    const payloadPart = b64url(te.encode(nonCanonicalJson))
    const key = await crypto.subtle.importKey(
      'raw',
      te.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(`k1.${payloadPart}`)))
    const forged = `k1.${payloadPart}.${b64url(sig)}`
    const v = await verifyPrivacyConsentToken(SECRET, forged)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('non_canonical')
  })

  describe('expiry (verify-time TTL check)', () => {
    it('accepts an unexpired token and rejects it after expiry', async () => {
      const mintedAt = new Date('2026-01-01T00:00:00.000Z')
      const token = await createPrivacyConsentToken(
        SECRET,
        { siteId: 's1', decision: 'granted', policyHash: 'h' },
        { ttlSeconds: 86400, now: mintedAt }
      )
      const before = await verifyPrivacyConsentToken(SECRET, token, {
        now: new Date('2026-01-01T23:59:59.000Z')
      })
      expect(before.ok).toBe(true)
      const after = await verifyPrivacyConsentToken(SECRET, token, {
        now: new Date('2026-01-02T00:00:00.000Z')
      })
      expect(after.ok).toBe(false)
      if (!after.ok) expect(after.reason).toBe('expired')
    })

    it('treats expiresAt as exclusive: valid one ms before, expired at the boundary', async () => {
      const mintedAt = new Date('2026-01-01T00:00:00.000Z')
      const token = await createPrivacyConsentToken(
        SECRET,
        { siteId: 's1', decision: 'granted', policyHash: 'h' },
        { ttlSeconds: 60, now: mintedAt }
      )
      const justBefore = await verifyPrivacyConsentToken(SECRET, token, {
        now: new Date(mintedAt.getTime() + 60_000 - 1)
      })
      expect(justBefore.ok).toBe(true)
      const atBoundary = await verifyPrivacyConsentToken(SECRET, token, {
        now: new Date(mintedAt.getTime() + 60_000)
      })
      expect(atBoundary.ok).toBe(false)
    })

    it('tokens without expiresAt do not expire (legacy/mint-without-ttl)', async () => {
      const token = await createPrivacyConsentToken(SECRET, {
        siteId: 's1',
        decision: 'granted',
        policyHash: 'h'
      })
      const v = await verifyPrivacyConsentToken(SECRET, token, {
        now: new Date('2099-01-01T00:00:00.000Z')
      })
      expect(v.ok).toBe(true)
    })
  })

  describe('siteId binding', () => {
    it('rejects a token minted for a different site (wrong_site)', async () => {
      const token = await createPrivacyConsentToken(SECRET, {
        siteId: 'site_a',
        decision: 'granted',
        policyHash: 'h'
      })
      const v = await verifyPrivacyConsentToken(SECRET, token, { expectedSiteId: 'site_b' })
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.reason).toBe('wrong_site')
    })

    it('accepts when expectedSiteId matches', async () => {
      const token = await createPrivacyConsentToken(SECRET, {
        siteId: 'site_a',
        decision: 'granted',
        policyHash: 'h'
      })
      const v = await verifyPrivacyConsentToken(SECRET, token, { expectedSiteId: 'site_a' })
      expect(v.ok).toBe(true)
    })
  })

  describe('versioned-key rotation (k<N>. prefix)', () => {
    it('parses prefixed and plain secret values', () => {
      expect(parseConsentSecretValue('k2.abc')).toEqual({ keyId: 'k2', secret: 'abc' })
      expect(parseConsentSecretValue('plain-secret')).toEqual({ keyId: 'k1', secret: 'plain-secret' })
    })

    it('verifies tokens signed under a previous key after rotation', async () => {
      const oldToken = await createPrivacyConsentToken('old-secret-32-chars-long-enough!', {
        siteId: 's1',
        decision: 'granted',
        policyHash: 'h'
      })
      expect(oldToken.startsWith('k1.')).toBe(true)
      const rotated = keyringFromSecretValues(
        'k2.new-secret-32-chars-long-enough!',
        'k1.old-secret-32-chars-long-enough!'
      )
      const v = await verifyPrivacyConsentToken(rotated, oldToken)
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.keyId).toBe('k1')
    })

    it('signs new tokens with the current key id after rotation', async () => {
      const rotated = keyringFromSecretValues('k2.new-secret-sixteen-plus-bytes!', 'k1.old-secret-sixteen-plus-bytes!')
      const token = await createPrivacyConsentToken(rotated, {
        siteId: 's1',
        decision: 'granted',
        policyHash: 'h'
      })
      expect(token.startsWith('k2.')).toBe(true)
      const v = await verifyPrivacyConsentToken(rotated, token)
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.keyId).toBe('k2')
    })

    it('rejects tokens signed with a key id absent from the keyring (unknown_key)', async () => {
      const token = await createPrivacyConsentToken(
        { keys: { k3: 'retired-secret-sixteen-bytes!' }, currentKeyId: 'k3' },
        { siteId: 's1', decision: 'granted', policyHash: 'h' }
      )
      const v = await verifyPrivacyConsentToken({ keys: { k4: 'other-secret-sixteen-bytes!!' }, currentKeyId: 'k4' }, token)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.reason).toBe('unknown_key')
    })

    it('a token re-labeled with another valid key id fails (key id is signature-bound)', async () => {
      const keyring = keyringFromSecretValues('k1.secret-one-sixteen-bytes!', 'k2.secret-two-sixteen-bytes!')
      const token = await createPrivacyConsentToken(keyring, {
        siteId: 's1',
        decision: 'granted',
        policyHash: 'h'
      })
      const relabeled = token.replace(/^k1\./u, 'k2.')
      const v = await verifyPrivacyConsentToken(keyring, relabeled)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.reason).toBe('bad_signature')
    })
  })

  it('rejects legacy two-segment tokens as malformed', async () => {
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'h'
    })
    const legacy = token.slice(token.indexOf('.') + 1)
    const v = await verifyPrivacyConsentToken(SECRET, legacy)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('malformed')
  })

  describe('P7.2 crypto-review hardening', () => {
    it('refuses to mint under a signing secret shorter than 16 bytes', async () => {
      await expect(
        createPrivacyConsentToken('short-secret', {
          siteId: 's1',
          decision: 'granted',
          policyHash: 'h'
        })
      ).rejects.toThrow(/shorter than 16 bytes/)
    })

    it('mints at exactly the 16-byte floor', async () => {
      const token = await createPrivacyConsentToken('0123456789abcdef', {
        siteId: 's1',
        decision: 'granted',
        policyHash: 'h'
      })
      const v = await verifyPrivacyConsentToken('0123456789abcdef', token)
      expect(v.ok).toBe(true)
    })

    it('measures the floor in BYTES, not code points (multi-byte secrets)', () => {
      // 8 snowmen = 8 code points but 24 UTF-8 bytes → strong enough.
      expect(isConsentSecretStrongEnough('☃'.repeat(8))).toBe(true)
      expect(isConsentSecretStrongEnough('a'.repeat(15))).toBe(false)
      expect(isConsentSecretStrongEnough('a'.repeat(16))).toBe(true)
    })

    it('rejects oversized tokens as malformed before any crypto work', async () => {
      const v = await verifyPrivacyConsentToken(SECRET, `k1.${'A'.repeat(5000)}.sig`)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.reason).toBe('malformed')
    })

    it('still verifies real tokens well below the length bound', async () => {
      const token = await createPrivacyConsentToken(SECRET, {
        siteId: 's1',
        decision: 'granted',
        policyHash: 'h',
        ioa: ['privacy_policy', 'terms']
      })
      expect(token.length).toBeLessThan(1024)
      const v = await verifyPrivacyConsentToken(SECRET, token)
      expect(v.ok).toBe(true)
    })
  })
})
