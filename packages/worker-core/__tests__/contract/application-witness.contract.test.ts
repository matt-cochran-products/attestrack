import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAttestrackFetchHandler } from '../../src/create-fetch-handler.js'
import { createMockHostRuntime, flushMockBackgroundTasks, noopStrategyLoader, type Strategy } from '@attestrack/sdk'
import { createConsentCookieStrategy } from '@attestrack/strategies'
import { KV_KEY_PORTAL_SITE_CONFIG } from '@attestrack/types'
import { inspect, observe, type PreparedPhase } from '../../../../scripts/application-witness.ts'

describe('release HTTP witness against native handler and Explore executor', () => {
  it('uses actual native auth, consent mint/verification, site-bound event and SQL response shapes; reconciles lost response read-only', async () => {
    const secret = 'fictional-portal-fixture-32-characters'
    const rows: Record<string, unknown>[] = []
    const host = createMockHostRuntime({ secrets: {
      PORTAL_API_SHARED_SECRET: secret, CONSENT_TOKEN_SECRET: 'fictional-consent-signing-32-characters',
      CLICKHOUSE_QUERY_URL: 'https://warehouse.invalid', CLICKHOUSE_QUERY_USER: 'fictional_reader', CLICKHOUSE_QUERY_PASSWORD: 'fictional_password'
    } })
    await host.kv.put(KV_KEY_PORTAL_SITE_CONFIG, JSON.stringify({ siteId: 'dedicated-fixture', domain: 'fixture.invalid', mode: 'ENFORCEMENT', consentConfigured: true }))
    let nativeQueries = 0
    host.fetchOutbound = async (binding, url, init) => {
      expect(binding).toBe('CLICKHOUSE_PRIVATE')
      expect(String(url)).toBe('https://warehouse.invalid/')
      const sql = String(init?.body)
      expect(sql).toContain("WHERE siteId = 'dedicated-fixture' AND eventId IN (")
      expect(sql).toContain('LIMIT 5\nFORMAT JSON')
      nativeQueries++
      const data = rows.filter(row => sql.includes(String(row.eventId)))
      return Response.json({ meta: ['eventId', 'siteId', 'eventName', 'consentDecision'].map(name => ({ name })), data, rows: data.length })
    }
    // Fictional persistence port only; actual native consent strategy must stamp the row.
    const recorder: Strategy = { id: 'fixture-row-recorder', stage: 'analytics',
      manifest: { id: 'fixture-row-recorder', stage: 'analytics', displayName: 'Fictional row recorder' },
      async run(ctx) {
        if (ctx.tracking) rows.push({ eventId: ctx.tracking.eventId, siteId: ctx.tracking.siteId,
          eventName: ctx.tracking.eventName, consentDecision: ctx.tracking.consentDecision })
        return {}
      } }
    const handler = createAttestrackFetchHandler({ host, consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: [createConsentCookieStrategy('CONSENT_TOKEN_SECRET'), recorder], strategyLoader: noopStrategyLoader })
    const calls: string[] = []
    const fetcher: typeof fetch = async (url, init) => {
      const request = new Request(String(url), init)
      calls.push(request.method + ' ' + new URL(request.url).pathname)
      const response = await handler(request)
      await flushMockBackgroundTasks(host)
      if (new URL(request.url).pathname === '/t/event') {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, accepted: true })
        throw new Error('fictional response lost after actual handler accepted write')
      }
      return response
    }
    const prepared: PreparedPhase = { target: { origin: 'https://fixture.invalid', site_id: 'dedicated-fixture', policy_hash: 'a'.repeat(64) },
      artifact: { artifact_id: 1, producer_run: 2, producer_attempt: 1, archive_sha256: 'b'.repeat(64), inventory_sha256: 'c'.repeat(64), source_tree: 'd'.repeat(40) },
      phase: 'predecessor', mutation: { cohort: randomUUID(), event_id: randomUUID() } }
    const persisted = JSON.stringify(prepared)
    await expect(observe(prepared, { portal_secret: secret }, fetcher)).rejects.toThrow('http_observation_failed')
    expect(rows).toEqual([{ eventId: prepared.mutation.event_id, siteId: 'dedicated-fixture', eventName: 'release_witness', consentDecision: 'granted' }])
    const before = calls.length
    const witness = await inspect(JSON.parse(persisted), { portal_secret: secret }, fetcher)
    expect(witness.observation).toBe('read-only')
    expect(witness.phases[0].event_id).toBe(prepared.mutation.event_id)
    expect(calls.slice(before)).not.toContain('POST /t/event')
    expect(calls.slice(before)).not.toContain('POST /__attestrack__/consent/commit')
    expect(nativeQueries).toBe(2)
  })
})
