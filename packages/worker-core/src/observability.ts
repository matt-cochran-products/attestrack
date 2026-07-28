import type { HostKeyValue, HostRuntime } from '@attestrack/host-contracts'
import {
  incrementDailyCounter,
  readDailyCounter,
  readDeliveryStats,
  type DeliveryStats,
  type StrategyPipelineContext
} from '@attestrack/sdk'
import {
  KV_KEY_DRIFT_MISMATCH,
  KV_KEY_OBS_BOTS_PREFIX,
  KV_KEY_OBS_EVENTS_PREFIX,
  KV_KEY_OBS_LOG_PREFIX
} from '@attestrack/types'
import { effectiveSiteMode, type SiteConfigKv } from './config.js'

/**
 * P3 worker observability: bounded request/delivery logging + computed portal
 * metrics. Everything here reads/writes plain KV (no Durable Objects) and is
 * BEST-EFFORT on the write path — observability must never take down ingest.
 *
 * Honesty rule (launch rule §3): every number these helpers produce comes from
 * counters/logs recorded on real traffic. Nothing is estimated or seeded.
 */

/** One row in the portal Request Logs view — recorded per `/t/event` ingest. */
export interface RequestLogEntry {
  timestamp: string
  event: string
  source: string
  jurisdiction: string
  consent: string
  processingTime: number
  status: string
}

/** Ring bound per hourly KV key — oldest entries are dropped first. */
export const MAX_LOG_ENTRIES_PER_HOUR = 60

/** Hourly log keys expire after 48h; the portal reads the freshest hours only. */
export const LOG_TTL_SECONDS = 48 * 60 * 60

/** How many hourly buckets `readRecentLogs` scans (current + previous N-1). */
const LOG_READ_HOURS = 3

/** Hourly UTC bucket key, e.g. `attestrack:obs:log:2026-07-25T10`. */
export function logKeyForHour(now: Date): string {
  return `${KV_KEY_OBS_LOG_PREFIX}${now.toISOString().slice(0, 13)}`
}

function parseLogArray(raw: string | null | undefined): RequestLogEntry[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as RequestLogEntry[]) : []
  } catch {
    return []
  }
}

/**
 * Append one entry to the current hour's bounded ring. Read-modify-write on a
 * single KV key: entries may be lost under concurrent writers (documented,
 * best-effort). Never throws.
 */
export async function appendRequestLog(
  kv: HostKeyValue,
  entry: RequestLogEntry,
  now: Date = new Date()
): Promise<void> {
  try {
    const key = logKeyForHour(now)
    const list = parseLogArray(await kv.get(key))
    list.push(entry)
    const bounded = list.length > MAX_LOG_ENTRIES_PER_HOUR ? list.slice(-MAX_LOG_ENTRIES_PER_HOUR) : list
    await kv.put(key, JSON.stringify(bounded), { expirationTtl: LOG_TTL_SECONDS })
  } catch {
    /* best-effort — logging must never break ingest */
  }
}

/** Read recent log entries (newest first) across the freshest hourly buckets. */
export async function readRecentLogs(
  kv: HostKeyValue,
  now: Date = new Date(),
  limit = 100
): Promise<RequestLogEntry[]> {
  const out: RequestLogEntry[] = []
  try {
    for (let h = 0; h < LOG_READ_HOURS && out.length < limit; h += 1) {
      const bucket = new Date(now.getTime() - h * 60 * 60 * 1000)
      const list = parseLogArray(await kv.get(logKeyForHour(bucket)))
      // Entries were appended chronologically — reverse for newest-first.
      for (let i = list.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const entry = list[i]
        if (entry !== undefined) out.push(entry)
      }
    }
  } catch {
    /* return what we have */
  }
  return out
}

/** Consent column label for a log row, derived from the real consent gate. */
export function consentLogLabel(ctx: Pick<StrategyPipelineContext, 'consentGate'>): string {
  const gate = ctx.consentGate
  if (!gate) return 'NONE'
  if (gate.gpcApplied) return 'GPC_DECLINED'
  if (gate.effectiveDecision !== null) return gate.effectiveDecision.toUpperCase()
  return gate.mode === 'SHADOW' ? 'SHADOW_NONE' : 'NONE'
}

/** Status column for a log row: bot-filtered, gate-blocked, or processed. */
export function ingestLogStatus(
  ctx: Pick<StrategyPipelineContext, 'consentGate' | 'botDetection'>
): string {
  if (ctx.botDetection?.isBot) return 'BOT_FILTERED'
  if (ctx.consentGate && !ctx.consentGate.allowDestinations) return 'BLOCKED_ENFORCEMENT'
  return 'PROCESSED'
}

