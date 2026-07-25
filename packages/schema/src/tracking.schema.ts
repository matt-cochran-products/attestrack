import { z } from 'zod'
import { consentDecisionSchema } from './consent.schema.js'

export const trackingEventV1Schema = z.object({
  v: z.literal(1),
  eventName: z.string().min(1),
  siteId: z.string().min(1),
  occurredAt: z.string().datetime(),
  consentDecision: consentDecisionSchema.optional(),
  jurisdiction: z.string().nullable().optional(),

  // Consent-gate honesty fields (P2.3) — stamped server-side by the mandatory
  // consent strategy; harmless when clients send them, but the gate overwrites.
  consentMode: z.enum(['SHADOW', 'ENFORCEMENT']).optional(),
  consentMechanism: z.enum(['opt-in', 'opt-out']).optional(),
  consentWouldAllow: z.boolean().optional(),

  // High-level semantic-signal fields (optional). A tflo-captured event carries
  // the fields relevant to its signal — one rich record per real event, rather
  // than raw noise reverse-engineered later. These map 1:1 onto the ClickHouse
  // `tracking_events` columns (deploy/local/clickhouse-ddl.sql); the analytics
  // strategy forwards them verbatim, and zod strips anything not listed here so
  // the warehouse shape stays a closed contract.
  sessionId: z.string().optional(),
  pagePath: z.string().optional(),
  ctaType: z.string().optional(),
  scrollDepthPct: z.number().int().min(0).max(100).optional(),
  section: z.string().optional(),
  dwellMs: z.number().int().nonnegative().optional(),
  webVitalName: z.string().optional(),
  webVitalValue: z.number().optional(),
  params: z.string().optional()
})
