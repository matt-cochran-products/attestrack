/**
 * P2.6 — Consent matrix suite (the trust artifact).
 *
 * Table-driven contract tests over the full worker pipeline
 * ({jurisdiction mechanism} × {GPC} × {mode} × {token state}) asserting the
 * expected destination behavior, the recorded would-be decision, and the
 * consent-event record. Expectations are written as EXPLICIT literals per case
 * (never derived from the implementation under test).
 *
 * Invariants exercised:
 * - INV-B-03  — new deployments start in SHADOW; SHADOW never blocks destinations.
 * - Opt-in mechanism requires an affirmative granted decision (BEHAVORIAL-SPEC Part VII intent).
 * - Opt-out mechanism allows destinations absent a declined/withdrawn decision.
 * - GPC honored per row (gpc_honor) server-side, as an opt-out signal.
 * - Invalid tokens (expired/tampered) are treated exactly like absent tokens.
 * - SHADOW records the would-be ENFORCEMENT decision for analytics honesty (DASH.3).
 */
import { describe, expect, it, vi } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  createPrivacyConsentToken,
  createMockHostRuntime,
  destinationsAllowed,
  flushMockBackgroundTasks,
  noopStrategyLoader,
  type Strategy,
  type StrategyPipelineContext
} from '@attestrack/sdk'
import { defaultCommunityStrategies } from '@attestrack/strategies'
import type { ConsentEventRecordV1, TrackingEventV1 } from '@attestrack/types'
import {
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_CONSENT_EVENT_PREFIX,
  KV_KEY_ENABLED_STRATEGIES,
  KV_KEY_PORTAL_SITE_CONFIG
} from '@attestrack/types'

const SECRET = 'matrix-secret-32-characters-min!'
const SITE_ID = 'site_matrix'

type TokenState = 'none' | 'granted' | 'declined' | 'withdrawn' | 'expired' | 'tampered'
type Mechanism = 'opt-in' | 'opt-out'
type Mode = 'SHADOW' | 'ENFORCEMENT'

interface MatrixCase {
  mechanism: Mechanism
  gpc: boolean
  token: TokenState
  /** The decision ENFORCEMENT would make — the literal expectation. */
  expectedWouldAllow: boolean
  invariant: string
}

/**
 * 24 explicit (mechanism × gpc × token) expectations; each runs under both
 * SHADOW and ENFORCEMENT (48 pipeline executions total).
 */
const MATRIX: MatrixCase[] = [
  // ── opt-in, GPC off: only an affirmative grant allows destinations ──
  { mechanism: 'opt-in', gpc: false, token: 'none', expectedWouldAllow: false, invariant: 'opt-in requires affirmative grant' },
  { mechanism: 'opt-in', gpc: false, token: 'granted', expectedWouldAllow: true, invariant: 'opt-in affirmative grant allows' },
  { mechanism: 'opt-in', gpc: false, token: 'declined', expectedWouldAllow: false, invariant: 'opt-in declined blocks' },
  { mechanism: 'opt-in', gpc: false, token: 'withdrawn', expectedWouldAllow: false, invariant: 'withdrawal blocks like decline' },
  { mechanism: 'opt-in', gpc: false, token: 'expired', expectedWouldAllow: false, invariant: 'expired token == absent token' },
  { mechanism: 'opt-in', gpc: false, token: 'tampered', expectedWouldAllow: false, invariant: 'tampered token == absent token' },
  // ── opt-in, GPC on (row honors GPC): GPC declines everything ──
  { mechanism: 'opt-in', gpc: true, token: 'none', expectedWouldAllow: false, invariant: 'GPC honored per row (gpc_honor)' },
  { mechanism: 'opt-in', gpc: true, token: 'granted', expectedWouldAllow: false, invariant: 'GPC overrides stale grant' },
  { mechanism: 'opt-in', gpc: true, token: 'declined', expectedWouldAllow: false, invariant: 'GPC + declined blocks' },
  { mechanism: 'opt-in', gpc: true, token: 'withdrawn', expectedWouldAllow: false, invariant: 'GPC + withdrawn blocks' },
  { mechanism: 'opt-in', gpc: true, token: 'expired', expectedWouldAllow: false, invariant: 'GPC + expired blocks' },
  { mechanism: 'opt-in', gpc: true, token: 'tampered', expectedWouldAllow: false, invariant: 'GPC + tampered blocks' },
  // ── opt-out, GPC off: destinations flow absent a declined/withdrawn decision ──
  { mechanism: 'opt-out', gpc: false, token: 'none', expectedWouldAllow: true, invariant: 'opt-out flows without a declined token' },
  { mechanism: 'opt-out', gpc: false, token: 'granted', expectedWouldAllow: true, invariant: 'opt-out grant allows' },
  { mechanism: 'opt-out', gpc: false, token: 'declined', expectedWouldAllow: false, invariant: 'opt-out declined blocks' },
  { mechanism: 'opt-out', gpc: false, token: 'withdrawn', expectedWouldAllow: false, invariant: 'opt-out withdrawal blocks' },
  { mechanism: 'opt-out', gpc: false, token: 'expired', expectedWouldAllow: true, invariant: 'opt-out + expired token == absent (flows)' },
  { mechanism: 'opt-out', gpc: false, token: 'tampered', expectedWouldAllow: true, invariant: 'opt-out + tampered token == absent (flows)' },
  // ── opt-out, GPC on (row honors GPC): GPC is an opt-out signal ──
  { mechanism: 'opt-out', gpc: true, token: 'none', expectedWouldAllow: false, invariant: 'GPC opts out even without a token' },
  { mechanism: 'opt-out', gpc: true, token: 'granted', expectedWouldAllow: false, invariant: 'GPC overrides stale grant (opt-out row)' },
  { mechanism: 'opt-out', gpc: true, token: 'declined', expectedWouldAllow: false, invariant: 'GPC + declined blocks (opt-out row)' },
  { mechanism: 'opt-out', gpc: true, token: 'withdrawn', expectedWouldAllow: false, invariant: 'GPC + withdrawn blocks (opt-out row)' },
  { mechanism: 'opt-out', gpc: true, token: 'expired', expectedWouldAllow: false, invariant: 'GPC + expired blocks (opt-out row)' },
  { mechanism: 'opt-out', gpc: true, token: 'tampered', expectedWouldAllow: false, invariant: 'GPC + tampered blocks (opt-out row)' }
]

