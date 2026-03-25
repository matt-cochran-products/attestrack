import { describe, expect, it } from 'vitest'
import { communityJurisdictionStrategy } from '../src/mandatory/jurisdiction.js'
import { createMockHostRuntime } from '@attestrue/sdk'
import { KV_KEY_CONSENT_CONFIG } from '@attestrue/types'

describe('communityJurisdictionStrategy', () => {
  it('uses DEFAULT when geo unknown', async () => {
    const host = createMockHostRuntime({ geoCountry: null })
    const ctx = { host, request: new Request('https://x/') }
    await communityJurisdictionStrategy.run(ctx)
    expect(ctx.jurisdictionKey).toBe('DEFAULT')
    expect(ctx.jurisdictionRow).toBeDefined()
  })

  it('maps DE to EU row when present in KV config', async () => {
    const host = createMockHostRuntime({ geoCountry: 'DE' })
    await host.kv.put(
      KV_KEY_CONSENT_CONFIG,
      JSON.stringify({
        jurisdictions: {
          EU: {
            profile: 'standard',
            mechanism: 'opt-in',
            ioa_assertions: [{ id: 'a', text: 't' }],
            documents: ['privacy_policy'],
            gpc_honor: true
          },
          DEFAULT: {
            profile: 'standard',
            mechanism: 'opt-out',
            ioa_assertions: [{ id: 'a', text: 't' }],
            documents: ['privacy_policy'],
            gpc_honor: true
          }
        }
      })
    )
    const ctx = { host, request: new Request('https://x/') }
    await communityJurisdictionStrategy.run(ctx)
    expect(ctx.jurisdictionKey).toBe('EU')
  })
})
