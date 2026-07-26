import type { HostRuntime } from '@attestrack/host-contracts'
import { validateAndNormalizeExploreSql } from '@attestrack/schema'
import { ATTESTRACK_CURATED_CHART_IDS, type CuratedChartId } from '@attestrack/types'
import { executeExploreSql, isExploreWarehouseConfigured } from './explore-warehouse.js'
import { buildDestinationRows } from './observability.js'

/**
 * P4.3 — Curated analytics views (ANA.*), computed server-side.
 *
 * Honesty rules (launch rule §3 — "no invented numbers"):
 * - Warehouse-backed charts are CANNED SQL run through the SAME Explore gate
 *   (`validateAndNormalizeExploreSql`) and warehouse executor as user queries —
 *   never raw SQL, never a second path to the warehouse (INV-B-14/15/16).
 * - The destination chart reads recorded delivery stats (STR.4 / P3.1) — no SQL.
 * - Every empty/unconfigured/error state is reported as such; the portal renders
 *   the state instead of a chart. No placeholder series, ever.
 */

export interface CuratedChartPoint {
  label: string
  value: number
}

export interface CuratedChartSeries {
  name: string
  points: CuratedChartPoint[]
}

export type CuratedChartState = 'ok' | 'empty' | 'not_configured' | 'error'

export interface CuratedChartPayload {
  id: CuratedChartId
  title: string
  /** One-line honest framing (ANA.7 discipline applied to every curated view). */
  description: string
  unit: 'count' | 'percent'
  source: 'warehouse' | 'delivery_stats'
  state: CuratedChartState
  /** Populated for `empty` / `not_configured` / `error` states. */
  message?: string
  /** True when the warehouse result hit the Explore row cap. */
  truncated?: boolean
  series: CuratedChartSeries[]
}

interface CuratedChartMeta {
  title: string
  description: string
  unit: 'count' | 'percent'
  source: 'warehouse' | 'delivery_stats'
}

const CHART_META: Record<CuratedChartId, CuratedChartMeta> = {
  'events-volume': {
    title: 'Events ingested per day',
    description:
      'Rows written to your events table per UTC day (includes bot-labeled rows).',
    unit: 'count',
    source: 'warehouse'
  },
  'consent-rate-by-jurisdiction': {
    title: 'Consent rate by jurisdiction',
    description:
      'Granted share of events carrying an explicit recorded consent decision, per UTC day.',
    unit: 'percent',
    source: 'warehouse'
  },
  'destination-success-rate': {
    title: 'Destination success rate',
    description:
      'Delivery success per configured destination from recorded outcomes (all recorded traffic; not date-range filtered).',
    unit: 'percent',
    source: 'delivery_stats'
  },
  'bot-share': {
    title: 'Bot share of ingested events',
    description:
      'Share of events per UTC day the troll-shield labeled as bot traffic (kept in the warehouse, never delivered to ad destinations).',
    unit: 'percent',
    source: 'warehouse'
  }
}

export function listCuratedChartDescriptors(): {
  id: CuratedChartId
  title: string
  description: string
  unit: 'count' | 'percent'
  source: 'warehouse' | 'delivery_stats'
}[] {
  return ATTESTRACK_CURATED_CHART_IDS.map((id) => ({ id, ...CHART_META[id] }))
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidCuratedDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s))
}

export function isCuratedChartId(s: unknown): s is CuratedChartId {
  return typeof s === 'string' && (ATTESTRACK_CURATED_CHART_IDS as readonly string[]).includes(s)
}

/** ClickHouse `FORMAT JSON` quotes 64-bit ints — coerce defensively. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '')
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * Canned per-day SQL. `from`/`to` are validated `YYYY-MM-DD` literals before
 * interpolation AND the assembled statement still passes through the Explore
 * gate — belt and braces, single warehouse path.
 */
function cannedSql(chartId: CuratedChartId, from: string, to: string): string {
  const range = `toDate(occurredAt) >= '${from}' AND toDate(occurredAt) <= '${to}'`
  switch (chartId) {
    case 'events-volume':
      return `SELECT toDate(occurredAt) AS day, count() AS events FROM events WHERE ${range} GROUP BY day ORDER BY day ASC LIMIT 500`
    case 'consent-rate-by-jurisdiction':
      return `SELECT toDate(occurredAt) AS day, coalesce(jurisdiction, 'UNKNOWN') AS jurisdiction, countIf(consentDecision = 'granted') AS granted, countIf(consentDecision IS NOT NULL) AS decided FROM events WHERE ${range} GROUP BY day, jurisdiction ORDER BY day ASC LIMIT 500`
    case 'bot-share':
      return `SELECT toDate(occurredAt) AS day, countIf(userAgentClass = 'bot') AS bots, count() AS total FROM events WHERE ${range} GROUP BY day ORDER BY day ASC LIMIT 500`
    case 'destination-success-rate':
      // Not warehouse-backed — never called for this id.
      return ''
  }
}

function basePayload(chartId: CuratedChartId): CuratedChartPayload {
  return {
    id: chartId,
    ...CHART_META[chartId],
    state: 'ok',
    series: []
  }
}

const NOT_CONFIGURED_MESSAGE =
  'No analytics warehouse configured. Set TINYBIRD_TOKEN or CLICKHOUSE_QUERY_URL (or CLICKHOUSE_HTTP_URL) on the Worker — see the Strategies view.'