async function mintToken(state: Exclude<TokenState, 'none'>): Promise<string> {
  if (state === 'expired') {
    return createPrivacyConsentToken(
      SECRET,
      { siteId: SITE_ID, decision: 'granted', policyHash: 'sha256:m' },
      { ttlSeconds: 60, now: new Date(Date.now() - 120_000) }
    )
  }
  if (state === 'tampered') {
    const token = await createPrivacyConsentToken(
      SECRET,
      { siteId: SITE_ID, decision: 'granted', policyHash: 'sha256:m' },
      { ttlSeconds: 3600 }
    )
    const i = Math.floor(token.length / 2)
    const orig = token[i]!
    return token.slice(0, i) + (orig === 'A' ? 'B' : 'A') + token.slice(i + 1)
  }
  return createPrivacyConsentToken(
    SECRET,
    { siteId: SITE_ID, decision: state, policyHash: 'sha256:m' },
    { ttlSeconds: 3600 }
  )
}

interface RunResult {
  destinationRan: boolean
  tracking: TrackingEventV1 | undefined
  records: ConsentEventRecordV1[]
}

async function runMatrixCase(c: MatrixCase, mode: Mode): Promise<RunResult> {
  const host = createMockHostRuntime({
    secrets: { CONSENT_TOKEN_SECRET: SECRET },
    // opt-in row resolves via EU geo; opt-out row via DEFAULT (unknown geo).
    geoCountry: c.mechanism === 'opt-in' ? 'DE' : null
  })
  await host.kv.put(
    KV_KEY_CONSENT_CONFIG,
    JSON.stringify({
      jurisdictions: {
        EU: {
          profile: 'standard',
          mechanism: 'opt-in',
          ioa_assertions: [{ id: 'primary', text: 'I consent.', required: true }],
          documents: ['privacy_policy'],
          gpc_honor: true
        },
        DEFAULT: {
          profile: 'standard',
          mechanism: 'opt-out',
          ioa_assertions: [{ id: 'primary', text: 'Continued use = agreement.', required: true }],
          documents: ['privacy_policy'],
          gpc_honor: true
        }
      }
    })
  )
  await host.kv.put(
    KV_KEY_PORTAL_SITE_CONFIG,
    JSON.stringify({ siteId: SITE_ID, domain: 'example.com', mode, state1TokenTTL: 3600 })
  )
  await host.kv.put(KV_KEY_ENABLED_STRATEGIES, JSON.stringify(['probe-dest']))

  let destinationRan = false
  let seenTracking: TrackingEventV1 | undefined
  const probe: Strategy = {
    id: 'probe-dest',
    stage: 'destination',
    async run(ctx: StrategyPipelineContext) {
      // Mirror real ad-network strategies: consult the gate before firing.
      seenTracking = ctx.tracking
      if (!destinationsAllowed(ctx)) return { continuePipeline: true }
      destinationRan = true
      return { continuePipeline: true }
    }
  }

  const put = vi.spyOn(host.kv, 'put')
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: [...defaultCommunityStrategies('CONSENT_TOKEN_SECRET'), probe],
    strategyLoader: noopStrategyLoader
  })

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // Browser-shaped traffic: the P3.4 troll-shield flags UA-less requests as
    // bots (destinations never fire for bots), which is not under test here.
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36'
  }
  if (c.token !== 'none') {
    headers.cookie = `at_consent=${encodeURIComponent(await mintToken(c.token))}`
  }
  if (c.gpc) headers['Sec-GPC'] = '1'

  const res = await handler(
    new Request('https://t.example.com/t/event', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        v: 1,
        eventName: 'page_view',
        siteId: SITE_ID,
        occurredAt: new Date().toISOString()
      })
    })
  )
  expect(res.status).toBe(200)
  await flushMockBackgroundTasks(host)

  const records = put.mock.calls
    .filter(([k]) => (k as string).startsWith(KV_KEY_CONSENT_EVENT_PREFIX))
    .map(([, v]) => JSON.parse(v as string) as ConsentEventRecordV1)

  return { destinationRan, tracking: seenTracking, records }
}