/**
 * Record observability for one `/t/event` ingest AFTER the pipeline ran:
 * increments the sampled per-day event counter and appends a log-ring entry.
 * Best-effort; never throws (runs inside `scheduleBackground`).
 */
export async function recordIngestObservability(
  host: HostRuntime,
  ctx: StrategyPipelineContext,
  processingTimeMs: number,
  now: Date = new Date()
): Promise<void> {
  try {
    await incrementDailyCounter(host.kv, KV_KEY_OBS_EVENTS_PREFIX, { now, sampled: true })
    await appendRequestLog(
      host.kv,
      {
        timestamp: now.toISOString(),
        event: ctx.tracking?.eventName ?? 'unknown',
        source: 'browser',
        jurisdiction: ctx.jurisdictionKey ?? 'UNKNOWN',
        consent: consentLogLabel(ctx),
        processingTime: Math.max(0, Math.round(processingTimeMs)),
        status: ingestLogStatus(ctx)
      },
      now
    )
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Destinations / dashboard (P3.2) — computed from recorded delivery stats.
// ---------------------------------------------------------------------------

export interface DeliveryStrategyDescriptor {
  id: string
  name: string
  /** Secrets that must ALL be present for the strategy to attempt delivery. */
  secrets: readonly string[]
}

/**
 * Bundled destination/analytics strategies the portal reports on. Ids, names,
 * and secret requirements mirror `@attestrack/strategies` manifests — extend
 * when a new bundled sink lands.
 */
export const DELIVERY_STRATEGY_DESCRIPTORS: readonly DeliveryStrategyDescriptor[] = [
  { id: 'meta-capi', name: 'Meta Conversions API', secrets: ['META_ACCESS_TOKEN', 'META_PIXEL_ID'] },
  {
    id: 'google-mp',
    name: 'Google Measurement Protocol',
    secrets: ['GOOGLE_MP_API_SECRET', 'GOOGLE_MEASUREMENT_ID']
  },
  { id: 'tiktok-events', name: 'TikTok Events API', secrets: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_PIXEL_ID'] },
  {
    id: 'microsoft-uet',
    name: 'Microsoft UET offline conversions',
    secrets: ['MICROSOFT_UET_ACCESS_TOKEN', 'MICROSOFT_UET_TAG_ID']
  },
  { id: 'clickhouse', name: 'ClickHouse HTTP sink', secrets: ['CLICKHOUSE_HTTP_URL'] },
  { id: 'tinybird', name: 'Tinybird Events API', secrets: ['TINYBIRD_TOKEN'] },
  { id: 'otel', name: 'OpenTelemetry (OTLP logs) sink', secrets: ['OTEL_EXPORTER_OTLP_ENDPOINT'] }
]

/**
 * Destination health derived ONLY from recorded outcomes + secret presence:
 * - `inactive`: endpoint not configured, or strategy disabled via KV allowlist
 * - `no_data`: configured + enabled but no delivery attempts recorded yet
 * - `degraded`: most recent attempt failed, or today's success rate < 90%
 * - `healthy`: attempts recorded, recent outcomes OK
 */
export interface DestinationStatusRow {
  id: string
  name: string
  status: 'healthy' | 'degraded' | 'inactive' | 'no_data'
  successRate: number
  lastEvent: string | null
  auth: string
  eventsToday: number
}

function successRatePct(stats: DeliveryStats): number {
  const attemptsToday = stats.okToday + stats.errorToday
  const ok = attemptsToday > 0 ? stats.okToday : stats.ok
  const attempts = attemptsToday > 0 ? attemptsToday : stats.ok + stats.error
  if (attempts === 0) return 0
  return Math.round((ok / attempts) * 1000) / 10
}

function statusFromStats(stats: DeliveryStats, rate: number): 'healthy' | 'degraded' {
  if (stats.lastErrorAt !== undefined && (stats.lastOkAt === undefined || stats.lastErrorAt >= stats.lastOkAt)) {
    return 'degraded'
  }
  const attemptsToday = stats.okToday + stats.errorToday
  if (attemptsToday > 0 && rate < 90) return 'degraded'
  return 'healthy'
}

export async function buildDestinationRows(
  host: HostRuntime,
  enabledIds: string[] | null
): Promise<DestinationStatusRow[]> {
  const rows: DestinationStatusRow[] = []
  for (const d of DELIVERY_STRATEGY_DESCRIPTORS) {
    const configured = d.secrets.every((s) => {
      const v = host.getSecret(s)
      return v !== undefined && v !== ''
    })
    const enabled = enabledIds === null || enabledIds.includes(d.id)
    if (!configured || !enabled) {
      rows.push({
        id: d.id,
        name: d.name,
        status: 'inactive',
        successRate: 0,
        lastEvent: null,
        auth: configured ? 'configured (strategy disabled)' : 'not configured',
        eventsToday: 0
      })
      continue
    }
    const stats = await readDeliveryStats(host.kv, d.id)
    if (stats === null) {
      rows.push({
        id: d.id,
        name: d.name,
        status: 'no_data',
        successRate: 0,
        lastEvent: null,
        auth: 'configured',
        eventsToday: 0
      })
      continue
    }
    const rate = successRatePct(stats)
    rows.push({
      id: d.id,
      name: d.name,
      status: statusFromStats(stats, rate),
      successRate: rate,
      lastEvent: stats.lastOkAt ?? null,
      auth: 'configured',
      eventsToday: stats.okToday
    })
  }
  return rows
}

/** Drift mismatch record written by the drift-detection strategy (TTL'd). */
export interface DriftMismatch {
  at: string
  expected: string
  current: string
}

export async function readDriftMismatch(kv: HostKeyValue): Promise<DriftMismatch | null> {
  try {
    const raw = await kv.get(KV_KEY_DRIFT_MISMATCH)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<DriftMismatch>
    if (typeof v.at !== 'string' || typeof v.expected !== 'string' || typeof v.current !== 'string') {
      return null
    }
    return { at: v.at, expected: v.expected, current: v.current }
  } catch {
    return null
  }
}

export interface DashboardMetricsPayload {
  /** Ingested events for the current UTC day (approximate above the sampling threshold). */
  eventsToday: number
  driftAlertCount: number
  driftAlert: DriftMismatch | null
  strategyStatus: 'all_healthy' | 'degraded' | 'inactive'
  strategySummary: string
  shadowModeLabel: string
}

/** Compute the dashboard payload from real counters/stats — no seeded KV JSON. */
export async function computeDashboardMetrics(
  host: HostRuntime,
  config: SiteConfigKv,
  enabledIds: string[] | null,
  now: Date = new Date()
): Promise<DashboardMetricsPayload> {
  const eventsToday = await readDailyCounter(host.kv, KV_KEY_OBS_EVENTS_PREFIX, now)
  const mismatch = config.driftDetection.enabled ? await readDriftMismatch(host.kv) : null
  const rows = await buildDestinationRows(host, enabledIds)

  const active = rows.filter((r) => r.status !== 'inactive')
  const degraded = active.filter((r) => r.status === 'degraded')
  let strategyStatus: DashboardMetricsPayload['strategyStatus']
  let strategySummary: string
  if (active.length === 0) {
    strategyStatus = 'inactive'
    strategySummary = 'No destination or analytics endpoints configured'
  } else if (degraded.length > 0) {
    strategyStatus = 'degraded'
    strategySummary = `${degraded.map((r) => r.name).join(', ')} reporting delivery errors`
  } else {
    strategyStatus = 'all_healthy'
    strategySummary = `${active.length} configured endpoint${active.length === 1 ? '' : 's'}; no recent delivery errors`
  }

  const mode = effectiveSiteMode(config)
  return {
    eventsToday,
    driftAlertCount: mismatch === null ? 0 : 1,
    driftAlert: mismatch,
    strategyStatus,
    strategySummary,
    shadowModeLabel:
      mode === 'SHADOW'
        ? 'Shadow — destinations run; the enforcement decision is recorded only'
        : 'Enforcement — the consent gate blocks non-consented destinations'
  }
}

/**
 * Signal-recovery payload (P3.3 decision: DE-SCOPED + relabeled for v1).
 * Recovery comparisons (ad-blocker / ITP) require a client beacon this repo
 * does not ship yet, so no recovery numbers are reported — rather than
 * estimated ones. `botRequestsFiltered` IS real (troll-shield counter).
 */
export interface SignalRecoveryPayload {
  measured: false
  reason: 'requires_beacon'
  message: string
  botRequestsFiltered: number
}

export async function computeSignalRecovery(
  host: HostRuntime,
  now: Date = new Date()
): Promise<SignalRecoveryPayload> {
  return {
    measured: false,
    reason: 'requires_beacon',
    message:
      'Signal-recovery comparison (server-side events vs browser-blocked estimate) requires a client beacon that Attestrack v1 does not ship. No recovery numbers are reported rather than estimated ones.',
    botRequestsFiltered: await readDailyCounter(host.kv, KV_KEY_OBS_BOTS_PREFIX, now)
  }
}
