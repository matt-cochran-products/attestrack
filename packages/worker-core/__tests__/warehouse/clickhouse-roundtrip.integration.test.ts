/**
 * P1.5 — ingest → warehouse round-trip against a REAL ClickHouse over HTTP.
 *
 * This suite is NOT part of the default `pnpm test` (no ClickHouse there); it
 * runs via `pnpm test:warehouse` (vitest.warehouse.config.ts) locally against
 * an ephemeral container and in CI against a `clickhouse/clickhouse-server`
 * service container (`.github/workflows/ci.yml`, `warehouse` job). It proves:
 *
 *  1. the repo-shipped DDL (`packages/schema/warehouse/clickhouse.sql`)
 *     applies cleanly and its live column set matches `toClickHouseRow`'s
 *     projection exactly (column parity against the REAL table, not a fixture);
 *  2. the ACTUAL Worker write path — `createClickHouseStrategy()` →
 *     `toClickHouseRow` + `buildClickHouseInsertUrl` (`INSERT INTO events
 *     FORMAT JSONEachRow` + `date_time_input_format=best_effort`) — lands rows
 *     in that table (delivery stats record `ok`, raw `count()` sees them);
 *  3. the Explore read path — `validateAndNormalizeExploreSql` (SQL gate) →
 *     `executeExploreSql` (the same executor the Worker's Explore proxy uses)
 *     — reads those rows back through ClickHouse `FORMAT JSON`;
 *  4. values survive the JSONEachRow + best_effort mapping: ISO `occurredAt`
 *     → DateTime64(3) millisecond-exact, Nullable columns null for absent
 *     optional fields, UInt8/UInt32/Float64 numerics, the bounded `params`
 *     JSON blob, and the consent honesty fields (P2.3) including the
 *     boolean→UInt8 `consentWouldAllow`.
 *
 * Target ClickHouse comes from CLICKHOUSE_TEST_HTTP_URL (default
 * http://localhost:8123) with CLICKHOUSE_TEST_USER / CLICKHOUSE_TEST_PASSWORD
 * (default attestrack / attestrack-test — the official image only admits the
 * passwordless `default` user from localhost, and a mapped container port is a
 * remote connection, so a real user exercises the same Basic-auth path the
 * Worker uses in production). The suite FAILS (never silently skips) when the
 * warehouse is unreachable — a green run means a real database answered.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { createMockHostRuntime, readDeliveryStats } from '@attestrack/sdk'
import { validateAndNormalizeExploreSql } from '@attestrack/schema'
import { createClickHouseStrategy, toClickHouseRow } from '@attestrack/strategies'
import type { TrackingEventV1 } from '@attestrack/types'
import { executeExploreSql } from '../../src/explore-warehouse.js'

const CH_URL = (process.env.CLICKHOUSE_TEST_HTTP_URL ?? 'http://localhost:8123').replace(
  /\/$/u,
  ''
)
const CH_USER = process.env.CLICKHOUSE_TEST_USER ?? 'attestrack'
const CH_PASSWORD = process.env.CLICKHOUSE_TEST_PASSWORD ?? 'attestrack-test'
const CH_AUTH = `Basic ${Buffer.from(`${CH_USER}:${CH_PASSWORD}`).toString('base64')}`

const DDL_PATH = fileURLToPath(
  new URL('../../../schema/warehouse/clickhouse.sql', import.meta.url)
)

/** Raw ClickHouse HTTP query (setup + independent verification only — the
 *  system-under-test paths are the strategy insert and the Explore executor). */