describe('consent matrix (P2.6) — {mechanism} × {GPC} × {mode} × {token state}', () => {
  for (const c of MATRIX) {
    const label = `${c.mechanism} | gpc=${c.gpc ? 'on' : 'off'} | token=${c.token}`

    it(`${label} | ENFORCEMENT → destination ${c.expectedWouldAllow ? 'fires' : 'blocked'} (${c.invariant})`, async () => {
      const r = await runMatrixCase(c, 'ENFORCEMENT')
      expect(r.destinationRan).toBe(c.expectedWouldAllow)
      expect(r.tracking?.consentWouldAllow).toBe(c.expectedWouldAllow)
      expect(r.tracking?.consentMode).toBe('ENFORCEMENT')
      expect(r.tracking?.consentMechanism).toBe(c.mechanism)
      expect(r.records.length).toBeGreaterThan(0)
      expect(r.records[0]?.mechanism).toBe(c.mechanism)
      expect(r.records[0]?.mode).toBe('ENFORCEMENT')
    })

    it(`${label} | SHADOW → destination fires, would-be decision ${c.expectedWouldAllow} recorded (INV-B-03)`, async () => {
      const r = await runMatrixCase(c, 'SHADOW')
      // INV-B-03: shadow mode never blocks destinations…
      expect(r.destinationRan).toBe(true)
      // …but the enforcement decision is recorded for analytics honesty.
      expect(r.tracking?.consentWouldAllow).toBe(c.expectedWouldAllow)
      expect(r.tracking?.consentMode).toBe('SHADOW')
      expect(r.records[0]?.mode).toBe('SHADOW')
    })
  }

  it('INV-B-03: a fresh deployment with NO site config runs in SHADOW (destinations not blocked)', async () => {
    const host = createMockHostRuntime({ secrets: { CONSENT_TOKEN_SECRET: SECRET } })
    let ran = false
    const probe: Strategy = {
      id: 'probe-dest',
      stage: 'destination',
      async run(ctx: StrategyPipelineContext) {
        if (destinationsAllowed(ctx)) ran = true
        return { continuePipeline: true }
      }
    }
    await host.kv.put(KV_KEY_ENABLED_STRATEGIES, JSON.stringify(['probe-dest']))
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [...defaultCommunityStrategies('CONSENT_TOKEN_SECRET'), probe],
      strategyLoader: noopStrategyLoader
    })
    const res = await handler(
      new Request('https://x/t/event', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36'
        },
        body: JSON.stringify({
          v: 1,
          eventName: 'page_view',
          siteId: 'local',
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)
    expect(ran).toBe(true)
  })

  it('wrong-site tokens are treated as absent (site binding, P2.2): opt-in ENFORCEMENT blocks', async () => {
    const host = createMockHostRuntime({
      secrets: { CONSENT_TOKEN_SECRET: SECRET },
      geoCountry: 'DE'
    })
    await host.kv.put(
      KV_KEY_PORTAL_SITE_CONFIG,
      JSON.stringify({ siteId: SITE_ID, domain: 'example.com', mode: 'ENFORCEMENT' })
    )
    await host.kv.put(KV_KEY_ENABLED_STRATEGIES, JSON.stringify(['probe-dest']))
    let ran = false
    const probe: Strategy = {
      id: 'probe-dest',
      stage: 'destination',
      async run(ctx: StrategyPipelineContext) {
        if (destinationsAllowed(ctx)) ran = true
        return { continuePipeline: true }
      }
    }
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [...defaultCommunityStrategies('CONSENT_TOKEN_SECRET'), probe],
      strategyLoader: noopStrategyLoader
    })
    const foreignToken = await createPrivacyConsentToken(
      SECRET,
      { siteId: 'some_other_site', decision: 'granted', policyHash: 'sha256:m' },
      { ttlSeconds: 3600 }
    )
    const res = await handler(
      new Request('https://t.example.com/t/event', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36',
          cookie: `at_consent=${encodeURIComponent(foreignToken)}`
        },
        body: JSON.stringify({
          v: 1,
          eventName: 'page_view',
          siteId: SITE_ID,
          occurredAt: new Date().toISOString()
        })
      })
    )
    expect(res.status).toBe(200)
    await flushMockBackgroundTasks(host)
    expect(ran).toBe(false)
  })
})
