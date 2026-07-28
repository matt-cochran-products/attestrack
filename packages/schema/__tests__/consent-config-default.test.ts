import { describe, expect, it } from 'vitest'
import { COMMUNITY_DEFAULT_CONSENT_CONFIG } from '@attestrack/types'
import { consentConfigSchema } from '../src/jurisdiction.schema.js'

describe('consentConfigSchema', () => {
  it('accepts shipped community default config', () => {
    const parsed = consentConfigSchema.safeParse(COMMUNITY_DEFAULT_CONSENT_CONFIG)
    expect(parsed.success).toBe(true)
  })
})
