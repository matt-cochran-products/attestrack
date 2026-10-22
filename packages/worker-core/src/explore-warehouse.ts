import type { HostRuntime } from '@attestrack/host-contracts'
import { EXPLORE_MAX_ROWS } from '@attestrack/schema'

export type ExploreWarehouseOk = {
  ok: true
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
}

export type ExploreWarehouseErr = {
  ok: false
  status: number
  error: string
  details: Record<string, unknown>
}

export function isExploreWarehouseConfigured(host: HostRuntime): boolean {
  return !!(host.getSecret('TINYBIRD_TOKEN') || clickhouseQueryBase(host))
}

function clickhouseQueryBase(host: HostRuntime): string {
  const explicit = host.getSecret('CLICKHOUSE_QUERY_URL')?.trim().replace(/\/$/u, '')
  if (explicit) return explicit
  const http = host.getSecret('CLICKHOUSE_HTTP_URL')?.trim()
  if (!http) return ''
  try {
    return new URL(http).origin
  } catch {
    return ''
  }
}

function parseClickHouseJson(text: string): ExploreWarehouseOk | ExploreWarehouseErr {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return {
      ok: false,
      status: 502,
      error: 'explore_warehouse_bad_response',
      details: { reason: 'ClickHouse returned non-JSON.', sample: text.slice(0, 200) }
    }
  }
  const p = parsed as {
    data?: Record<string, unknown>[]
    meta?: { name: string }[]
    rows?: number
    exception?: string
  }
  if (typeof p.exception === 'string') {
    return {
      ok: false,
      status: 400,
      error: 'explore_warehouse_rejected',
      details: { reason: p.exception }
    }
  }
  const data = Array.isArray(p.data) ? p.data : []
  const columns = Array.isArray(p.meta) ? p.meta.map((m) => m.name).filter(Boolean) : []
  const rowCount = data.length
  return {
    ok: true,
    columns,
    rows: data,
    rowCount,
    truncated: rowCount >= EXPLORE_MAX_ROWS
  }
}

async function runClickHouse(
  host: HostRuntime,
  base: string,
  sqlNormalized: string
): Promise<ExploreWarehouseOk | ExploreWarehouseErr> {
  const user = host.getSecret('CLICKHOUSE_USER')
  const pass = host.getSecret('CLICKHOUSE_PASSWORD')
  const auth =
    user && pass ? `Basic ${globalThis.btoa(`${user}:${pass}`)}` : undefined
  const url = `${base}/`
  let res: Response
  try {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        'content-type': 'text/plain; charset=utf-8'
      },
      body: `${sqlNormalized}\nFORMAT JSON\n`
    }
    res = host.fetchOutbound
      ? await host.fetchOutbound('CLICKHOUSE_PRIVATE', url, requestInit)
      : await fetch(url, requestInit)
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: 'explore_warehouse_fetch_failed',
      details: {
        reason: e instanceof Error ? e.message : String(e),
        target: 'clickhouse'
      }
    }
  }
  const text = await res.text()
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 400 ? 400 : 502,
      error: 'explore_warehouse_http_error',
      details: { reason: text.slice(0, 500), status: res.status, target: 'clickhouse' }
    }
  }
  return parseClickHouseJson(text)
}

async function runTinybird(
  host: HostRuntime,
  token: string,
  sqlNormalized: string
): Promise<ExploreWarehouseOk | ExploreWarehouseErr> {
  const apiRoot = (host.getSecret('TINYBIRD_API_URL') ?? 'https://api.tinybird.co').replace(/\/$/u, '')
  const q = encodeURIComponent(sqlNormalized)
  const url = `${apiRoot}/v0/sql?q=${q}&default_format=JSON`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: 'explore_warehouse_fetch_failed',
      details: {
        reason: e instanceof Error ? e.message : String(e),
        target: 'tinybird'
      }
    }
  }
  const text = await res.text()
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 400 ? 400 : 502,
      error: 'explore_warehouse_http_error',
      details: { reason: text.slice(0, 500), status: res.status, target: 'tinybird' }
    }
  }
  return parseClickHouseJson(text)
}

export async function executeExploreSql(
  host: HostRuntime,
  sqlNormalized: string
): Promise<ExploreWarehouseOk | ExploreWarehouseErr> {
  const tinybirdToken = host.getSecret('TINYBIRD_TOKEN')
  if (tinybirdToken) {
    return runTinybird(host, tinybirdToken, sqlNormalized)
  }
  const chBase = clickhouseQueryBase(host)
  if (chBase) {
    return runClickHouse(host, chBase, sqlNormalized)
  }
  return {
    ok: false,
    status: 503,
    error: 'explore_warehouse_not_configured',
    details: {
      reason:
        'No warehouse credentials: set TINYBIRD_TOKEN or CLICKHOUSE_QUERY_URL (or CLICKHOUSE_HTTP_URL for origin-only query base).',
      code: 'explore_warehouse_not_configured'
    }
  }
}
