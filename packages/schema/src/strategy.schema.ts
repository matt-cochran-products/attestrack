import { z } from 'zod'

export const strategyStageSchema = z.enum(['mandatory', 'destination', 'analytics'])

export const strategyManifestSchema = z.object({
  id: z.string().min(1),
  stage: strategyStageSchema,
  displayName: z.string().min(1),
  defaultEnabled: z.boolean().optional(),
  replaces: z.array(z.string().min(1)).optional()
})
