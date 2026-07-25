import type { TrackingEventV1 } from './tracking.js'

/** Allowed physical table names for OSS Explore (INV-B-15); keep aligned with worker `explore-gate`.
 *  NOTE: bare TABLE names only — never a database. `default` was removed: it is a ClickHouse
 *  *database*, and allowlisting it let `SELECT * FROM default.<any_table>` slip past the gate. */
export const ATTESTRACK_EXPLORE_ALLOWED_TABLES = ['events', 'attestrack_events'] as const

export type AttestrackExploreAllowedTable = (typeof ATTESTRACK_EXPLORE_ALLOWED_TABLES)[number]

/** Server-enforced cap on rows returned from Explore (Worker injects or clamps LIMIT). */
export const ATTESTRACK_EXPLORE_MAX_ROWS = 500

/**
 * Column names of the warehouse `events` table (EXP.6 — schema autocomplete).
 * The `events` DDL (`@attestrack/schema` warehouse/clickhouse.sql) maps
 * `TrackingEventV1` JSON keys 1:1 via `INSERT … FORMAT JSONEachRow`, plus the
 * server-side `receivedAt` default. The `satisfies` + `_ExploreEventColumnsMissing`
 * pair keeps this list in compile-time lockstep with `TrackingEventV1`: adding a
 * field to the event type without listing it here fails the build.
 */
export type AttestrackEventColumnName = keyof TrackingEventV1 | 'receivedAt'

export const ATTESTRACK_EVENT_COLUMNS = [
  'v',
  'eventName',
  'siteId',
  'occurredAt',
  'consentDecision',
  'jurisdiction',
  'consentMode',
  'consentMechanism',
  'consentWouldAllow',
  'sessionId',
  'pagePath',
  'ctaType',
  'scrollDepthPct',
  'section',
  'dwellMs',
  'webVitalName',
  'webVitalValue',
  'params',
  'visitorId',
  'eventId',
  'referrer',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'utmContent',
  'userAgentClass',
  'receivedAt'
] as const satisfies readonly AttestrackEventColumnName[]

/** Compile-time exhaustiveness: resolves to `never` only when every column is listed. */
export type _ExploreEventColumnsMissing = Exclude<
  AttestrackEventColumnName,
  (typeof ATTESTRACK_EVENT_COLUMNS)[number]
>
const _assertAllEventColumnsListed: [_ExploreEventColumnsMissing] extends [never] ? true : never =
  true
void _assertAllEventColumnsListed

/**
 * Explore chart types (EXP.8). Visualisation is user-directed: `table` is the
 * default and the portal never auto-selects a chart form for a result.
 */
export const ATTESTRACK_EXPLORE_CHART_TYPES = [
  'table',
  'line',
  'bar',
  'area',
  'scatter',
  'pie',
  'heatmap'
] as const

export type ExploreChartType = (typeof ATTESTRACK_EXPLORE_CHART_TYPES)[number]

/**
 * Curated analytics chart ids (ANA.2 honest v1 subset — P4.3). Every curated
 * chart is computed either from canned SQL run through the SAME gated Explore
 * proxy (never raw SQL) or from recorded delivery stats (STR.4). The remaining
 * ANA.2 questions (ad-blocker/ITP recovery, >7-day attribution) stay de-scoped
 * in v1 — see docs/OSS-SCOPE-MATRIX.md.
 */
export const ATTESTRACK_CURATED_CHART_IDS = [
  'events-volume',
  'consent-rate-by-jurisdiction',
  'destination-success-rate',
  'bot-share'
] as const

export type CuratedChartId = (typeof ATTESTRACK_CURATED_CHART_IDS)[number]
