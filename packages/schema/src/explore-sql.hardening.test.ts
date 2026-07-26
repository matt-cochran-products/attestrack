import { describe, expect, it } from 'vitest'
import {
  validateAndNormalizeExploreSql,
  exploreGateErrorPayload,
  EXPLORE_MAX_ROWS
} from './explore-sql.js'

/**
 * Mutation-hardening suite (companion to explore-sql.adversarial.test.ts).
 * These pin down behaviour the adversarial "MUST reject" corpus exercised but
 * never *asserted* — every case here kills a Stryker mutant that survived the
 * adversarial suite alone. Keep it precise: assert exact codes and exact
 * normalized output, not just ok/!ok.
 */

describe('explore SQL gate — accepted-query normalization', () => {
  it('appends LIMIT <max> when the query has no LIMIT', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized).toBe(`SELECT x FROM events LIMIT ${EXPLORE_MAX_ROWS}`)
  })

  it('keeps a user LIMIT that is below the max verbatim', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events LIMIT 5')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized).toBe('SELECT x FROM events LIMIT 5')
  })

  it('clamps a user LIMIT that exceeds the max down to the max', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events LIMIT 999999')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized).toBe(`SELECT x FROM events LIMIT ${EXPLORE_MAX_ROWS}`)
  })

  it('respects an explicit maxRows argument for both clamp and append', () => {
    const clamp = validateAndNormalizeExploreSql('SELECT x FROM events LIMIT 40', 10)
    expect(clamp.ok).toBe(true)
    if (clamp.ok) expect(clamp.sqlNormalized).toBe('SELECT x FROM events LIMIT 10')

    const append = validateAndNormalizeExploreSql('SELECT x FROM events', 10)
    expect(append.ok).toBe(true)
    if (append.ok) expect(append.sqlNormalized).toBe('SELECT x FROM events LIMIT 10')
  })

  it('keeps a below-max LIMIT that equals a boundary value', () => {
    const r = validateAndNormalizeExploreSql(`SELECT x FROM events LIMIT ${EXPLORE_MAX_ROWS}`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized).toBe(`SELECT x FROM events LIMIT ${EXPLORE_MAX_ROWS}`)
  })
})

describe('explore SQL gate — trailing semicolon is allowed (single statement)', () => {
  // A single optional trailing `;` must NOT be read as a second statement, and
  // must be stripped from the normalized output. These kill the `/;\s*$/`
  // regex mutants in hasMultipleStatements / applyRowLimit.
  it('accepts a trailing semicolon with no whitespace', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events;')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sqlNormalized).toBe(`SELECT x FROM events LIMIT ${EXPLORE_MAX_ROWS}`)
      expect(r.sqlNormalized).not.toContain(';')
    }
  })

  it('accepts a trailing semicolon followed by whitespace', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events;   ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized).toBe(`SELECT x FROM events LIMIT ${EXPLORE_MAX_ROWS}`)
  })

  it('still rejects a genuine second statement after the semicolon', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events; SELECT 1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_multiple_statements')
  })
})

describe('explore SQL gate — quoted table identifiers', () => {
  // The quote/backtick stripping in extractTables must yield the bare name so it
  // is checked against the allowlist. Kills the identifier-strip mutants.
  it('accepts a back-quoted allowlisted table', () => {
    expect(validateAndNormalizeExploreSql('SELECT * FROM `events`').ok).toBe(true)
  })

  it('accepts a double-quoted allowlisted table', () => {
    expect(validateAndNormalizeExploreSql('SELECT * FROM "attestrack_events"').ok).toBe(true)
  })

  it('rejects a back-quoted NON-allowlisted table (strip must not smuggle it past the allowlist)', () => {
    const r = validateAndNormalizeExploreSql('SELECT * FROM `users`')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_table_not_allowed')
  })
})

describe('explore SQL gate — query with no table read', () => {
  // Kills the (previously NoCoverage) explore_sql_no_from branch.
  it('rejects a SELECT with no FROM clause', () => {
    const r = validateAndNormalizeExploreSql('SELECT 1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_no_from')
  })

  it('rejects SELECT of a constant expression with no FROM', () => {
    const r = validateAndNormalizeExploreSql('SELECT now()')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_no_from')
  })
})

