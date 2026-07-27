import { describe, expect, it } from 'vitest'
import { destinationsAllowed, evaluateConsentGate } from '../src/consent-gate.js'
import {
  createPrivacyConsentToken,
  keyringFromSecretValues,
  parseConsentSecretValue,
  verifyPrivacyConsentToken
} from '../src/consent-token.js'
import { headerValue } from '../src/helpers.js'

const SECRET = 'mutation-hardening-secret-32ch!!'
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const te = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

/** Sign `k1.<payloadPart>` exactly like the minter, for forged-payload tests. */
async function signPart(secret: string, payloadPart: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(`k1.${payloadPart}`)))
  return b64url(sig)
}

/**
 * Mutation-hardening suite (Stryker, stryker.conf.json): pins the exact
 * failure REASON per rejection path, the key-id grammar, keyring merge rules,
 * base64url canonicality/padding and the timing-safe compare's length binding —
 * the mutants a plain ok/notOk assertion lets survive.
 */
describe('consent-gate mutation hardening', () => {
  it('no jurisdiction row: GPC signal alone must NOT downgrade the decision', () => {
    const gate = evaluateConsentGate({
      mode: 'ENFORCEMENT',
      row: null,
      tokenDecision: 'granted',
      gpcSignal: true
    })
    // Absent row → gpc_honor defaults FALSE (no honoring without config).
    expect(gate.gpcApplied).toBe(false)
    expect(gate.effectiveDecision).toBe('granted')
    expect(gate.allowDestinations).toBe(true)
  })

  it('row without explicit honoring keeps GPC un-applied even mid-signal', () => {
    const gate = evaluateConsentGate({
      mode: 'ENFORCEMENT',
      row: undefined,
      tokenDecision: null,
      gpcSignal: true
    })
    expect(gate.gpcApplied).toBe(false)
    expect(gate.mechanism).toBe('opt-in')
  })

  it('P3.4: bot-flagged traffic never fires destinations, even when the gate allows', () => {
    expect(
      destinationsAllowed({
        botDetection: { isBot: true, reasons: ['bot_user_agent'] },
        consentGate: {
          mode: 'SHADOW',
          mechanism: 'opt-in',
          tokenDecision: null,
          effectiveDecision: null,
          gpcApplied: false,
          wouldAllow: false,
          allowDestinations: true
        }
      })
    ).toBe(false)
  })

  it('non-bot detection result leaves the gate decision in charge', () => {
    expect(
      destinationsAllowed({
        botDetection: { isBot: false, reasons: [] },
        consentGate: {
          mode: 'ENFORCEMENT',
          mechanism: 'opt-in',
          tokenDecision: 'granted',
          effectiveDecision: 'granted',
          gpcApplied: false,
          wouldAllow: true,
          allowDestinations: true
        }
      })
    ).toBe(true)
  })
})

describe('key-id grammar (KEY_ID_PATTERN is fully anchored, multi-digit)', () => {
  it('mints and verifies under a multi-digit key id (k12)', async () => {
    const keyring = { keys: { k12: SECRET }, currentKeyId: 'k12' }
    const token = await createPrivacyConsentToken(keyring, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'h'
    })
    expect(token.startsWith('k12.')).toBe(true)
    const v = await verifyPrivacyConsentToken(keyring, token)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.keyId).toBe('k12')
  })

  it('rejects key ids with a leading prefix as malformed (anchored start)', async () => {
    const v = await verifyPrivacyConsentToken(SECRET, 'xk1.AAAA.AAAA')
    expect(v).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects key ids with a trailing suffix as malformed (anchored end)', async () => {
    const v = await verifyPrivacyConsentToken(SECRET, 'k1x.AAAA.AAAA')
    expect(v).toEqual({ ok: false, reason: 'malformed' })
  })

  it('mint refuses an invalid current key id with a diagnostic message', async () => {
    await expect(
      createPrivacyConsentToken(
        { keys: { bad: SECRET }, currentKeyId: 'bad' },
        { siteId: 's1', decision: 'granted', policyHash: 'h' }
      )
    ).rejects.toThrow(/invalid consent key id: bad/)
  })

  it('mint refuses a keyring missing its current key with a diagnostic message', async () => {
    await expect(
      createPrivacyConsentToken(
        { keys: { k1: SECRET }, currentKeyId: 'k5' },
        { siteId: 's1', decision: 'granted', policyHash: 'h' }
      )
    ).rejects.toThrow(/consent keyring missing current key: k5/)
  })
})

describe('secret-value parsing + keyring merge', () => {
  it('the k<N>. prefix must sit at the START of the value', () => {
    expect(parseConsentSecretValue('prefix-k2.secret')).toEqual({
      keyId: 'k1',
      secret: 'prefix-k2.secret'
    })
  })

  it('parses multi-digit key ids in secret values', () => {
    expect(parseConsentSecretValue('k12.secret')).toEqual({ keyId: 'k12', secret: 'secret' })
  })

  it('absent previous secrets add NO keys at all (no phantom k1 entry)', () => {
    expect(keyringFromSecretValues('k2.current-secret', undefined)).toStrictEqual({
      keys: { k2: 'current-secret' },
      currentKeyId: 'k2'
    })
  })

  it('a previous value must never overwrite the current secret for the same key id', () => {
    const keyring = keyringFromSecretValues('k1.new-secret', 'k1.old-secret')
    expect(keyring.keys.k1).toBe('new-secret')
  })
})

