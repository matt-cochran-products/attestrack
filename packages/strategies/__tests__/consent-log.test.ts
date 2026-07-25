import { describe, expect, it, vi } from 'vitest'
import { evidenceUnsignedStrategy } from '../src/mandatory/consent-log.js'
import { createMockHostRuntime } from '@attestrack/sdk'

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

  it('P2.5: ioaAttested is false for a token WITHOUT accepted IOA assertions (not consent != null)', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/'),
      jurisdictionKey: 'EU',
      consent: {
        raw: 't',
        payload: {
          v: 1,
          siteId: 's1',
          decision: 'granted',
          issuedAt: new Date().toISOString(),
          policyHash: 'h'
        }
      }
    })
    const [, value] = put.mock.calls[0] as [string, string]
    const row = JSON.parse(value) as { ioaAttested: boolean }
    expect(row.ioaAttested).toBe(false)
  })

  it('P2.5: ioaAttested is true only when the token carries accepted IOA ids', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/'),
      jurisdictionKey: 'EU',
      consent: {
        raw: 't',
        payload: {
          v: 1,
          siteId: 's1',
          decision: 'granted',
          issuedAt: new Date().toISOString(),
          policyHash: 'h',
          ioa: ['privacy_policy']
        }
      }
    })
    const [, value] = put.mock.calls[0] as [string, string]
    const row = JSON.parse(value) as { ioaAttested: boolean }
    expect(row.ioaAttested).toBe(true)
  })

  it('P2.5: records mechanism + mode from the consent gate and honors the operator TTL', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/'),
      jurisdictionKey: 'DEFAULT',
      site: { mode: 'ENFORCEMENT', consentEventTtlSeconds: 3600 },
      consentGate: {
        mode: 'ENFORCEMENT',
        mechanism: 'opt-out',
        tokenDecision: null,
        effectiveDecision: null,
        gpcApplied: false,
        wouldAllow: true,
        allowDestinations: true
      }
    })
    const [, value, opts] = put.mock.calls[0] as [string, string, { expirationTtl?: number }]
    const row = JSON.parse(value) as { mechanism?: string; mode?: string }
    expect(row.mechanism).toBe('opt-out')
    expect(row.mode).toBe('ENFORCEMENT')
    expect(opts.expirationTtl).toBe(3600)
  })

  it('P2.5: defaults the record TTL to 90 days when the operator has not configured one', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({ host, request: new Request('https://x/') })
    const [, , opts] = put.mock.calls[0] as [string, string, { expirationTtl?: number }]
    expect(opts.expirationTtl).toBe(60 * 60 * 24 * 90)
  })
})