describe('explore SQL gate — every rejection carries a non-empty code AND reason', () => {
  // The `reason` is part of the gate's API contract (surfaced to the caller via
  // exploreGateErrorPayload). Asserting it is non-empty for every rejection kills
  // the reason→"" string mutants that code-only assertions leave alive.
  const REJECTIONS: Array<[string, string, string]> = [
    ['empty', '   ', 'explore_sql_empty'],
    ['comment', 'SELECT * FROM events -- x', 'explore_sql_comment_not_allowed'],
    ['multiple statements', 'SELECT * FROM events; SELECT 1', 'explore_sql_multiple_statements'],
    ['not select', 'WITH x AS (SELECT 1) SELECT 1', 'explore_sql_not_select'],
    ['forbidden keyword', 'SELECT * FROM events UNION SELECT 1', 'explore_sql_forbidden_keyword'],
    ['subquery from', 'SELECT * FROM (SELECT 1) t', 'explore_sql_subquery_from'],
    ['qualified table', 'SELECT * FROM default.secret', 'explore_sql_qualified_table'],
    ['no from', 'SELECT 1', 'explore_sql_no_from'],
    ['table not allowed', 'SELECT * FROM users', 'explore_sql_table_not_allowed']
  ]
  for (const [name, sql, code] of REJECTIONS) {
    it(`${name}: code=${code} with a non-empty reason`, () => {
      const r = validateAndNormalizeExploreSql(sql)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe(code)
        expect(typeof r.reason).toBe('string')
        expect(r.reason.length).toBeGreaterThan(0)
      }
    })
  }
})

describe('explore SQL gate — forbidden keyword coverage', () => {
  // Exercise a representative slice of the FORBIDDEN_KEYWORD alternation so a
  // mutation that drops/weakens the regex fails at least one case. Each keyword
  // is embedded after a valid SELECT…FROM so the forbidden-keyword check (not an
  // earlier gate) is what rejects it.
  const KEYWORDS = [
    'insert', 'update', 'delete', 'drop', 'alter', 'truncate', 'create', 'rename',
    'grant', 'revoke', 'union', 'into', 'outfile', 'infile', 'copy', 'detach', 'system'
  ]
  for (const kw of KEYWORDS) {
    it(`rejects a query containing "${kw}"`, () => {
      const r = validateAndNormalizeExploreSql(`SELECT * FROM events ${kw} x`)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('explore_sql_forbidden_keyword')
    })
  }
})

describe('explore SQL gate — multi-word forbidden phrases', () => {
  // `attach\s+database` / `optimize\s+table` must match one OR more spaces.
  for (const phrase of ['attach database', 'attach  database', 'optimize table', 'optimize  table']) {
    it(`rejects "${phrase}"`, () => {
      const r = validateAndNormalizeExploreSql(`SELECT * FROM events ${phrase} x`)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('explore_sql_forbidden_keyword')
    })
  }
})

describe('explore SQL gate — structural edge cases', () => {
  it('rejects a derived table in FROM even with NO space before the paren', () => {
    // `/\bfrom\s*\(/` must match `FROM(`; a mutant requiring a space would let it
    // fall through to the (misleading) no-from branch.
    const r = validateAndNormalizeExploreSql('SELECT * FROM(SELECT 1) t')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_subquery_from')
  })

  it('keeps a below-max LIMIT even with extra whitespace between LIMIT and the number', () => {
    // `\blimit\s+(\d+)` — a mutant narrowing `\s+` to `\s` would miss the number
    // and wrongly append the default limit instead of honouring the user value.
    const r = validateAndNormalizeExploreSql('SELECT x FROM events LIMIT  5')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized).toBe('SELECT x FROM events LIMIT 5')
  })
})

describe('exploreGateErrorPayload', () => {
  // Kills the (previously NoCoverage) error-payload helper mutants.
  it('wraps code + reason in the invalid_sql envelope shape', () => {
    expect(exploreGateErrorPayload('explore_sql_no_from', 'Query must read from an allowed table.')).toEqual({
      error: 'invalid_sql',
      details: {
        code: 'explore_sql_no_from',
        reason: 'Query must read from an allowed table.'
      }
    })
  })

  it('passes code and reason through unchanged (not swapped or dropped)', () => {
    const payload = exploreGateErrorPayload('C', 'R') as {
      error: string
      details: { code: string; reason: string }
    }
    expect(payload.error).toBe('invalid_sql')
    expect(payload.details.code).toBe('C')
    expect(payload.details.reason).toBe('R')
  })
})
