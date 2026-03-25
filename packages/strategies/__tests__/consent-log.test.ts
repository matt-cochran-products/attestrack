import { describe, expect, it, vi } from 'vitest'
import { evidenceUnsignedStrategy } from '../src/mandatory/consent-log.js'
import { createMockHostRuntime } from '@attestrue/sdk'

describe('evidenceUnsignedStrategy', () => {
  it('writes consent event record to KV', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    const ctx = {
      host,
      request: new Request('https://x/', { headers: { 'Sec-GPC': '1' } }),
      jurisdictionKey: 'EU',
      jurisdictionRow: {
        profile: 'standard' as const,
        mechanism: 'opt-in' as const,
        ioa_assertions: [{ id: 'a', text: 't' }],
        documents: ['p'],
        gpc_honor: true
      },
      tracking: {
        v: 1 as const,
        eventName: 'pv',
        siteId: 's1',
        occurredAt: new Date().toISOString()
      }
    }
    await evidenceUnsignedStrategy.run(ctx)
    expect(put).toHaveBeenCalled()
    const [key, value] = put.mock.calls[0] as [string, string]
    expect(key).toContain('attestrack:consent_event:')
    const row = JSON.parse(value) as { gpcSignalHonored: boolean; siteId: string }
    expect(row.siteId).toBe('s1')
    expect(row.gpcSignalHonored).toBe(true)
  })
})