async function rawQuery(sql: string): Promise<string> {
  const res = await fetch(`${CH_URL}/`, {
    method: 'POST',
    headers: { Authorization: CH_AUTH },
    body: sql
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ClickHouse HTTP ${res.status} for ${JSON.stringify(sql.slice(0, 120))}: ${text.slice(0, 500)}`)
  }
  return text
}

async function rawQueryJson(sql: string): Promise<{
  data: Record<string, unknown>[]
  meta: { name: string; type: string }[]
}> {
  const text = await rawQuery(`${sql} FORMAT JSON`)
  return JSON.parse(text) as { data: Record<string, unknown>[]; meta: { name: string; type: string }[] }
}

async function waitForClickHouse(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CH_URL}/ping`)
      if (res.ok) return
      lastErr = new Error(`ping HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(
    `No ClickHouse reachable at ${CH_URL} (set CLICKHOUSE_TEST_HTTP_URL): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  )
}

// Full-field event: every optional column populated, ISO-8601 occurredAt with
// milliseconds (only parseable into DateTime64 via best_effort).
const fullEvent: TrackingEventV1 = {
  v: 1,
  eventName: 'cta_click',
  siteId: 'roundtrip-full',
  occurredAt: '2026-07-25T10:00:00.123Z',
  consentDecision: 'granted',
  jurisdiction: 'us-ca',
  consentMode: 'SHADOW',
  consentMechanism: 'opt-in',
  consentWouldAllow: true,
  visitorId: 'vh_roundtrip',
  sessionId: 's_rt_1',
  eventId: 'evt_rt_full_1',
  pagePath: '/pricing',
  referrer: 'https://example.com/blog',
  utmSource: 'newsletter',
  utmMedium: 'email',
  utmCampaign: 'launch',
  utmTerm: 'consent',
  utmContent: 'cta-a',
  userAgentClass: 'desktop',
  ctaType: 'request-audit',
  scrollDepthPct: 80,
  section: 'hero',
  dwellMs: 4200,
  webVitalName: 'lcp',
  webVitalValue: 1240.5,
  params: '{"variant":"b"}'
}

// Minimal event: only the required spine — every Nullable column must land NULL.
const minimalEvent: TrackingEventV1 = {
  v: 1,
  eventName: 'pageview',
  siteId: 'roundtrip-minimal',
  occurredAt: '2026-07-25T11:30:00.000Z'
}

/** The exact secrets a deployed Worker would hold — the strategy insert AND
 *  the Explore executor both authenticate with them (Basic auth). */
function makeHost() {
  return createMockHostRuntime({
    secrets: {
      CLICKHOUSE_HTTP_URL: `${CH_URL}/`,
      CLICKHOUSE_USER: CH_USER,
      CLICKHOUSE_PASSWORD: CH_PASSWORD
    }
  })
}

describe('ingest → warehouse round-trip (real ClickHouse, repo-shipped DDL) — P1.5', () => {
  beforeAll(async () => {
    await waitForClickHouse()
    // Fresh table from the DDL THE REPO SHIPS — this is the artifact under test.
    await rawQuery('DROP TABLE IF EXISTS events')
    await rawQuery(readFileSync(DDL_PATH, 'utf8'))
  })

  it('applies packages/schema/warehouse/clickhouse.sql and the LIVE column set matches the strategy projection exactly', async () => {
    const desc = await rawQueryJson('DESCRIBE TABLE events')
    const liveColumns = desc.data.map((d) => d.name as string)

    const projected = Object.keys(
      toClickHouseRow(fullEvent, { consentDecision: 'granted', jurisdiction: 'us-ca' })
    )
    // Every projected key is a real column (JSONEachRow maps by name — a rename
    // on either side silently drops data; this catches it against the real DB).
    expect(new Set(liveColumns)).toEqual(new Set([...projected, 'receivedAt']))

    // occurredAt really is DateTime64(3) — the best_effort contract's target type.
    const occurredAt = desc.data.find((d) => d.name === 'occurredAt')
    expect(occurredAt?.type).toBe('DateTime64(3)')
  })

  it('inserts through the ACTUAL strategy path (JSONEachRow + best_effort) and ClickHouse accepts both rows', async () => {
    const host = makeHost()
    const strategy = createClickHouseStrategy()

    // Full-field event, resolved consent from the pipeline (as the Worker does).
    await strategy.run({
      host,
      request: new Request('https://site.example/__attestrack__/t/event'),
      tracking: fullEvent,
      consent: { payload: { decision: 'granted' } },
      jurisdictionKey: 'us-ca'
    } as never)

    // Minimal event, nothing resolved — all Nullable columns take NULL.
    await strategy.run({
      host,
      request: new Request('https://site.example/__attestrack__/t/event'),
      tracking: minimalEvent
    } as never)

    // The strategy never throws (Invariant 12) — so a real 2xx from ClickHouse
    // is only provable via the recorded delivery outcomes: 2 ok, 0 errors.
    const stats = await readDeliveryStats(host.kv, 'clickhouse')
    expect(stats?.ok).toBe(2)
    expect(stats?.error ?? 0).toBe(0)

    // Independent raw verification: the rows are actually in the table.
    const count = await rawQueryJson('SELECT count() AS n FROM events')
    expect(Number(count.data[0]?.n)).toBe(2)
  })

  it('reads the full-field row back through the Explore gate → executor and every value survived the mapping', async () => {
    const gate = validateAndNormalizeExploreSql(
      "SELECT eventName, siteId, consentDecision, jurisdiction, consentMode, consentMechanism, consentWouldAllow, visitorId, sessionId, eventId, pagePath, referrer, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, userAgentClass, ctaType, scrollDepthPct, section, dwellMs, webVitalName, webVitalValue, params, toUnixTimestamp64Milli(occurredAt) AS occurredAtMs FROM events WHERE siteId = 'roundtrip-full'"
    )
    expect(gate.ok).toBe(true)
    if (!gate.ok) return
    // The gate's LIMIT clamp is part of what executes against the warehouse.
    expect(gate.sqlNormalized).toMatch(/\bLIMIT \d+$/)

    const result = await executeExploreSql(makeHost(), gate.sqlNormalized)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.rowCount).toBe(1)
    const row = result.rows[0] as Record<string, unknown>

    // DateTime64(3) round-trip is millisecond-exact: the ISO string only got
    // into the column via date_time_input_format=best_effort.
    expect(Number(row.occurredAtMs)).toBe(Date.parse(fullEvent.occurredAt))

    expect(row.eventName).toBe('cta_click')
    expect(row.siteId).toBe('roundtrip-full')

    // Resolved consent + P2.3 honesty fields (boolean → UInt8).
    expect(row.consentDecision).toBe('granted')
    expect(row.jurisdiction).toBe('us-ca')
    expect(row.consentMode).toBe('SHADOW')
    expect(row.consentMechanism).toBe('opt-in')
    expect(Number(row.consentWouldAllow)).toBe(1)

    // Identity / attribution strings.
    expect(row.visitorId).toBe('vh_roundtrip')
    expect(row.sessionId).toBe('s_rt_1')
    expect(row.eventId).toBe('evt_rt_full_1')
    expect(row.pagePath).toBe('/pricing')
    expect(row.referrer).toBe('https://example.com/blog')
    expect(row.utmSource).toBe('newsletter')
    expect(row.utmMedium).toBe('email')
    expect(row.utmCampaign).toBe('launch')
    expect(row.utmTerm).toBe('consent')
    expect(row.utmContent).toBe('cta-a')
    expect(row.userAgentClass).toBe('desktop')

    // Numeric signal columns (UInt8 / UInt32 / Float64).
    expect(Number(row.scrollDepthPct)).toBe(80)
    expect(Number(row.dwellMs)).toBe(4200)
    expect(Number(row.webVitalValue)).toBe(1240.5)
    expect(row.ctaType).toBe('request-audit')
    expect(row.section).toBe('hero')
    expect(row.webVitalName).toBe('lcp')

    // Bounded params JSON blob is stored verbatim as a string.
    expect(row.params).toBe('{"variant":"b"}')
  })

  it('reads the minimal row back via gate → executor: absent optional fields are real NULLs, not empty strings', async () => {
    const gate = validateAndNormalizeExploreSql(
      "SELECT eventName, consentDecision, jurisdiction, consentMode, consentWouldAllow, visitorId, sessionId, eventId, pagePath, userAgentClass, scrollDepthPct, params, toUnixTimestamp64Milli(occurredAt) AS occurredAtMs FROM events WHERE siteId = 'roundtrip-minimal'"
    )
    expect(gate.ok).toBe(true)
    if (!gate.ok) return

    const result = await executeExploreSql(makeHost(), gate.sqlNormalized)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.rowCount).toBe(1)
    const row = result.rows[0] as Record<string, unknown>
    expect(row.eventName).toBe('pageview')
    expect(Number(row.occurredAtMs)).toBe(Date.parse(minimalEvent.occurredAt))
    for (const col of [
      'consentDecision',
      'jurisdiction',
      'consentMode',
      'consentWouldAllow',
      'visitorId',
      'sessionId',
      'eventId',
      'pagePath',
      'userAgentClass',
      'scrollDepthPct',
      'params'
    ]) {
      expect(row[col], `${col} must be NULL`).toBeNull()
    }
  })

  it('still enforces the SQL gate in front of the real warehouse: writes and qualified names never reach ClickHouse', async () => {
    // The gate rejects these before any warehouse I/O — the same order the
    // Worker's Explore proxy applies (gate first, executor only on ok).
    const insert = validateAndNormalizeExploreSql("INSERT INTO events (v) VALUES (1)")
    expect(insert.ok).toBe(false)

    const qualified = validateAndNormalizeExploreSql('SELECT count() FROM default.events')
    expect(qualified.ok).toBe(false)

    const offList = validateAndNormalizeExploreSql('SELECT name FROM system.tables')
    expect(offList.ok).toBe(false)

    // And the table is untouched: still exactly the two strategy-inserted rows.
    const count = await rawQueryJson('SELECT count() AS n FROM events')
    expect(Number(count.data[0]?.n)).toBe(2)
  })
})
