import type { HostRuntime } from '@attestrack/host-contracts'
import {
  KV_KEY_PORTAL_ANALYTICS,
  KV_KEY_PORTAL_ALERT_RULES,
  KV_KEY_PORTAL_DASHBOARD,
  KV_KEY_PORTAL_DESTINATIONS,
  KV_KEY_PORTAL_LOGS,
  KV_KEY_PORTAL_SAVED_QUERIES,
  KV_KEY_PORTAL_SIGNAL,
  KV_KEY_PORTAL_SITE_CONFIG,
  KV_KEY_PORTAL_STRATEGIES
} from '@attestrack/types'
import { exploreGateErrorPayload, validateAndNormalizeExploreSql } from '@attestrack/schema'
import { executeExploreSql, isExploreWarehouseConfigured } from './explore-warehouse.js'
export const PORTAL_API_PREFIX = '/__attestrack__/portal/v1'

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

type SiteMode = 'SHADOW' | 'ENFORCEMENT' | 'NOT_CONFIGURED'

interface SiteConfigKv {
  siteId: string
  domain: string
  workerVersion: string
  shadowStart: string
  enforcementStart: string | null
  mode: SiteMode
  consentConfigured: boolean
  state1TokenTTL: number
  ipHandling: string
  trustedDomains: string[]
  driftDetection: { enabled: boolean; quarantineNew: boolean; alertThreshold: number }
}

interface SavedQueryEntry {
  id: string
  name: string
  sql: string
  updatedAt: string
}

async function readSavedQueries(host: HostRuntime): Promise<SavedQueryEntry[]> {
  const raw = await host.kv.get(KV_KEY_PORTAL_SAVED_QUERIES)
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as SavedQueryEntry[]) : []
  } catch {
    return []
  }
}

async function writeSavedQueries(host: HostRuntime, list: SavedQueryEntry[]): Promise<void> {
  await host.kv.put(KV_KEY_PORTAL_SAVED_QUERIES, JSON.stringify(list))
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

const defaultSiteConfig: SiteConfigKv = {
  siteId: 'local',
  domain: 'example.com',
  workerVersion: '0.0.0',
  shadowStart: new Date().toISOString(),
  enforcementStart: null,
  mode: 'SHADOW',
  consentConfigured: true,
  state1TokenTTL: 86400,
  ipHandling: 'hash_salt',
  trustedDomains: [],
  driftDetection: { enabled: true, quarantineNew: false, alertThreshold: 0.05 }
}

const defaultStrategies = {
  builtin: [],
  proofLayer: []
}

async function readSiteConfig(host: HostRuntime): Promise<SiteConfigKv> {
  const raw = await host.kv.get(KV_KEY_PORTAL_SITE_CONFIG)
  if (!raw) return defaultSiteConfig
  try {
    const v = JSON.parse(raw) as Partial<SiteConfigKv>
    return { ...defaultSiteConfig, ...v }
  } catch {
    return defaultSiteConfig
  }
}

async function writeSiteConfig(host: HostRuntime, config: SiteConfigKv): Promise<void> {
  await host.kv.put(KV_KEY_PORTAL_SITE_CONFIG, JSON.stringify(config))
}

export async function handlePortalRequest(request: Request, host: HostRuntime): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(PORTAL_API_PREFIX)) return null

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
      return jsonFromKv(host, KV_KEY_PORTAL_DASHBOARD, {
        eventsToday: 0,
        driftAlertCount: 0,
        strategyStatus: 'all_healthy',
        strategySummary: '',
        shadowModeLabel: 'Validation — measurement & destinations'
      })
    }
    if (sub === '/destinations') {
      return jsonFromKv(host, KV_KEY_PORTAL_DESTINATIONS, [])
    }
    if (sub === '/alert-rules') {
      return jsonFromKv(host, KV_KEY_PORTAL_ALERT_RULES, [])
    }
    if (sub === '/logs' || sub === '/logs/incoming') {
      return jsonFromKv(host, KV_KEY_PORTAL_LOGS, [])
    }
    if (sub === '/signal' || sub === '/signal-recovery') {
      return jsonFromKv(host, KV_KEY_PORTAL_SIGNAL, {
        eventsFromBlockers: 0,
        blockersPct: 0,
        eventsFromITP: 0,
        itpPct: 0,
        cookieIdsPreserved: 0,
        botRequestsFiltered: 0
      })
    }
    if (sub.startsWith('/signal-recovery/timeline')) {
      return Response.json([], { headers: { 'cache-control': 'no-store' } })
    }
    if (sub === '/analytics/curated') {
      return jsonFromKv(host, KV_KEY_PORTAL_ANALYTICS, [])
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
      const list = await readSavedQueries(host)
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
      const entry: SavedQueryEntry = {
        id: crypto.randomUUID(),
        name: name.trim() || 'Untitled',
        sql: sql.trim(),
        updatedAt: new Date().toISOString()
      }
      list.push(entry)
      await writeSavedQueries(host, list)
      return Response.json({ success: true, query: entry }, { headers: { 'cache-control': 'no-store' } })
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
      return jsonFromKv(host, KV_KEY_PORTAL_ANALYTICS, [])
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
