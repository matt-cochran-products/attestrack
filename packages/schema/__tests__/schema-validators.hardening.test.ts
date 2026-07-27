import { describe, expect, it } from 'vitest'
import { privacyConsentTokenPayloadV1Schema } from '../src/consent.schema.js'
import { consentEventRecordV1Schema } from '../src/consent-event-record.schema.js'
import { ioaAssertionSchema, jurisdictionConsentRowSchema } from '../src/jurisdiction.schema.js'
import {
  SAVED_QUERIES_MAX_ENTRIES,
  savedQueryChartConfigSchema,
  savedQueriesKvSchema
} from '../src/portal-saved-queries.schema.js'
import { strategyManifestSchema, strategyStageSchema } from '../src/strategy.schema.js'
import { trackingEventV1Schema } from '../src/tracking.schema.js'

/**
 * Mutation-hardening tests (Stryker, stryker.schemas.conf.json). Each block
 * pins boundaries the baseline suite left unpinned — enum membership, min/max
 * string+number bounds, literal versions — so `min↔max`, enum-member and
 * object-shape mutants die instead of surviving.
 */

const validTracking = {
  v: 1,
  eventName: 'page_view',
  siteId: 'site-1',
  occurredAt: '2026-07-25T10:00:00.000Z'
}

describe('trackingEventV1Schema hardening', () => {
  it('accepts a minimal valid v1 event', () => {
    expect(trackingEventV1Schema.safeParse(validTracking).success).toBe(true)
  })

  it('rejects wrong version literal, empty required strings, and bad datetimes', () => {
    expect(trackingEventV1Schema.safeParse({ ...validTracking, v: 2 }).success).toBe(false)
    expect(trackingEventV1Schema.safeParse({ ...validTracking, eventName: '' }).success).toBe(false)
    expect(trackingEventV1Schema.safeParse({ ...validTracking, siteId: '' }).success).toBe(false)
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, occurredAt: 'yesterday' }).success
    ).toBe(false)
  })

  it('accepts every consentDecision / consentMode / consentMechanism member and rejects non-members', () => {
    for (const consentDecision of ['granted', 'declined', 'withdrawn']) {
      expect(trackingEventV1Schema.safeParse({ ...validTracking, consentDecision }).success).toBe(true)
    }
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, consentDecision: 'accepted' }).success
    ).toBe(false)
    for (const consentMode of ['SHADOW', 'ENFORCEMENT']) {
      expect(trackingEventV1Schema.safeParse({ ...validTracking, consentMode }).success).toBe(true)
    }
    expect(trackingEventV1Schema.safeParse({ ...validTracking, consentMode: 'AUDIT' }).success).toBe(
      false
    )
    for (const consentMechanism of ['opt-in', 'opt-out']) {
      expect(
        trackingEventV1Schema.safeParse({ ...validTracking, consentMechanism }).success
      ).toBe(true)
    }
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, consentMechanism: 'implied' }).success
    ).toBe(false)
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, consentWouldAllow: true }).success
    ).toBe(true)
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, consentWouldAllow: 'yes' }).success
    ).toBe(false)
  })

  it('accepts every userAgentClass bucket and rejects unknown buckets', () => {
    for (const userAgentClass of ['desktop', 'mobile', 'tablet', 'bot', 'other']) {
      expect(
        trackingEventV1Schema.safeParse({ ...validTracking, userAgentClass }).success
      ).toBe(true)
    }
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, userAgentClass: 'browser' }).success
    ).toBe(false)
    // The raw UA string must never be accepted as a class.
    expect(
      trackingEventV1Schema.safeParse({ ...validTracking, userAgentClass: 'Mozilla/5.0' }).success
    ).toBe(false)
  })

  it('bounds scrollDepthPct to integer 0..100 (both edges inclusive, midpoint valid)', () => {
    for (const scrollDepthPct of [0, 50, 100]) {
      expect(
        trackingEventV1Schema.safeParse({ ...validTracking, scrollDepthPct }).success
      ).toBe(true)
    }
    for (const scrollDepthPct of [-1, 101, 49.5]) {
      expect(
        trackingEventV1Schema.safeParse({ ...validTracking, scrollDepthPct }).success
      ).toBe(false)
    }
  })

  it('bounds dwellMs to nonnegative integers', () => {
    expect(trackingEventV1Schema.safeParse({ ...validTracking, dwellMs: 0 }).success).toBe(true)
    expect(trackingEventV1Schema.safeParse({ ...validTracking, dwellMs: 1200 }).success).toBe(true)
    expect(trackingEventV1Schema.safeParse({ ...validTracking, dwellMs: -1 }).success).toBe(false)
    expect(trackingEventV1Schema.safeParse({ ...validTracking, dwellMs: 3.5 }).success).toBe(false)
  })

  it('keeps the attribution/identity spine optional but typed', () => {
    const full = trackingEventV1Schema.safeParse({
      ...validTracking,
      jurisdiction: null,
      sessionId: 'sess-1',
      pagePath: '/pricing',
      ctaType: 'signup',
      section: 'hero',
      webVitalName: 'LCP',
      webVitalValue: 1234.5,
      params: '{"a":1}',
      visitorId: 'v-abc',
      eventId: 'evt-1',
      referrer: 'https://example.com/',
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'launch',
      utmTerm: 'attest',
      utmContent: 'cta-a'
    })
    expect(full.success).toBe(true)
    expect(trackingEventV1Schema.safeParse({ ...validTracking, webVitalValue: 'fast' }).success).toBe(
      false
    )
  })
})

