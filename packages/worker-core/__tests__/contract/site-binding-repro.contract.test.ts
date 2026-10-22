/**
 * Issue #70 regression — site binding between the configured site
 * (KV `KV_KEY_PORTAL_SITE_CONFIG.siteId`) and the request body `siteId` on
 * `POST /t/event`.
 *
 * Runs the real pipeline (handler → mandatory jurisdiction/consent/consent-log
 * → real `createClickHouseStrategy` / `toClickHouseRow`). A body `siteId` that
 * differs from the configured site must fail closed with `400 invalid_body`
 * (`details.code: 'tracking_site_mismatch'`) before anything is scheduled, in
 * every mode and with or without a consent token.
 *
 * All warehouse egress goes through a mocked `host.fetchOutbound`; global
 * `fetch` is stubbed to throw and asserted unused. Secrets and URLs are
 * fictional fixture constants.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import {
  createMockHostRuntime,
  createPrivacyConsentToken,
  flushMockBackgroundTasks,
  noopStrategyLoader
} from '@attestrack/sdk'
import { createClickHouseStrategy, defaultCommunityStrategies } from '@attestrack/strategies'
import type { HostRuntime } from '@attestrack/host-contracts'
import type { ConsentEventRecordV1 } from '@attestrack/types'
import {
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_CONSENT_EVENT_PREFIX,
  KV_KEY_ENABLED_STRATEGIES,
  KV_KEY_PORTAL_SITE_CONFIG
} from '@attestrack/types'

const SECRET = 'fixture-site-binding-secret-32ch!'
const SITE_A = 'site_a_fixture'
const SITE_B = 'site_b_fixture'
const CLICKHOUSE_URL = 'https://clickhouse.fixture.invalid:8443/'
const ALLOWED_ORIGIN = 'https://www.example.com'
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36'

type Mode = 'SHADOW' | 'ENFORCEMENT'

interface OutboundCall {
  binding: string
  url: string
  row: Record<string, unknown>
}

interface ReproResult {
  status: number
  body: unknown
  outbound: OutboundCall[]
  records: ConsentEventRecordV1[]
  configuredSiteId: string | undefined
  scheduled: number
  kvWrites: number
  headers: Headers
  rawBody: string
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mintSiteAGrant(): Promise<string> {
  return createPrivacyConsentToken(
    SECRET,
    { siteId: SITE_A, decision: 'granted', policyHash: 'sha256:fixture' },
    { ttlSeconds: 3600 }
  )
}

async function runRepro(opts: {
  mode: Mode
  bodySiteId: string
  withSiteAToken: boolean
}): Promise<ReproResult> {
  const globalFetch = vi.fn(async () => {
    throw new Error('global fetch must not be used in this test')
  })
  vi.stubGlobal('fetch', globalFetch)

  const outbound: OutboundCall[] = []
  const fetchOutbound = vi.fn(
    async (binding: string, input: RequestInfo | URL, init?: RequestInit) => {
      outbound.push({
        binding,
        url: String(input),
        row: JSON.parse(String(init?.body)) as Record<string, unknown>
      })
      return new Response(null, { status: 200 })
    }
  )

  const base = createMockHostRuntime({
    secrets: { CONSENT_TOKEN_SECRET: SECRET, CLICKHOUSE_HTTP_URL: CLICKHOUSE_URL },
    // EU opt-in row: the token decision actually changes the gate outcome.
    geoCountry: 'DE'
  })
  const host: HostRuntime = Object.assign(base, { fetchOutbound })

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
    JSON.stringify({ siteId: SITE_A, domain: 'example.com', mode: opts.mode, state1TokenTTL: 3600 })
  )
  await host.kv.put(KV_KEY_ENABLED_STRATEGIES, JSON.stringify(['clickhouse']))

  const put = vi.spyOn(host.kv, 'put')
  const scheduleBackground = vi.spyOn(host, 'scheduleBackground')
  const handler = createAttestrackFetchHandler({
    host,
    consentSecretName: 'CONSENT_TOKEN_SECRET',
    bundledStrategies: [
      ...defaultCommunityStrategies('CONSENT_TOKEN_SECRET'),
      createClickHouseStrategy()
    ],
    strategyLoader: noopStrategyLoader
  })

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': BROWSER_UA,
    origin: ALLOWED_ORIGIN
  }
  if (opts.withSiteAToken) {
    headers.cookie = `at_consent=${encodeURIComponent(await mintSiteAGrant())}`
  }

  const res = await handler(
    new Request('https://t.example.com/t/event', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        v: 1,
        eventName: 'page_view',
        siteId: opts.bodySiteId,
        occurredAt: new Date().toISOString()
      })
    })
  )
  const rawBody = await res.text()
  const body: unknown = JSON.parse(rawBody)
  await flushMockBackgroundTasks(host)

  const records = put.mock.calls
    .filter(([k]) => k.startsWith(KV_KEY_CONSENT_EVENT_PREFIX))
    .map(([, v]) => JSON.parse(v) as ConsentEventRecordV1)
  const rawConfig = await host.kv.get(KV_KEY_PORTAL_SITE_CONFIG)
  const configuredSiteId = rawConfig
    ? (JSON.parse(rawConfig) as { siteId?: string }).siteId
    : undefined

  expect(globalFetch).not.toHaveBeenCalled()
  return {
    status: res.status,
    body,
    outbound,
    records,
    configuredSiteId,
    scheduled: scheduleBackground.mock.calls.length,
    kvWrites: put.mock.calls.length,
    headers: res.headers,
    rawBody
  }
}

function expectFailClosed(r: ReproResult): void {
  expect(r.configuredSiteId).toBe(SITE_A)
  expect(r.status).toBe(400)
  // Exact shape: stable error family + code only — no token, secret or siteId echo.
  expect(r.body).toEqual({ error: 'invalid_body', details: { code: 'tracking_site_mismatch' } })
  for (const value of [SITE_A, SITE_B, SECRET, 'at_consent']) {
    expect(r.rawBody).not.toContain(value)
  }
  expect(r.scheduled).toBe(0)
  expect(r.outbound).toHaveLength(0)
  expect(r.records).toHaveLength(0)
  expect(r.kvWrites).toBe(0)
  // Allowed-origin CORS still applies so the browser can read the error.
  expect(r.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN)
  expect(r.headers.get('access-control-allow-credentials')).toBe('true')
}

describe('site binding (issue #70) — body siteId must match the configured site', () => {
  it('control: SHADOW, configured A, valid A token, body A → row written for A', async () => {
    const r = await runRepro({ mode: 'SHADOW', bodySiteId: SITE_A, withSiteAToken: true })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, accepted: true })
    expect(r.scheduled).toBe(1)
    expect(r.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN)
    expect(r.outbound).toHaveLength(1)
    expect(r.outbound[0]?.binding).toBe('CLICKHOUSE_PRIVATE')
    expect(r.outbound[0]?.url.startsWith(CLICKHOUSE_URL)).toBe(true)
    expect(r.outbound[0]?.row).toMatchObject({
      siteId: SITE_A,
      consentDecision: 'granted',
      consentMode: 'SHADOW',
      consentMechanism: 'opt-in',
      consentWouldAllow: 1
    })
    expect(r.records).toHaveLength(1)
    expect(r.records[0]?.siteId).toBe(SITE_A)
  })

  it('SHADOW, configured A, valid A token, body B → 400 tracking_site_mismatch, nothing scheduled', async () => {
    expectFailClosed(await runRepro({ mode: 'SHADOW', bodySiteId: SITE_B, withSiteAToken: true }))
  })

  it('SHADOW, configured A, NO token, body B → 400 tracking_site_mismatch, nothing scheduled', async () => {
    expectFailClosed(await runRepro({ mode: 'SHADOW', bodySiteId: SITE_B, withSiteAToken: false }))
  })

  it('control: SHADOW, configured A, NO token, body A → row still written (SHADOW never blocks)', async () => {
    const r = await runRepro({ mode: 'SHADOW', bodySiteId: SITE_A, withSiteAToken: false })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, accepted: true })
    expect(r.scheduled).toBe(1)
    expect(r.outbound).toHaveLength(1)
    expect(r.outbound[0]?.row).toMatchObject({
      siteId: SITE_A,
      consentDecision: null,
      consentMode: 'SHADOW',
      consentMechanism: 'opt-in',
      consentWouldAllow: 0
    })
    // P7.1: no consent signal → no consent-event write.
    expect(r.records).toHaveLength(0)
  })

  it('ENFORCEMENT, configured A, valid A token, body B → 400 tracking_site_mismatch, nothing scheduled', async () => {
    expectFailClosed(
      await runRepro({ mode: 'ENFORCEMENT', bodySiteId: SITE_B, withSiteAToken: true })
    )
  })

  it('ENFORCEMENT, configured A, NO token, body B → 400 tracking_site_mismatch, nothing scheduled', async () => {
    expectFailClosed(
      await runRepro({ mode: 'ENFORCEMENT', bodySiteId: SITE_B, withSiteAToken: false })
    )
  })
})
