import { describe, expect, it, vi } from 'vitest'
import { createMockHostRuntime, createPrivacyConsentToken } from '@attestrack/sdk'
import type { HostRuntime } from '@attestrack/host-contracts'
import { COMMUNITY_DEFAULT_CONSENT_CONFIG, KV_KEY_CONSENT_CONFIG } from '@attestrack/types'
import {
  communityConsentStrategyManifest,
  createConsentCookieStrategy,
  defaultCommunityStrategies
} from '../src/mandatory/consent.js'
import { evidenceUnsignedStrategy, evidenceUnsignedStrategyManifest } from '../src/mandatory/consent-log.js'
import {
  communityJurisdictionStrategy,
  communityJurisdictionStrategyManifest
} from '../src/mandatory/jurisdiction.js'
import {
  BOT_SCORE_THRESHOLD,
  communityTrollShieldStrategy,
  communityTrollShieldStrategyManifest,
  evaluateBotHeuristics
} from '../src/mandatory/troll-shield.js'

/**
 * Mutation-hardening suite (Stryker) for the mandatory consent pipeline:
 * cookie parsing, GPC override semantics, key rotation, site binding,
 * tracking stamping, jurisdiction row fallbacks, troll-shield boundaries and
 * the consent-log fallback chains — with strict result-shape assertions so
 * `return {}` / `continuePipeline:false` mutants die.
 */

const SECRET = 'mandatory-hardening-secret-32c!!'

const euRow = {
  profile: 'standard' as const,
  mechanism: 'opt-in' as const,
  ioa_assertions: [{ id: 'a', text: 't' }],
  documents: ['privacy_policy'],
  gpc_honor: true
}

async function mintToken(overrides: Partial<{ siteId: string; decision: 'granted' | 'declined' | 'withdrawn' }> = {}, secret = SECRET) {
  return createPrivacyConsentToken(secret, {
    siteId: overrides.siteId ?? 'site-1',
    decision: overrides.decision ?? 'granted',
    policyHash: 'sha256:abc'
  })
}

function hostWithSecret(secrets: Record<string, string> = { CONSENT_TOKEN_SECRET: SECRET }) {
  return createMockHostRuntime({ secrets })
}

const baseTracking = {
  v: 1 as const,
  eventName: 'pv',
  siteId: 'site-1',
  occurredAt: '2026-07-25T10:00:00.000Z'
}

describe('consent cookie strategy — manifests + defaults', () => {
  it('exposes the exact strategy identity and manifest', () => {
    const s = createConsentCookieStrategy('CONSENT_TOKEN_SECRET')
    expect(s.id).toBe('consent')
    expect(s.stage).toBe('mandatory')
    expect(s.manifest).toBe(communityConsentStrategyManifest)
    expect(communityConsentStrategyManifest).toEqual({
      id: 'consent',
      stage: 'mandatory',
      displayName: 'Privacy consent gate (community)'
    })
  })

  it('defaultCommunityStrategies wires the documented stage-1 order and default secret name', async () => {
    const strategies = defaultCommunityStrategies()
    expect(strategies.map((s) => s.id)).toEqual([
      'jurisdiction',
      'consent',
      'evidence-unsigned',
      'troll-shield'
    ])
    // Default env name CONSENT_TOKEN_SECRET actually verifies a cookie.
    const token = await mintToken()
    const host = hostWithSecret()
    const res = await strategies[1]!.run({
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
      })
    } as never)
    expect(res.consent?.payload.decision).toBe('granted')
  })
})

describe('consent cookie strategy — cookie parsing', () => {
  it('handles requests with no cookie header at all (no throw, no consent)', async () => {
    const host = hostWithSecret()
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/')
    } as never)
    expect(res.continuePipeline).toBe(true)
    expect(res.consent).toBeNull()
  })

  it('finds at_consent among other cookies, with surrounding whitespace, skipping =-less parts', async () => {
    const token = await mintToken()
    const host = hostWithSecret()
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/', {
        headers: {
          cookie: `other=zzz; at_consentX; at_consent = ${encodeURIComponent(token)} ; later=1`
        }
      })
    } as never)
    expect(res.consent?.payload.decision).toBe('granted')
  })

  it('yields null consent when the cookie is present but no secret is configured', async () => {
    const token = await mintToken()
    const host = createMockHostRuntime({ secrets: {} })
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
      })
    } as never)
    expect(res.consent).toBeNull()
  })
})