const validRecord = {
  v: 1,
  recordedAt: '2026-07-25T10:00:00.000Z',
  siteId: 'site-1',
  decision: 'granted',
  jurisdictionKey: 'EU',
  policyHash: 'sha256:ab',
  ioaAttested: true,
  gpcSignalHonored: false
}

describe('consentEventRecordV1Schema hardening', () => {
  it('accepts a valid record, with and without the optional gate fields', () => {
    expect(consentEventRecordV1Schema.safeParse(validRecord).success).toBe(true)
    expect(
      consentEventRecordV1Schema.safeParse({
        ...validRecord,
        mechanism: 'opt-in',
        mode: 'SHADOW',
        configFingerprint: 'EU'
      }).success
    ).toBe(true)
  })

  it('pins the version literal and enum memberships', () => {
    expect(consentEventRecordV1Schema.safeParse({ ...validRecord, v: 2 }).success).toBe(false)
    for (const decision of ['granted', 'declined', 'withdrawn']) {
      expect(consentEventRecordV1Schema.safeParse({ ...validRecord, decision }).success).toBe(true)
    }
    expect(consentEventRecordV1Schema.safeParse({ ...validRecord, decision: 'revoked' }).success).toBe(
      false
    )
    for (const mechanism of ['opt-in', 'opt-out']) {
      expect(consentEventRecordV1Schema.safeParse({ ...validRecord, mechanism }).success).toBe(true)
    }
    expect(
      consentEventRecordV1Schema.safeParse({ ...validRecord, mechanism: 'implied' }).success
    ).toBe(false)
    for (const mode of ['SHADOW', 'ENFORCEMENT']) {
      expect(consentEventRecordV1Schema.safeParse({ ...validRecord, mode }).success).toBe(true)
    }
    expect(consentEventRecordV1Schema.safeParse({ ...validRecord, mode: 'AUDIT' }).success).toBe(false)
  })

  it('rejects empty required strings and missing booleans', () => {
    for (const key of ['recordedAt', 'siteId', 'jurisdictionKey', 'policyHash'] as const) {
      expect(consentEventRecordV1Schema.safeParse({ ...validRecord, [key]: '' }).success).toBe(false)
    }
    expect(
      consentEventRecordV1Schema.safeParse({ ...validRecord, configFingerprint: '' }).success
    ).toBe(false)
    const { ioaAttested: _drop, ...noAttested } = validRecord
    expect(consentEventRecordV1Schema.safeParse(noAttested).success).toBe(false)
    expect(
      consentEventRecordV1Schema.safeParse({ ...validRecord, gpcSignalHonored: 'yes' }).success
    ).toBe(false)
  })
})

