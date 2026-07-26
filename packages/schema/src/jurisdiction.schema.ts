import { z } from 'zod'

export const consentProfileSchema = z.enum(['standard', 'elevated'])

export const consentMechanismSchema = z.enum(['opt-in', 'opt-out'])

export const ioaAssertionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  required: z.boolean().optional()
})

export const jurisdictionConsentRowSchema = z.object({
  profile: consentProfileSchema,
  mechanism: consentMechanismSchema,
  ioa_assertions: z.array(ioaAssertionSchema).min(1),
  documents: z.array(z.string().min(1)),
  gpc_honor: z.boolean(),
  applies_regulations: z.array(z.string().min(1)).optional()
})

export const consentConfigSchema = z.object({
  jurisdictions: z.record(z.string().min(1), jurisdictionConsentRowSchema)
})

/**
 * Parse the operator `ConsentConfig` KV JSON, falling back to the given default
 * on missing/invalid content. Shared by the jurisdiction strategy and the
 * Worker `/consent/context` route so both resolve from the same document.
 */
export function parseConsentConfigJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = consentConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as T) : fallback
  } catch {
    return fallback
  }
}
