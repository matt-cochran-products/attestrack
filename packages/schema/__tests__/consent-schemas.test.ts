import { describe, expect, it } from 'vitest'
import {
  consentCommitRequestSchema,
  consentDecisionSchema,
  privacyConsentTokenPayloadV1Schema
} from '../src/consent.schema.js'
import { parseConsentConfigJson } from '../src/jurisdiction.schema.js'

const FALLBACK = { jurisdictions: {} }

describe('consent decision + commit request schemas (P2.2)', () => {
  it('accepts the three decisions and nothing else', () => {
    for (const d of ['granted', 'declined', 'withdrawn']) {
      expect(consentDecisionSchema.safeParse(d).success).toBe(true)
    }
    expect(consentDecisionSchema.safeParse('accepted').success).toBe(false)
    expect(consentDecisionSchema.safeParse('').success).toBe(false)
  })

  it('accepts a full commit request with optional IOA + jurisdiction hint', () => {
    const parsed = consentCommitRequestSchema.safeParse({
      siteId: 's1',
      decision: 'granted',
      policyHash: 'sha256:ab',
      jurisdictionHint: 'EU',
      ioaAccepted: ['primary']
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects commit requests missing siteId/policyHash or with empty IOA ids', () => {
    expect(
      consentCommitRequestSchema.safeParse({ decision: 'granted', policyHash: 'x' }).success
    ).toBe(false)
    expect(
      consentCommitRequestSchema.safeParse({ siteId: 's1', decision: 'granted' }).success
    ).toBe(false)
    expect(
      consentCommitRequestSchema.safeParse({
        siteId: 's1',
        decision: 'granted',
        policyHash: 'x',
        ioaAccepted: ['']
      }).success
    ).toBe(false)
  })

  it('validates token payload v1 (issuedAt datetime, literal v:1)', () => {
    const ok = privacyConsentTokenPayloadV1Schema.safeParse({
      v: 1,
      siteId: 's1',
      decision: 'declined',
      issuedAt: '2026-01-01T00:00:00.000Z',
      policyHash: 'sha256:ab'
    })
    expect(ok.success).toBe(true)
    const badVersion = privacyConsentTokenPayloadV1Schema.safeParse({
      v: 2,
      siteId: 's1',
      decision: 'declined',
      issuedAt: '2026-01-01T00:00:00.000Z',
      policyHash: 'sha256:ab'
    })
    expect(badVersion.success).toBe(false)
    const badDate = privacyConsentTokenPayloadV1Schema.safeParse({
      v: 1,
      siteId: 's1',
      decision: 'declined',
      issuedAt: 'yesterday',
      policyHash: 'sha256:ab'
    })
    expect(badDate.success).toBe(false)
  })
})

describe('parseConsentConfigJson (jurisdiction config KV document)', () => {
  const VALID = JSON.stringify({
    jurisdictions: {
      EU: {
        profile: 'standard',
        mechanism: 'opt-in',
        ioa_assertions: [{ id: 'primary', text: 'I consent.', required: true }],
        documents: ['privacy_policy'],
        gpc_honor: true
      }
    }
  })

  it('parses a valid config document', () => {
    const cfg = parseConsentConfigJson<{ jurisdictions: Record<string, unknown> }>(VALID, FALLBACK)
    expect(Object.keys(cfg.jurisdictions)).toEqual(['EU'])
  })

  it('falls back on null/empty/malformed JSON', () => {
    expect(parseConsentConfigJson(null, FALLBACK)).toBe(FALLBACK)
    expect(parseConsentConfigJson('', FALLBACK)).toBe(FALLBACK)
    expect(parseConsentConfigJson('{not json', FALLBACK)).toBe(FALLBACK)
  })

  it('falls back on schema-invalid documents (row missing gpc_honor)', () => {
    const invalid = JSON.stringify({
      jurisdictions: {
        EU: {
          profile: 'standard',
          mechanism: 'opt-in',
          ioa_assertions: [{ id: 'primary', text: 'I consent.' }],
          documents: ['privacy_policy']
        }
      }
    })
    expect(parseConsentConfigJson(invalid, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back on empty ioa_assertions (min 1 enforced)', () => {
    const invalid = JSON.stringify({
      jurisdictions: {
        EU: {
          profile: 'standard',
          mechanism: 'opt-in',
          ioa_assertions: [],
          documents: ['privacy_policy'],
          gpc_honor: true
        }
      }
    })
    expect(parseConsentConfigJson(invalid, FALLBACK)).toBe(FALLBACK)
  })
})