describe('strategyManifestSchema hardening', () => {
  const manifest = { id: 'jurisdiction', stage: 'mandatory', displayName: 'Jurisdiction resolution' }

  it('accepts each pipeline stage and rejects unknown stages', () => {
    for (const stage of ['mandatory', 'destination', 'analytics']) {
      expect(strategyStageSchema.safeParse(stage).success).toBe(true)
      expect(strategyManifestSchema.safeParse({ ...manifest, stage }).success).toBe(true)
    }
    expect(strategyStageSchema.safeParse('extension').success).toBe(false)
    expect(strategyManifestSchema.safeParse({ ...manifest, stage: 'extension' }).success).toBe(false)
  })

  it('rejects empty id/displayName and empty replaces ids', () => {
    expect(strategyManifestSchema.safeParse({ ...manifest, id: '' }).success).toBe(false)
    expect(strategyManifestSchema.safeParse({ ...manifest, displayName: '' }).success).toBe(false)
    expect(strategyManifestSchema.safeParse({ ...manifest, replaces: [''] }).success).toBe(false)
    expect(
      strategyManifestSchema.safeParse({ ...manifest, replaces: ['jurisdiction'], defaultEnabled: true })
        .success
    ).toBe(true)
  })
})

describe('token payload optional-field bounds (survivor killers)', () => {
  const payload = {
    v: 1,
    siteId: 's1',
    decision: 'granted',
    issuedAt: '2026-01-01T00:00:00.000Z',
    policyHash: 'sha256:ab'
  }

  it('jurisdictionHint: multi-char accepted, empty rejected (min(1), not max(1))', () => {
    expect(
      privacyConsentTokenPayloadV1Schema.safeParse({ ...payload, jurisdictionHint: 'EU' }).success
    ).toBe(true)
    expect(
      privacyConsentTokenPayloadV1Schema.safeParse({ ...payload, jurisdictionHint: '' }).success
    ).toBe(false)
  })

  it('ioa: multi-char ids accepted, empty ids rejected', () => {
    expect(
      privacyConsentTokenPayloadV1Schema.safeParse({ ...payload, ioa: ['privacy_policy'] }).success
    ).toBe(true)
    expect(privacyConsentTokenPayloadV1Schema.safeParse({ ...payload, ioa: [''] }).success).toBe(false)
  })
})

describe('ioaAssertionSchema shape is closed over id/text (survivor killers)', () => {
  it('requires non-empty id AND text — a bare object must not validate', () => {
    expect(ioaAssertionSchema.safeParse({ id: 'primary', text: 'I consent.' }).success).toBe(true)
    expect(ioaAssertionSchema.safeParse({}).success).toBe(false)
    expect(ioaAssertionSchema.safeParse({ text: 'I consent.' }).success).toBe(false)
    expect(ioaAssertionSchema.safeParse({ id: 'primary' }).success).toBe(false)
    expect(ioaAssertionSchema.safeParse({ id: '', text: 'I consent.' }).success).toBe(false)
    expect(ioaAssertionSchema.safeParse({ id: 'primary', text: '' }).success).toBe(false)
  })

  it('a jurisdiction row with a shapeless assertion must not validate', () => {
    const row = {
      profile: 'standard',
      mechanism: 'opt-in',
      ioa_assertions: [{ anything: true }],
      documents: ['privacy_policy'],
      gpc_honor: true
    }
    expect(jurisdictionConsentRowSchema.safeParse(row).success).toBe(false)
  })
})

describe('saved-query chart config + KV list bounds (survivor killers)', () => {
  it('x/y/value columns: normal names accepted, empty rejected, >200 chars rejected', () => {
    const base = { chartType: 'line' }
    for (const key of ['xColumn', 'yColumn', 'valueColumn'] as const) {
      expect(savedQueryChartConfigSchema.safeParse({ ...base, [key]: 'day_bucket' }).success).toBe(
        true
      )
      expect(savedQueryChartConfigSchema.safeParse({ ...base, [key]: '' }).success).toBe(false)
      expect(
        savedQueryChartConfigSchema.safeParse({ ...base, [key]: 'c'.repeat(201) }).success
      ).toBe(false)
    }
  })

  it('savedQueriesKvSchema: small lists valid (max cap, not a min), cap+1 rejected', () => {
    const entry = {
      id: 'q1',
      name: 'n',
      sql: 'SELECT 1',
      updatedAt: '2026-07-25T00:00:00.000Z'
    }
    expect(savedQueriesKvSchema.safeParse([entry]).success).toBe(true)
    const over = Array.from({ length: SAVED_QUERIES_MAX_ENTRIES + 1 }, (_, i) => ({
      ...entry,
      id: `q${i}`
    }))
    expect(savedQueriesKvSchema.safeParse(over).success).toBe(false)
  })
})