describe('consent cookie strategy — verification semantics', () => {
  it('verifies tokens signed under the _PREVIOUS secret (rotation window)', async () => {
    const oldToken = await createPrivacyConsentToken('k1.old-secret-32-bytes-long-ok!!!'.slice(3), {
      siteId: 'site-1',
      decision: 'granted',
      policyHash: 'h'
    })
    const host = createMockHostRuntime({
      secrets: {
        CONSENT_TOKEN_SECRET: 'k2.new-secret-32-bytes-long-ok!!!'.slice(0),
        CONSENT_TOKEN_SECRET_PREVIOUS: `k1.${'old-secret-32-bytes-long-ok!!!'}`
      }
    })
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(oldToken)}` }
      })
    } as never)
    expect(res.consent?.payload.decision).toBe('granted')
  })

  it('binds tokens to the site: a token for another siteId is rejected', async () => {
    const token = await mintToken({ siteId: 'site-B' })
    const host = hostWithSecret()
    const ctx = {
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
      }),
      site: { mode: 'ENFORCEMENT' as const, siteId: 'site-A', domain: 'x' }
    }
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run(ctx as never)
    expect(res.consent).toBeNull()

    // Same-site token verifies.
    const own = await mintToken({ siteId: 'site-A' })
    const res2 = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      ...ctx,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(own)}` }
      })
    } as never)
    expect(res2.consent?.payload.decision).toBe('granted')
  })

  it('GPC requires the exact Sec-GPC: 1 header value', async () => {
    const token = await mintToken()
    const host = hostWithSecret()
    const strat = createConsentCookieStrategy('CONSENT_TOKEN_SECRET')
    const noGpc = {
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
      }),
      jurisdictionRow: euRow
    }
    const resNo = await strat.run(noGpc as never)
    expect((noGpc as { consentGate?: { gpcApplied: boolean } }).consentGate?.gpcApplied).toBe(false)
    expect(resNo.consent?.payload.decision).toBe('granted')

    const wrongValue = {
      ...noGpc,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}`, 'Sec-GPC': '0' }
      })
    }
    const resWrong = await strat.run(wrongValue as never)
    expect((wrongValue as { consentGate?: { gpcApplied: boolean } }).consentGate?.gpcApplied).toBe(false)
    expect(resWrong.consent?.payload.decision).toBe('granted')
  })

  it('GPC override rewrites ONLY granted tokens; withdrawn stays withdrawn', async () => {
    const withdrawn = await mintToken({ decision: 'withdrawn' })
    const host = hostWithSecret()
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(withdrawn)}`, 'Sec-GPC': '1' }
      }),
      jurisdictionRow: euRow
    } as never)
    expect(res.consent?.payload.decision).toBe('withdrawn')
  })

  it('defaults the gate mode to SHADOW when no site info is present', async () => {
    const host = hostWithSecret()
    const ctx = { host, request: new Request('https://x/') }
    await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run(ctx as never)
    const gate = (ctx as { consentGate?: { mode: string } }).consentGate
    expect(gate?.mode).toBe('SHADOW')
  })
})

describe('consent cookie strategy — tracking stamping', () => {
  it('stamps decision, jurisdiction, mode, mechanism and would-allow onto the tracking row', async () => {
    const token = await mintToken()
    const host = hostWithSecret()
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/', {
        headers: { cookie: `at_consent=${encodeURIComponent(token)}` }
      }),
      jurisdictionRow: euRow,
      jurisdictionKey: 'EU',
      tracking: baseTracking
    } as never)
    expect(res.tracking).toStrictEqual({
      ...baseTracking,
      consentDecision: 'granted',
      jurisdiction: 'EU',
      consentMode: 'SHADOW',
      consentMechanism: 'opt-in',
      consentWouldAllow: true
    })
  })

  it('omits consentDecision/jurisdiction keys when there is no decision and no jurisdiction', async () => {
    const host = hostWithSecret()
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/'),
      tracking: baseTracking
    } as never)
    expect(res.tracking).toStrictEqual({
      ...baseTracking,
      consentMode: 'SHADOW',
      consentMechanism: 'opt-in',
      consentWouldAllow: false
    })
    expect(res.continuePipeline).toBe(true)
  })

  it('returns no tracking key at all when the pipeline has no tracking event', async () => {
    const host = hostWithSecret()
    const res = await createConsentCookieStrategy('CONSENT_TOKEN_SECRET').run({
      host,
      request: new Request('https://x/')
    } as never)
    expect(res).toStrictEqual({ continuePipeline: true, consent: null })
  })
})

