import {
  ATTESTRACK_EXPLORE_ALLOWED_TABLES,
  ATTESTRACK_EXPLORE_MAX_ROWS
} from '@attestrack/types'

export const EXPLORE_MAX_ROWS = ATTESTRACK_EXPLORE_MAX_ROWS

const ALLOWED_TABLES = new Set(
  ATTESTRACK_EXPLORE_ALLOWED_TABLES.map((t: (typeof ATTESTRACK_EXPLORE_ALLOWED_TABLES)[number]) =>
    t.toLowerCase()
  )
)

const SELECT_LEADING = /^\s*select\b/i
const FORBIDDEN_KEYWORD =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|union|into\s+outfile|copy\s+from|attach\s+database|detach|optimize\s+table|system\.)\b/i

export type ExploreSqlGateResult =
  | { ok: true; sqlNormalized: string }
  | { ok: false; code: string; reason: string }

function stripRoughStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''")
}

function hasMultipleStatements(sql: string): boolean {
  return stripRoughStrings(sql).includes(';')
}

function extractTableIdentifiers(sql: string): string[] {
  const out: string[] = []
  const re = /\b(?:FROM|JOIN)\s+([`"]?)([a-zA-Z_][a-zA-Z0-9_]*)\1/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const id = m[2]
    if (id) out.push(id.toLowerCase())
  }
  return out
}

function hasSubqueryFrom(sql: string): boolean {
  return /\bFROM\s*\(/i.test(sql)
}

function applyRowLimit(sql: string, maxRows: number): string {
  const trimmed = sql.trim().replace(/;\s*$/u, '')
  const limitMatch = trimmed.match(/\blimit\s+(\d+)\s*$/i)
  if (limitMatch && limitMatch.index !== undefined && limitMatch[1] !== undefined) {
    const n = Math.min(parseInt(limitMatch[1], 10), maxRows)
    const base = trimmed.slice(0, limitMatch.index).trim()
    return `${base} LIMIT ${n}`
  }
  return `${trimmed} LIMIT ${maxRows}`
}

export function validateAndNormalizeExploreSql(
  raw: string,
  maxRows = EXPLORE_MAX_ROWS
): ExploreSqlGateResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, code: 'explore_sql_empty', reason: 'Query is empty.' }
  }
  if (hasMultipleStatements(trimmed)) {
    return {
      ok: false,
      code: 'explore_sql_multiple_statements',
      reason: 'Only a single SELECT statement is allowed.'
    }
  }
  const sql = trimmed.replace(/;\s*$/u, '').trim()
  if (!SELECT_LEADING.test(sql)) {
    return { ok: false, code: 'explore_sql_not_select', reason: 'Only SELECT queries are allowed.' }
  }
  if (FORBIDDEN_KEYWORD.test(sql)) {
    return {
      ok: false,
      code: 'explore_sql_forbidden_keyword',
      reason: 'Statement contains forbidden keywords.'
    }
  }
  if (hasSubqueryFrom(sql)) {
    return {
      ok: false,
      code: 'explore_sql_subquery_from',
      reason: 'Derived tables in FROM are not allowed in community Explore.'
    }
  }
  const tables = extractTableIdentifiers(sql)
  if (tables.length === 0) {
    return { ok: false, code: 'explore_sql_no_from', reason: 'Query must read from an allowed table.' }
  }
  for (const t of tables) {
    if (!ALLOWED_TABLES.has(t)) {
      return {
        ok: false,
        code: 'explore_sql_table_not_allowed',
        reason: `Table "${t}" is not on the Attestrack allowlist (INV-B-15).`
      }
    }
  }
  return { ok: true, sqlNormalized: applyRowLimit(sql, maxRows) }
}

export function exploreGateErrorPayload(code: string, reason: string): Record<string, unknown> {
  return {
    error: 'invalid_sql',
    details: {
      code,
      reason
    }
  }
}
