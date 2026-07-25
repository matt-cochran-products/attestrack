import type { HostRuntime } from '@attestrack/host-contracts'
import {
  KV_KEY_ENABLED_STRATEGIES,
  KV_KEY_PORTAL_ALERT_RULES,
  KV_KEY_PORTAL_SAVED_QUERIES,
  KV_KEY_PORTAL_STRATEGIES
} from '@attestrack/types'
import {
  SAVED_QUERIES_MAX_ENTRIES,
  exploreGateErrorPayload,
  parseSavedQueriesKv,
  savedQueryChartConfigSchema,
  validateAndNormalizeExploreSql,
  type SavedQueryChartConfig,
  type SavedQueryEntryV1
} from '@attestrack/schema'
import { executeExploreSql, isExploreWarehouseConfigured } from './explore-warehouse.js'
import {
  computeCuratedChart,
  isCuratedChartId,
  isValidCuratedDate,
  listCuratedChartDescriptors
} from './curated-analytics.js'
import { readSiteConfig, writeSiteConfig } from './config.js'
import { parseEnabledStrategiesKv } from './enabled-strategies.js'
import {
  buildDestinationRows,
  computeDashboardMetrics,
  computeSignalRecovery,
  readDriftMismatch,
  readRecentLogs
} from './observability.js'
export const PORTAL_API_PREFIX = '/__attestrack__/portal/v1'

/**
 * PORTAL.1 authn stance (P7.3): every route under {@link PORTAL_API_PREFIX} is
 * **unauthenticated by design** — Cloudflare Access is assumed in front of the
 * Worker hostname serving the portal API. WITHOUT Access (or the shared secret
 * below) this is a world-readable AND world-writable operator config API
 * (`/strategies/toggle`, `/site-config/trusted-domains`, saved-query writes).
 *
 * Optional defense-in-depth: when the Worker secret
 * {@link PORTAL_SHARED_SECRET_NAME} is configured, every portal-prefix request
 * must carry the {@link PORTAL_SHARED_SECRET_HEADER} header with the exact
 * secret value (constant-time compare) or it gets `401 portal_unauthorized`.
 * When the secret is NOT configured, behavior is unchanged (Access-fronted
 * default). Note: enabling it also gates GET routes, so the community portal
 * SPA can only talk to the Worker through something that injects the header
 * (reverse proxy, API client) — the secret must never be embedded in the
 * public SPA bundle.
 */
export const PORTAL_SHARED_SECRET_NAME = 'PORTAL_API_SHARED_SECRET'
export const PORTAL_SHARED_SECRET_HEADER = 'x-attestrack-portal-secret'

const te = new TextEncoder()

/** Constant-time string compare (length-oblivious loop; no early content exit). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = te.encode(a)
  const bb = te.encode(b)
  let diff = ab.length ^ bb.length
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i += 1) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

function portalUnauthorizedResponse(): Response {
  return Response.json(
    {
      error: 'portal_unauthorized',
      message: `Portal API shared secret is configured; send the ${PORTAL_SHARED_SECRET_HEADER} header.`
    },
    { status: 401, headers: { 'cache-control': 'no-store' } }
  )
}

const ATTESTRUE_UPGRADE_ORIGIN = 'https://attestrue.com'

/** Policy/banner/enforcement mutations are Attestrue (worker-extension + licensed portal), not OSS. */
export function requiresAttestruePortalResponse(): Response {
  return Response.json(
    {
      error: 'requires_attestrue',
      message:
        'This portal API is provided by Attestrue extensions after upgrade. Use Upgrade in the community portal.',
      handoff: `${ATTESTRUE_UPGRADE_ORIGIN}/upgrade`
    },
    { status: 403, headers: { 'cache-control': 'no-store' } }
  )
}

/** KV shape is Zod-validated (P4.4): corrupt entries are dropped, never served. */
async function readSavedQueries(host: HostRuntime): Promise<SavedQueryEntryV1[]> {
  return parseSavedQueriesKv(await host.kv.get(KV_KEY_PORTAL_SAVED_QUERIES))
}

async function writeSavedQueries(host: HostRuntime, list: SavedQueryEntryV1[]): Promise<void> {
  await host.kv.put(KV_KEY_PORTAL_SAVED_QUERIES, JSON.stringify(list))
}

/**
 * Per-user identity for saved-query pinning (EXP.10): the CF Access header.
 * Without Access (the header is absent) pins fall back to one shared anonymous
 * identity (`''`) — documented in REPO-SPEC-OSS; Access is assumed (PORTAL.1).
 */