describe('jurisdiction strategy hardening', () => {
  it('exposes the exact strategy identity and manifest', () => {
    expect(communityJurisdictionStrategy.id).toBe('jurisdiction')
    expect(communityJurisdictionStrategy.stage).toBe('mandatory')
    expect(communityJurisdictionStrategy.manifest).toBe(communityJurisdictionStrategyManifest)
    expect(communityJurisdictionStrategyManifest).toEqual({
      id: 'jurisdiction',
      stage: 'mandatory',
      displayName: 'Jurisdiction resolution (community KV)'
    })
  })

  it('resolves the MATCHED row (not the DEFAULT row) for a mapped country', async () => {
    const host = createMockHostRuntime({ geoCountry: 'DE' })
    await host.kv.put(
      KV_KEY_CONSENT_CONFIG,
      JSON.stringify({
        jurisdictions: {
          EU: euRow,
          DEFAULT: { ...euRow, mechanism: 'opt-out', gpc_honor: false }
        }
      })
    )
    const ctx = { host, request: new Request('https://x/') } as never as {
      host: HostRuntime
      request: Request
      jurisdictionKey?: string
      jurisdictionRow?: typeof euRow
    }
    const res = await communityJurisdictionStrategy.run(ctx as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect(ctx.jurisdictionKey).toBe('EU')
    expect(ctx.jurisdictionRow).toEqual(euRow)
  })

  it('falls back to the bundled DEFAULT row when the config has no matching row and no DEFAULT', async () => {
    const host = createMockHostRuntime({ geoCountry: 'US' })
    await host.kv.put(KV_KEY_CONSENT_CONFIG, JSON.stringify({ jurisdictions: { EU: euRow } }))
    const ctx = { host, request: new Request('https://x/') } as never as {
      host: HostRuntime
      request: Request
      jurisdictionKey?: string
      jurisdictionRow?: unknown
    }
    const res = await communityJurisdictionStrategy.run(ctx as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect(ctx.jurisdictionKey).toBe('DEFAULT')
    expect(ctx.jurisdictionRow).toBe(COMMUNITY_DEFAULT_CONSENT_CONFIG.jurisdictions.DEFAULT)
  })
})

describe('troll-shield hardening', () => {
  it('exposes the exact strategy identity and manifest', () => {
    expect(communityTrollShieldStrategy.id).toBe('troll-shield')
    expect(communityTrollShieldStrategy.stage).toBe('mandatory')
    expect(communityTrollShieldStrategy.manifest).toBe(communityTrollShieldStrategyManifest)
    expect(communityTrollShieldStrategyManifest).toEqual({
      id: 'troll-shield',
      stage: 'mandatory',
      displayName: 'Troll shield — bot heuristics (community)'
    })
  })

  it('a whitespace-only User-Agent counts as missing', () => {
    const r = evaluateBotHeuristics(
      new Request('https://x/', { headers: { 'user-agent': '   ' } }),
      null
    )
    expect(r).toEqual({ isBot: true, reasons: ['missing_user_agent'] })
  })

  it('bot-score threshold is exclusive: 29 flags, 30 does not', () => {
    const req = new Request('https://x/', {
      headers: { 'user-agent': 'Mozilla/5.0 (real browser)' }
    })
    expect(BOT_SCORE_THRESHOLD).toBe(30)
    expect(evaluateBotHeuristics(req, 29)).toEqual({ isBot: true, reasons: ['bot_score_29'] })
    expect(evaluateBotHeuristics(req, 30)).toEqual({ isBot: false, reasons: [] })
    expect(evaluateBotHeuristics(req, 0)).toEqual({ isBot: false, reasons: [] })
  })

  it('tolerates hosts without a botScore port (optional chaining)', async () => {
    const base = createMockHostRuntime()
    const { botScore: _omit, ...rest } = base as HostRuntime & { botScore?: unknown }
    const host = rest as HostRuntime
    const ctx = {
      host,
      request: new Request('https://x/', { headers: { 'user-agent': 'Mozilla/5.0 (real browser)' } })
    }
    const res = await communityTrollShieldStrategy.run(ctx as never)
    expect(res).toStrictEqual({ continuePipeline: true })
  })

  it('flagged traffic WITHOUT a tracking row returns a bare continue (no synthesized tracking)', async () => {
    const host = createMockHostRuntime()
    const res = await communityTrollShieldStrategy.run({
      host,
      request: new Request('https://x/', { headers: { 'user-agent': 'curl/8.0' } })
    } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
  })

  it('non-bot traffic returns a bare continue and never counts', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    const res = await communityTrollShieldStrategy.run({
      host,
      request: new Request('https://x/', { headers: { 'user-agent': 'Mozilla/5.0 (real browser)' } }),
      tracking: baseTracking
    } as never)
    expect(res).toStrictEqual({ continuePipeline: true })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('consent-log hardening', () => {
  it('exposes the exact strategy identity and manifest', () => {
    expect(evidenceUnsignedStrategy.id).toBe('evidence-unsigned')
    expect(evidenceUnsignedStrategy.stage).toBe('mandatory')
    expect(evidenceUnsignedStrategy.manifest).toBe(evidenceUnsignedStrategyManifest)
    expect(evidenceUnsignedStrategyManifest).toEqual({
      id: 'evidence-unsigned',
      stage: 'mandatory',
      displayName: 'Consent event log (unsigned operational record)'
    })
  })

  it('returns a strict continue in all three exits: no-signal, dedup-hit, fresh write', async () => {
    const host = createMockHostRuntime()
    const noSignal = await evidenceUnsignedStrategy.run({ host, request: new Request('https://x/') } as never)
    expect(noSignal).toStrictEqual({ continuePipeline: true })

    const ctx = {
      host,
      request: new Request('https://x/'),
      jurisdictionKey: 'EU',
      consent: { raw: 'k1.cGF5bG9hZA.c2ln', payload: { ...baseTracking, v: 1, siteId: 's1', decision: 'granted', issuedAt: baseTracking.occurredAt, policyHash: 'h' } }
    } as never
    const fresh = await evidenceUnsignedStrategy.run(ctx)
    expect(fresh).toStrictEqual({ continuePipeline: true })
    const dedup = await evidenceUnsignedStrategy.run(ctx)
    expect(dedup).toStrictEqual({ continuePipeline: true })
  })

  it('GPC alone with NO jurisdiction row writes nothing (honor defaults false)', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/', { headers: { 'Sec-GPC': '1' } })
    } as never)
    expect(put).not.toHaveBeenCalled()
  })

  it('token-less honored-GPC record: per-UTC-DAY key and fully defaulted fields', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/', { headers: { 'Sec-GPC': '1' } }),
      jurisdictionRow: euRow
      // no tracking, no token, no jurisdictionKey, no gate
    } as never)
    expect(put).toHaveBeenCalledTimes(1)
    const [key, value] = put.mock.calls[0] as [string, string]
    // Day-granular id (YYYY-MM-DD), not a full timestamp; defaulted site + jurisdiction.
    expect(key).toMatch(/^attestrack:consent_event:gpc:unknown:DEFAULT:\d{4}-\d{2}-\d{2}$/)
    const record = JSON.parse(value) as Record<string, unknown>
    expect(record.siteId).toBe('unknown')
    expect(record.jurisdictionKey).toBe('DEFAULT')
    expect(record.decision).toBe('declined')
    expect(record.policyHash).toBe('')
    expect(record.gpcSignalHonored).toBe(true)
    // No gate → mechanism from the jurisdiction row; no mode.
    expect(record.mechanism).toBe('opt-in')
    expect(record.mode).toBeUndefined()
  })

  it('token record ids use the signature segment; unsplittable raws fall back whole', async () => {
    const host = createMockHostRuntime()
    const put = vi.spyOn(host.kv, 'put')
    await evidenceUnsignedStrategy.run({
      host,
      request: new Request('https://x/'),
      consent: {
        raw: 'weird-raw-without-dots',
        payload: {
          v: 1,
          siteId: 's1',
          decision: 'granted',
          issuedAt: baseTracking.occurredAt,
          policyHash: 'sha256:abc'
        }
      }
    } as never)
    const [key, value] = put.mock.calls[0] as [string, string]
    expect(key).toBe('attestrack:consent_event:tok:weird-raw-without-dots:granted')
    const record = JSON.parse(value) as Record<string, unknown>
    expect(record.policyHash).toBe('sha256:abc')
    expect(record.jurisdictionKey).toBe('DEFAULT')
  })
})
