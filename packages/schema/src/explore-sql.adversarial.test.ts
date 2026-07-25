import { describe, expect, it } from 'vitest'
import { validateAndNormalizeExploreSql } from './explore-sql.js'

/** INV-B-15 adversarial corpus — every one of these MUST be rejected (or, for the
 *  string-literal case, accepted-but-inert). These are the bypasses the old
 *  first-identifier-only regex + `default`-in-allowlist let through. */

const MUST_REJECT: Array<[string, string, string]> = [
  // The headline bypass: `default` is a ClickHouse database, not a table.
  ['qualified default.table', 'SELECT * FROM default.secret_table', 'explore_sql_qualified_table'],
  ['qualified events.table', 'SELECT * FROM events.other', 'explore_sql_qualified_table'],
  ['qualified with spaces around dot', 'SELECT * FROM default . secret', 'explore_sql_qualified_table'],
  ['backtick-qualified', 'SELECT * FROM `default`.`secret`', 'explore_sql_qualified_table'],
  ['double-quote-qualified', 'SELECT * FROM "default"."secret"', 'explore_sql_qualified_table'],
  ['qualified in JOIN', 'SELECT * FROM events JOIN default.secret ON 1=1', 'explore_sql_qualified_table'],
  // bare `default` is no longer allowlisted at all
  ['bare default database', 'SELECT * FROM default', 'explore_sql_table_not_allowed'],
  // comment-based evasion
  ['line comment', 'SELECT * FROM events -- ; DROP TABLE x', 'explore_sql_comment_not_allowed'],
  ['block comment', 'SELECT /* hi */ 1 FROM events', 'explore_sql_comment_not_allowed'],
  ['comment-hidden second LIMIT', 'SELECT * FROM events LIMIT 5 -- LIMIT 9999999', 'explore_sql_comment_not_allowed'],
  // structural
  ['multiple statements', 'SELECT * FROM events; SELECT * FROM secret', 'explore_sql_multiple_statements'],
  ['subquery FROM', 'SELECT * FROM (SELECT * FROM secret) t', 'explore_sql_subquery_from'],
  ['INTO OUTFILE', "SELECT * FROM events INTO OUTFILE '/tmp/x'", 'explore_sql_forbidden_keyword'],
  ['SYSTEM table', 'SELECT * FROM system.tables', 'explore_sql_forbidden_keyword'],
  ['non-select', 'WITH x AS (SELECT 1) SELECT * FROM events', 'explore_sql_not_select'],
  ['non-allowlisted bare', 'SELECT * FROM users', 'explore_sql_table_not_allowed']
]

describe('explore SQL gate — adversarial (INV-B-15)', () => {
  for (const [name, sql, code] of MUST_REJECT) {
    it(`rejects: ${name}`, () => {
      const r = validateAndNormalizeExploreSql(sql)
      expect(r.ok, `expected reject for: ${sql}`).toBe(false)
      if (!r.ok) expect(r.code).toBe(code)
    })
  }

  it('accepts an allowlisted table and dangerous-looking STRING content (inert)', () => {
    // A dotted/keyword payload inside a string literal is data, not structure.
    const r = validateAndNormalizeExploreSql("SELECT 'default.x; DROP TABLE y' AS note FROM events")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized.toLowerCase()).toMatch(/limit\s+500$/)
  })

  it('accepts both allowlisted tables case/space-insensitively', () => {
    expect(validateAndNormalizeExploreSql('select  x  from   Events').ok).toBe(true)
    expect(validateAndNormalizeExploreSql('SELECT x FROM attestrack_events').ok).toBe(true)
  })

  // Property-ish fuzz: any qualified name is rejected, regardless of the db/table.
  it('rejects every qualified db.table combination', () => {
    const dbs = ['default', 'events', 'system', 'information_schema', 'x_db', 'DEFAULT']
    const tbls = ['events', 'secret', 'passwords', 'attestrack_events']
    for (const d of dbs) {
      for (const t of tbls) {
        const r = validateAndNormalizeExploreSql(`SELECT * FROM ${d}.${t}`)
        expect(r.ok, `qualified ${d}.${t} must be rejected`).toBe(false)
      }
    }
  })
})