export const CF_ACCESS_EMAIL_HEADER = 'Cf-Access-Authenticated-User-Email'

function requestUserEmail(request: Request): string {
  return request.headers.get(CF_ACCESS_EMAIL_HEADER)?.trim().toLowerCase() ?? ''
}

/** Client view: the requester's own pin only — pins are personal (EXP.10). */
interface SavedQueryClientView {
  id: string
  name: string
  sql: string
  updatedAt: string
  pinned: boolean
  pinnedChart?: SavedQueryChartConfig
}

function savedQueryClientView(entry: SavedQueryEntryV1, user: string): SavedQueryClientView {
  const pin = entry.pins?.find((p) => p.user === user)
  return {
    id: entry.id,
    name: entry.name,
    sql: entry.sql,
    updatedAt: entry.updatedAt,
    pinned: pin !== undefined,
    ...(pin ? { pinnedChart: pin.chart } : {})
  }
}

async function jsonFromKv(host: HostRuntime, key: string, fallback: unknown): Promise<Response> {
  const raw = await host.kv.get(key)
  if (!raw) {
    return Response.json(fallback, { headers: { 'cache-control': 'no-store' } })
  }
  try {
    return Response.json(JSON.parse(raw) as unknown, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return Response.json(fallback, { headers: { 'cache-control': 'no-store' } })
  }
}

const defaultStrategies = {
  builtin: [],
  proofLayer: []
}

export async function handlePortalRequest(request: Request, host: HostRuntime): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(PORTAL_API_PREFIX)) return null

  // P7.3 defense-in-depth: optional shared-secret gate over the WHOLE portal
  // API (reads and writes). No-op when the secret is not configured.
  const sharedSecret = host.getSecret(PORTAL_SHARED_SECRET_NAME)
  if (sharedSecret !== undefined && sharedSecret !== '') {
    const provided = request.headers.get(PORTAL_SHARED_SECRET_HEADER)
    if (provided === null || !constantTimeEquals(provided, sharedSecret)) {
      return portalUnauthorizedResponse()
    }
  }

  const sub = url.pathname.slice(PORTAL_API_PREFIX.length) || '/'

  if (request.method === 'GET') {
    if (sub === '/site-config' || sub === '/configuration') {
      const cfg = await readSiteConfig(host)
      return Response.json(cfg, { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/strategies') {
      return jsonFromKv(host, KV_KEY_PORTAL_STRATEGIES, defaultStrategies)
    }
    if (sub === '/dashboard') {
      // P3.2: computed from real KV counters + delivery stats + drift state —
      // any operator-seeded dashboard JSON (the pre-P3 KV key) is intentionally ignored.
      const cfg = await readSiteConfig(host)
      const enabledIds = parseEnabledStrategiesKv(await host.kv.get(KV_KEY_ENABLED_STRATEGIES))
      const metrics = await computeDashboardMetrics(host, cfg, enabledIds)
      return Response.json(metrics, { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/destinations') {
      // P3.1: real per-strategy delivery outcomes (STR.4), not seeded JSON.
      const enabledIds = parseEnabledStrategiesKv(await host.kv.get(KV_KEY_ENABLED_STRATEGIES))
      const rows = await buildDestinationRows(host, enabledIds)
      return Response.json(rows, { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/alert-rules') {
      // Operator-defined rules from KV (config, not metrics) + a synthetic row
      // when config drift is currently detected (P3.5).
      const cfg = await readSiteConfig(host)
      const rulesRaw = await host.kv.get(KV_KEY_PORTAL_ALERT_RULES)
      let rules: unknown[] = []
      if (rulesRaw) {
        try {
          const parsed = JSON.parse(rulesRaw) as unknown
          rules = Array.isArray(parsed) ? parsed : []
        } catch {
          rules = []
        }
      }
      const mismatch = cfg.driftDetection.enabled ? await readDriftMismatch(host.kv) : null
      const withDrift =
        mismatch === null
          ? rules
          : [
              {
                destination: 'consent-config',
                condition: `Drift detected at ${mismatch.at}: consent config fingerprint no longer matches the deploy-time expected value`,
                email: '',
                active: true
              },
              ...rules
            ]
      return Response.json(withDrift, { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/logs' || sub === '/logs/incoming') {
      // P3.1: bounded per-hour KV log ring written on real ingest traffic.
      const logs = await readRecentLogs(host.kv)
      return Response.json(logs, { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/signal' || sub === '/signal-recovery') {
      // P3.3 decision: recovery is NOT measured in v1 (requires a client
      // beacon); only the real bot-filter counter is reported.
      const payload = await computeSignalRecovery(host)
      return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
    }
    if (sub.startsWith('/signal-recovery/timeline')) {
      // De-scoped with /signal (P3.3): empty until a beacon exists — never invented points.
      return Response.json([], { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/analytics/curated') {
      // P4.3: metadata only — chart numbers come from POST (computed per chart,
      // canned SQL through the Explore gate). Never operator-seeded series.
      return Response.json(
        {
          charts: listCuratedChartDescriptors(),
          warehouseConfigured: isExploreWarehouseConfigured(host)
        },
        { headers: { 'cache-control': 'no-store' } }
      )
    }
    if (sub === '/policy') {
      return requiresAttestruePortalResponse()
    }
    if (sub === '/policy-versions') {
      return requiresAttestruePortalResponse()
    }
    if (sub === '/banner') {
      return requiresAttestruePortalResponse()
    }
    if (sub === '/banner/history') {
      return requiresAttestruePortalResponse()
    }
    if (sub === '/explore/saved-queries') {
      const user = requestUserEmail(request)
      const list = (await readSavedQueries(host)).map((q) => savedQueryClientView(q, user))
      return Response.json(list, { headers: { 'cache-control': 'no-store' } })
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  if (request.method === 'POST') {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 })
    }

    if (sub === '/explore/query') {
      const sql = typeof (body as { sql?: unknown }).sql === 'string' ? (body as { sql: string }).sql : ''
      const gated = validateAndNormalizeExploreSql(sql)
      if (!gated.ok) {
        const payload = exploreGateErrorPayload(gated.code, gated.reason)
        return Response.json({ ...payload, reason: gated.reason }, { status: 400 })
      }
      const wh = await executeExploreSql(host, gated.sqlNormalized)
      if (!wh.ok) {
        return Response.json(
          { error: wh.error, details: wh.details },
          { status: wh.status }
        )
      }
      return Response.json(
        {
          columns: wh.columns,
          rows: wh.rows,
          rowCount: wh.rowCount,
          truncated: wh.truncated
        },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    if (sub === '/explore/saved-queries') {
      const name = (body as { name?: unknown }).name
      const sql = (body as { sql?: unknown }).sql
      if (typeof name !== 'string' || typeof sql !== 'string') {
        return Response.json(
          { error: 'invalid_body', details: { code: 'saved_query_name_sql_required' } },
          { status: 400 }
        )
      }
      const gated = validateAndNormalizeExploreSql(sql)
      if (!gated.ok) {
        const payload = exploreGateErrorPayload(gated.code, gated.reason)
        return Response.json({ ...payload, reason: gated.reason }, { status: 400 })
      }
      void gated.sqlNormalized
      const list = await readSavedQueries(host)
      if (list.length >= SAVED_QUERIES_MAX_ENTRIES) {
        return Response.json(
          {
            error: 'saved_queries_limit',
            details: { code: 'saved_queries_limit', max: SAVED_QUERIES_MAX_ENTRIES }
          },
          { status: 400 }
        )
      }
      const entry: SavedQueryEntryV1 = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 120) || 'Untitled',
        sql: sql.trim(),
        updatedAt: new Date().toISOString()
      }
      list.push(entry)
      await writeSavedQueries(host, list)
      return Response.json(
        { success: true, query: savedQueryClientView(entry, requestUserEmail(request)) },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    if (sub === '/explore/saved-queries/remove') {
      const id = (body as { id?: unknown }).id
      if (typeof id !== 'string') {
        return Response.json(
          { error: 'invalid_body', details: { code: 'saved_query_id_required' } },
          { status: 400 }
        )
      }
      const list = (await readSavedQueries(host)).filter((q) => q.id !== id)
      await writeSavedQueries(host, list)
      return Response.json({ success: true }, { headers: { 'cache-control': 'no-store' } })
    }

    if (sub === '/explore/saved-queries/pin') {
      // EXP.10 — per-user pin/unpin with a user-directed chart config (EXP.8).
      const id = (body as { id?: unknown }).id
      const pinned = (body as { pinned?: unknown }).pinned
      if (typeof id !== 'string' || typeof pinned !== 'boolean') {
        return Response.json(
          { error: 'invalid_body', details: { code: 'saved_query_pin_body_invalid' } },
          { status: 400 }
        )
      }
      const list = await readSavedQueries(host)
      const entry = list.find((q) => q.id === id)
      if (!entry) {
        return Response.json(
          { error: 'not_found', details: { code: 'saved_query_not_found' } },
          { status: 404 }
        )
      }
      const user = requestUserEmail(request)
      const pins = (entry.pins ?? []).filter((p) => p.user !== user)
      if (pinned) {
        const chartRaw = (body as { chart?: unknown }).chart ?? { chartType: 'table' }
        const chart = savedQueryChartConfigSchema.safeParse(chartRaw)
        if (!chart.success) {
          return Response.json(
            {
              error: 'invalid_body',
              details: { code: 'saved_query_chart_invalid', issues: chart.error.flatten() }
            },
            { status: 400 }
          )
        }
        pins.push({ user, pinnedAt: new Date().toISOString(), chart: chart.data })
      }
      // Keep within the Zod shape's pins cap (oldest dropped) so the entry
      // never fails read-side validation and silently disappears.
      entry.pins = pins.length > 50 ? pins.slice(-50) : pins
      await writeSavedQueries(host, list)
      return Response.json(
        { success: true, query: savedQueryClientView(entry, user) },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    if (sub === '/site-config/mode') {
      return requiresAttestruePortalResponse()
    }

    if (sub === '/site-config/trusted-domains') {
      const domains = (body as { domains?: unknown }).domains
      if (!Array.isArray(domains) || !domains.every((d) => typeof d === 'string')) {
        return Response.json({ error: 'invalid_domains' }, { status: 400 })
      }
      const cfg = await readSiteConfig(host)
      cfg.trustedDomains = domains as string[]
      await writeSiteConfig(host, cfg)
      return Response.json({ success: true })
    }

    if (sub === '/analytics/curated') {
      // P4.3 — one curated chart per request (ANA.6: charts load independently).
      // Warehouse charts are canned SQL through the SAME Explore gate + executor.
      const chartId = (body as { chartId?: unknown }).chartId
      const dateFrom = (body as { dateFrom?: unknown }).dateFrom
      const dateTo = (body as { dateTo?: unknown }).dateTo
      if (
        !isCuratedChartId(chartId) ||
        !isValidCuratedDate(dateFrom) ||
        !isValidCuratedDate(dateTo) ||
        dateFrom > dateTo
      ) {
        return Response.json(
          { error: 'invalid_body', details: { code: 'curated_chart_request_invalid' } },
          { status: 400 }
        )
      }
      const enabledIds = parseEnabledStrategiesKv(await host.kv.get(KV_KEY_ENABLED_STRATEGIES))
      const chart = await computeCuratedChart(host, enabledIds, chartId, dateFrom, dateTo)
      return Response.json(chart, { headers: { 'cache-control': 'no-store' } })
    }

    if (sub === '/analytics/warehouse-status') {
      const configured = isExploreWarehouseConfigured(host)
      return Response.json(
        {
          configured,
          message: configured
            ? 'Warehouse credentials detected for Explore.'
            : 'Configure TINYBIRD_TOKEN or CLICKHOUSE_QUERY_URL (or CLICKHOUSE_HTTP_URL) on the Worker.'
        },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    if (sub === '/policy-versions') {
      return requiresAttestruePortalResponse()
    }
    if (sub === '/banner') {
      return requiresAttestruePortalResponse()
    }

    if (sub === '/strategies/toggle') {
      const id = (body as { id?: string }).id
      const enabled = (body as { enabled?: boolean }).enabled
      if (typeof id !== 'string' || typeof enabled !== 'boolean') {
        return Response.json({ error: 'invalid_body' }, { status: 400 })
      }
      const raw = await host.kv.get(KV_KEY_PORTAL_STRATEGIES)
      let parsed: { builtin?: { id: string; status: string }[] } = { builtin: [] }
      if (raw && typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw) as { builtin?: { id: string; status: string }[] }
        } catch {
          parsed = { builtin: [] }
        }
      }
      const builtin = Array.isArray(parsed.builtin) ? parsed.builtin : []
      const next = builtin.map((row) =>
        row.id === id ? { ...row, status: enabled ? 'active' : 'inactive' } : row
      )
      await host.kv.put(KV_KEY_PORTAL_STRATEGIES, JSON.stringify({ ...parsed, builtin: next }))
      return Response.json({ success: true })
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  return Response.json({ error: 'method_not_allowed' }, { status: 405 })
}