describe('token wire format: strictly base64url, no padding, all payload sizes', () => {
  // Varying siteId length sweeps payload byte length across all mod-3 classes,
  // so both '=' and '==' padding cases hit the strip + re-pad code paths.
  for (const siteId of ['a', 'ab', 'abc']) {
    it(`token for siteId '${siteId}' is padless base64url and round-trips`, async () => {
      const token = await createPrivacyConsentToken(SECRET, {
        siteId,
        decision: 'granted',
        policyHash: 'h'
      })
      expect(token).toMatch(/^k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
      expect(token).not.toContain('=')
      const v = await verifyPrivacyConsentToken(SECRET, token, { expectedSiteId: siteId })
      expect(v.ok).toBe(true)
    })
  }
})

describe('verify: exact rejection reason per path', () => {
  it('empty payload segment → malformed (never reaches signature checking)', async () => {
    const v = await verifyPrivacyConsentToken(SECRET, 'k1..AAAA')
    expect(v).toEqual({ ok: false, reason: 'malformed' })
  })

  it('empty signature segment → malformed', async () => {
    const v = await verifyPrivacyConsentToken(SECRET, 'k1.AAAA.')
    expect(v).toEqual({ ok: false, reason: 'malformed' })
  })

  it('non-base64url characters in the signature → non_canonical', async () => {
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'h'
    })
    const [keyId, payloadPart] = token.split('.')
    const v = await verifyPrivacyConsentToken(SECRET, `${keyId}.${payloadPart}.ab!c`)
    expect(v).toEqual({ ok: false, reason: 'non_canonical' })
  })

  it('trailing-bit sibling of the final sig char (same bytes, different string) → non_canonical', async () => {
    // base64url has 2 don’t-care bits in the final char of a 32-byte HMAC:
    // flipping the low bit yields a DIFFERENT string decoding to IDENTICAL
    // bytes. The signature still matches — only canonicality can reject it.
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'h'
    })
    const lastChar = token[token.length - 1]!
    const idx = B64URL_ALPHABET.indexOf(lastChar)
    const sibling = B64URL_ALPHABET[idx ^ 1]!
    const malleated = token.slice(0, -1) + sibling
    expect(malleated).not.toBe(token)
    const v = await verifyPrivacyConsentToken(SECRET, malleated)
    expect(v).toEqual({ ok: false, reason: 'non_canonical' })
  })

  it('signature with trailing extra bytes → bad_signature (length is part of equality)', async () => {
    const token = await createPrivacyConsentToken(SECRET, {
      siteId: 's1',
      decision: 'granted',
      policyHash: 'h'
    })
    // Appending 'AAAA' appends three 0x00 bytes to the decoded signature while
    // keeping it canonical base64url; a prefix-only compare would accept it.
    const v = await verifyPrivacyConsentToken(SECRET, `${token}AAAA`)
    expect(v).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('correctly signed non-JSON payload → invalid_json', async () => {
    const payloadPart = b64url(te.encode('this is not json'))
    const sigPart = await signPart(SECRET, payloadPart)
    const v = await verifyPrivacyConsentToken(SECRET, `k1.${payloadPart}.${sigPart}`)
    expect(v).toEqual({ ok: false, reason: 'invalid_json' })
  })

  it('correctly signed, canonical, schema-invalid payload → invalid_payload', async () => {
    const payloadPart = b64url(te.encode('{"v":2}'))
    const sigPart = await signPart(SECRET, payloadPart)
    const v = await verifyPrivacyConsentToken(SECRET, `k1.${payloadPart}.${sigPart}`)
    expect(v).toEqual({ ok: false, reason: 'invalid_payload' })
  })

  it('length bound is exclusive: exactly 4096 chars still reaches key resolution', async () => {
    // 'k9.' + 2048 + '.' + 2044 = 4096 chars, both segments canonical ('AAAA'
    // runs decode to zero bytes). At the bound the KEY lookup must fire
    // (unknown_key), not the length rejection; one char more is malformed.
    const atBound = `k9.${'A'.repeat(2048)}.${'A'.repeat(2044)}`
    expect(atBound.length).toBe(4096)
    const v = await verifyPrivacyConsentToken(SECRET, atBound)
    expect(v).toEqual({ ok: false, reason: 'unknown_key' })
    const overBound = `k9.${'A'.repeat(2048)}.${'A'.repeat(2045)}`
    expect(overBound.length).toBe(4097)
    const w = await verifyPrivacyConsentToken(SECRET, overBound)
    expect(w).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('helpers', () => {
  it('headerValue reads a header case-insensitively and returns null when absent', () => {
    const headers = new Headers({ 'X-Custom': 'yes' })
    expect(headerValue(headers, 'x-custom')).toBe('yes')
    expect(headerValue(headers, 'x-missing')).toBeNull()
  })
})
