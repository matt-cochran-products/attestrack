import { z } from 'zod'
import { consentDecisionSchema } from './consent.schema.js'

export const trackingEventV1Schema = z.object({
  v: z.literal(1),
  eventName: z.string().min(1),
  siteId: z.string().min(1),
  occurredAt: z.string().datetime(),
  consentDecision: consentDecisionSchema.optional(),
  jurisdiction: z.string().nullable().optional()
})
