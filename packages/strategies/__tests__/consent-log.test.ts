import { describe, expect, it, vi } from 'vitest'
import { evidenceUnsignedStrategy } from '../src/mandatory/consent-log.js'
import { createMockHostRuntime } from '@attestrack/sdk'
import type { VerifiedPrivacyConsentToken } from '@attestrack/types'

const euRow = {
  profile: 'standard' as const,
  mechanism: 'opt-in' as const,
  ioa_assertions: [{ id: 'a', text: 't' }],
  documents: ['p'],
  gpc_honor: true
}

function grantedToken(overrides: Partial<VerifiedPrivacyConsentToken['payload']> = {}): VerifiedPrivacyConsentToken {
  return {
    raw: 'k1.cGF5bG9hZA.c2lnbmF0dXJl',
    payload: {
      v: 1,
      siteId: 's1',
      decision: 'granted',
      issuedAt: new Date().toISOString(),
      policyHash: 'h',
      ...overrides
    }
  }
}

describe('evidenceUnsignedStrategy', () => {
  it('writes a consent event record for an honored GPC signal', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    const ctx = {
      host,
      request: new Request('https://x/', { headers: { 'Sec-GPC': '1' } }),
      jurisdictionKey: 'EU',
      jurisdictionRow: euRow,
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
    expect(key).toContain('attestrack:consent_event:gpc:s1:EU:')
    const row = JSON.parse(value) as { gpcSignalHonored: boolean; siteId: string }
    expect(row.siteId).toBe('s1')
    expect(row.gpcSignalHonored).toBe(true)
  })

  describe('P7.1: KV write-amplification mitigation', () => {
    it('writes NOTHING for an anonymous request with no consent signal', async () => {
      const host = createMockHostRuntime()
      const put = vi.spyOn(host.kv, 'put')
      await evidenceUnsignedStrategy.run({
        host,
        request: new Request('https://x/'),
        jurisdictionKey: 'EU',
        jurisdictionRow: euRow,
        tracking: {
          v: 1 as const,
          eventName: 'pv',
          siteId: 's1',
          occurredAt: new Date().toISOString()
        }
      })
      expect(put).not.toHaveBeenCalled()
    })

    it('writes NOTHING when GPC is sent but the jurisdiction row does not honor it', async () => {
      const host = createMockHostRuntime()
      const put = vi.spyOn(host.kv, 'put')
      await evidenceUnsignedStrategy.run({
        host,
        request: new Request('https://x/', { headers: { 'Sec-GPC': '1' } }),
        jurisdictionKey: 'DEFAULT',
        jurisdictionRow: { ...euRow, gpc_honor: false }
      })
      expect(put).not.toHaveBeenCalled()
    })

    it('writes NOTHING on a bare request (no tracking, no token, no GPC) — unmatched-route flood', async () => {
      const host = createMockHostRuntime()
      const put = vi.spyOn(host.kv, 'put')
      await evidenceUnsignedStrategy.run({ host, request: new Request('https://x/wp-login.php') })
      expect(put).not.toHaveBeenCalled()
    })

    it('dedups token-backed records: same token presented twice writes once', async () => {
      const host = createMockHostRuntime()
      const put = vi.spyOn(host.kv, 'put')
      const ctx = {
        host,
        request: new Request('https://x/'),
        jurisdictionKey: 'EU',
        consent: grantedToken()
      }
      await evidenceUnsignedStrategy.run(ctx)
      await evidenceUnsignedStrategy.run(ctx)
      expect(put).toHaveBeenCalledTimes(1)
      const [key] = put.mock.calls[0] as [string]
      // Deterministic key: token signature segment + effective decision.
      expect(key).toBe('attestrack:consent_event:tok:c2lnbmF0dXJl:granted')
    })

    it('a decision change under the same token (GPC flip) writes a second, distinct record', async () => {
      const host = createMockHostRuntime()
      const put = vi.spyOn(host.kv, 'put')
      const base = {
        host,
        request: new Request('https://x/'),
        jurisdictionKey: 'EU',
        consent: grantedToken()
      }
      await evidenceUnsignedStrategy.run(base)
      await evidenceUnsignedStrategy.run({
        ...base,
        consentGate: {
          mode: 'ENFORCEMENT' as const,
          mechanism: 'opt-in' as const,
          tokenDecision: 'granted' as const,
          effectiveDecision: 'declined' as const,
          gpcApplied: true,
          wouldAllow: false,
          allowDestinations: false
        }
      })
      expect(put).toHaveBeenCalledTimes(2)
      const keys = put.mock.calls.map((c) => (c as [string])[0])
      expect(keys[0]).toBe('attestrack:consent_event:tok:c2lnbmF0dXJl:granted')
      expect(keys[1]).toBe('attestrack:consent_event:tok:c2lnbmF0dXJl:declined')
    })

    it('dedups token-less honored-GPC records to one per (site, jurisdiction, UTC day)', async () => {
      const host = createMockHostRuntime()
      const put = vi.spyOn(host.kv, 'put')
      const ctx = {
        host,
        request: new Request('https://x/', { headers: { 'Sec-GPC': '1' } }),
        jurisdictionKey: 'EU',
        jurisdictionRow: euRow,
        tracking: {
          v: 1 as const,
          eventName: 'pv',
          siteId: 's1',
          occurredAt: new Date().toISOString()
        }
      }
      await evidenceUnsignedStrategy.run(ctx)
      await evidenceUnsignedStrategy.run(ctx)
      await evidenceUnsignedStrategy.run(ctx)
      expect(put).toHaveBeenCalledTimes(1)
    })
  })

  it('P2.5: ioaAttested is false for a token WITHOUT accepted IOA assertions (not consent != null)', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/'),
      jurisdictionKey: 'EU',
      consent: grantedToken()
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
      consent: grantedToken({ ioa: ['privacy_policy'] })
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
      consent: grantedToken(),
      consentGate: {
        mode: 'ENFORCEMENT',
        mechanism: 'opt-out',
        tokenDecision: 'granted',
        effectiveDecision: 'granted',
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
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/'),
      consent: grantedToken()
    })
    const [, , opts] = put.mock.calls[0] as [string, string, { expirationTtl?: number }]
    expect(opts.expirationTtl).toBe(60 * 60 * 24 * 90)
  })
})
