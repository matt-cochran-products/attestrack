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
// Broadened over the original: also reject INTO/OUTFILE/INFILE, CREATE/RENAME, and
// bare SYSTEM (ClickHouse admin) — anything that writes, exfiltrates, or escalates.
const FORBIDDEN_KEYWORD =
  /\b(insert|update|delete|drop|alter|truncate|create|rename|grant|revoke|union|into|outfile|infile|copy|attach\s+database|detach|optimize\s+table|system)\b/i

export type ExploreSqlGateResult =
  | { ok: true; sqlNormalized: string }
  | { ok: false; code: string; reason: string }

/** Replace string literals with `''` so their contents (which may contain `;`,
 *  comment markers, keywords, or dotted names) can't fool the structural scan. */
function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''")
}

/** Strip a single optional trailing `;` (+ trailing whitespace) exactly once.
 *  Done up front so every downstream check works on one canonical form and the
 *  trailing separator is never stripped redundantly. */
function stripTrailingStatementTerminator(sql: string): string {
  return sql.replace(/;\s*$/u, '').trim()
}

/**
 * A SQL identifier: bare (`events`), back-quoted (`` `events` ``), or
 * double-quoted (`"events"`). Returns the tables read plus whether ANY reference
 * was **qualified** (`db.table`) — qualified names are rejected in community
 * Explore so an allowlisted DATABASE name (e.g. ClickHouse `default`) can't be
 * used to reach an arbitrary table (INV-B-15). Handles quoted + whitespace-padded
 * dotted parts, which the old first-identifier-only regex missed.
 */
function extractTables(scan: string): { names: string[]; qualified: boolean } {
  const ident = String.raw`(?:\`[^\`]+\`|"[^"]+"|[A-Za-z_]\w*)`
  const re = new RegExp(String.raw`\b(?:from|join)\s+(${ident})((?:\s*\.\s*${ident})+)?`, 'gi')
  const names: string[] = []
  let qualified = false
  let m: RegExpExecArray | null
  while ((m = re.exec(scan)) !== null) {
    if (m[2] && m[2].trim().length > 0) qualified = true
    const bare = (m[1] ?? '').replace(/^[`"]|[`"]$/g, '').toLowerCase()
    if (bare) names.push(bare)
  }
  return { names, qualified }
}

/** Clamp/append the LIMIT. `sql` is already trimmed and terminator-free. */
function applyRowLimit(sql: string, maxRows: number): string {
  const limitMatch = sql.match(/\blimit\s+(\d+)\s*$/i)
  if (limitMatch && limitMatch.index !== undefined && limitMatch[1] !== undefined) {
    const n = Math.min(parseInt(limitMatch[1], 10), maxRows)
    const base = sql.slice(0, limitMatch.index).trim()
    return `${base} LIMIT ${n}`
  }
  return `${sql} LIMIT ${maxRows}`
}

export function validateAndNormalizeExploreSql(
  raw: string,
  maxRows = EXPLORE_MAX_ROWS
): ExploreSqlGateResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, code: 'explore_sql_empty', reason: 'Query is empty.' }
  }

  // Canonical executable form: original string contents preserved (so the query
  // still runs), a single optional trailing `;` stripped exactly once.
  const execSql = stripTrailingStatementTerminator(trimmed)

  // Scan copy with string literals neutralized. All structural checks run on this
  // so nothing inside a quoted string can bypass the gate.
  const scan = stripStrings(execSql)

  // Reject SQL comments outright — a common evasion vector (comment-hiding of
  // keywords, statement separators, or a smuggled second LIMIT) and unnecessary
  // for Explore queries. "When in doubt, reject."
  if (/--|\/\*|\*\//.test(scan)) {
    return {
      ok: false,
      code: 'explore_sql_comment_not_allowed',
      reason: 'SQL comments are not allowed in community Explore.'
    }
  }
  // The trailing terminator is already gone; any remaining `;` is a 2nd statement.
  if (scan.includes(';')) {
    return {
      ok: false,
      code: 'explore_sql_multiple_statements',
      reason: 'Only a single SELECT statement is allowed.'
    }
  }
  if (!SELECT_LEADING.test(scan)) {
    return { ok: false, code: 'explore_sql_not_select', reason: 'Only SELECT queries are allowed.' }
  }
  if (FORBIDDEN_KEYWORD.test(scan)) {
    return {
      ok: false,
      code: 'explore_sql_forbidden_keyword',
      reason: 'Statement contains forbidden keywords.'
    }
  }
  if (/\bfrom\s*\(/i.test(scan)) {
    return {
      ok: false,
      code: 'explore_sql_subquery_from',
      reason: 'Derived tables in FROM are not allowed in community Explore.'
    }
  }

  const { names, qualified } = extractTables(scan)
  if (qualified) {
    return {
      ok: false,
      code: 'explore_sql_qualified_table',
      reason:
        'Qualified database.table names are not allowed; read from a bare allowlisted table (INV-B-15).'
    }
  }
  if (names.length === 0) {
    return { ok: false, code: 'explore_sql_no_from', reason: 'Query must read from an allowed table.' }
  }
  for (const t of names) {
    if (!ALLOWED_TABLES.has(t)) {
      return {
        ok: false,
        code: 'explore_sql_table_not_allowed',
        reason: `Table "${t}" is not on the Attestrack allowlist (INV-B-15).`
      }
    }
  }

  // Execute the canonical query (real string contents preserved; it contains no
  // comments — we rejected those — so the LIMIT clamp can't be commented out).
  return { ok: true, sqlNormalized: applyRowLimit(execSql, maxRows) }
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
