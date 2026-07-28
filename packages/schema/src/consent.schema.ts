import { z } from 'zod'

export const consentDecisionSchema = z.enum(['granted', 'declined', 'withdrawn'])

export const privacyConsentTokenPayloadV1Schema = z.object({
  v: z.literal(1),
  siteId: z.string().min(1),
  decision: consentDecisionSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  policyHash: z.string().min(1),
  jurisdictionHint: z.string().min(1).optional(),
  ioa: z.array(z.string().min(1)).optional()
})

export const consentCommitRequestSchema = z.object({
  siteId: z.string().min(1),
  decision: consentDecisionSchema,
  policyHash: z.string().min(1),
  jurisdictionHint: z.string().min(1).optional(),
  ioaAccepted: z.array(z.string().min(1)).optional()
})