const EMPTY_MESSAGE =
  'No matching events recorded in this date range yet. Once traffic flows through /t/event with an analytics destination enabled, this chart populates from your own warehouse.'

async function runCannedQuery(
  host: HostRuntime,
  chartId: CuratedChartId,
  from: string,
  to: string
): Promise<
  | { ok: true; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; payload: CuratedChartPayload }
> {
  const payload = basePayload(chartId)
  if (!isExploreWarehouseConfigured(host)) {
    return {
      ok: false,
      payload: { ...payload, state: 'not_configured', message: NOT_CONFIGURED_MESSAGE }
    }
  }
  const gated = validateAndNormalizeExploreSql(cannedSql(chartId, from, to))
  if (!gated.ok) {
    // Canned SQL failing the gate is a programming error — surface it honestly.
    return {
      ok: false,
      payload: {
        ...payload,
        state: 'error',
        message: `Curated query rejected by the Explore gate: ${gated.reason}`
      }
    }
  }
  const wh = await executeExploreSql(host, gated.sqlNormalized)
  if (!wh.ok) {
    const reason =
      typeof wh.details.reason === 'string' ? wh.details.reason : wh.error
    return {
      ok: false,
      payload: { ...payload, state: 'error', message: `Warehouse query failed: ${reason}` }
    }
  }
  if (wh.rows.length === 0) {
    return { ok: false, payload: { ...payload, state: 'empty', message: EMPTY_MESSAGE } }
  }
  return { ok: true, rows: wh.rows, truncated: wh.truncated }
}

/** Cap on jurisdiction series; the rest aggregate into `OTHER` (real sums, not estimates). */
const MAX_JURISDICTION_SERIES = 6

function consentRateSeries(rows: Record<string, unknown>[]): CuratedChartSeries[] {
  type Cell = { day: string; granted: number; decided: number }
  const byJurisdiction = new Map<string, Cell[]>()
  for (const r of rows) {
    const decided = num(r.decided)
    if (decided <= 0) continue
    const j = str(r.jurisdiction) || 'UNKNOWN'
    const list = byJurisdiction.get(j) ?? []
    list.push({ day: str(r.day), granted: num(r.granted), decided })
    byJurisdiction.set(j, list)
  }
  const ranked = [...byJurisdiction.entries()].sort(
    (a, b) =>
      b[1].reduce((s, c) => s + c.decided, 0) - a[1].reduce((s, c) => s + c.decided, 0)
  )
  const top = ranked.slice(0, MAX_JURISDICTION_SERIES)
  const rest = ranked.slice(MAX_JURISDICTION_SERIES)
  const series: CuratedChartSeries[] = top.map(([name, cells]) => ({
    name,
    points: cells
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((c) => ({ label: c.day, value: pct(c.granted, c.decided) }))
  }))
  if (rest.length > 0) {
    const byDay = new Map<string, { granted: number; decided: number }>()
    for (const [, cells] of rest) {
      for (const c of cells) {
        const agg = byDay.get(c.day) ?? { granted: 0, decided: 0 }
        agg.granted += c.granted
        agg.decided += c.decided
        byDay.set(c.day, agg)
      }
    }
    series.push({
      name: 'OTHER',
      points: [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, agg]) => ({ label: day, value: pct(agg.granted, agg.decided) }))
    })
  }
  return series
}

export async function computeCuratedChart(
  host: HostRuntime,
  enabledIds: string[] | null,
  chartId: CuratedChartId,
  dateFrom: string,
  dateTo: string
): Promise<CuratedChartPayload> {
  const payload = basePayload(chartId)

  if (chartId === 'destination-success-rate') {
    const rows = await buildDestinationRows(host, enabledIds)
    const withData = rows.filter((r) => r.status === 'healthy' || r.status === 'degraded')
    if (withData.length === 0) {
      return {
        ...payload,
        state: 'empty',
        message:
          'No delivery outcomes recorded yet. Configure destination or analytics endpoints in Strategies; recorded successes/errors appear here.'
      }
    }
    return {
      ...payload,
      state: 'ok',
      series: [
        {
          name: 'Success rate',
          points: withData.map((r) => ({ label: r.name, value: r.successRate }))
        }
      ]
    }
  }

  const run = await runCannedQuery(host, chartId, dateFrom, dateTo)
  if (!run.ok) return run.payload

  if (chartId === 'events-volume') {
    return {
      ...payload,
      state: 'ok',
      truncated: run.truncated,
      series: [
        {
          name: 'Events',
          points: run.rows.map((r) => ({ label: str(r.day), value: num(r.events) }))
        }
      ]
    }
  }

  if (chartId === 'bot-share') {
    return {
      ...payload,
      state: 'ok',
      truncated: run.truncated,
      series: [
        {
          name: 'Bot share',
          points: run.rows.map((r) => ({
            label: str(r.day),
            value: pct(num(r.bots), num(r.total))
          }))
        }
      ]
    }
  }

  // consent-rate-by-jurisdiction
  const series = consentRateSeries(run.rows)
  if (series.length === 0) {
    return {
      ...payload,
      state: 'empty',
      message:
        'Events exist in this range, but none carry a recorded consent decision yet (the consent banner has not been answered). No rate is shown rather than an invented one.'
    }
  }
  return { ...payload, state: 'ok', truncated: run.truncated, series }
}
