import { z } from 'zod'

export const consentEventRecordV1Schema = z.object({
  v: z.literal(1),
  recordedAt: z.string().min(1),
  siteId: z.string().min(1),
  decision: z.enum(['granted', 'declined', 'withdrawn']),
  jurisdictionKey: z.string().min(1),
  policyHash: z.string().min(1),
  ioaAttested: z.boolean(),
  gpcSignalHonored: z.boolean(),
  configFingerprint: z.string().min(1).optional()
})
