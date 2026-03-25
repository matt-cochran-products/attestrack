import { describe, expect, it } from 'vitest'
import { validateAndNormalizeExploreSql } from '../src/explore-sql.js'

describe('validateAndNormalizeExploreSql', () => {
  it('rejects empty', () => {
    const r = validateAndNormalizeExploreSql('  ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_empty')
  })

  it('rejects non-allowlisted table', () => {
    const r = validateAndNormalizeExploreSql('SELECT * FROM users')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_table_not_allowed')
  })

  it('accepts events and appends LIMIT', () => {
    const r = validateAndNormalizeExploreSql('SELECT 1 FROM events')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized.toLowerCase()).toMatch(/limit\s+500$/)
  })

  it('clamps explicit LIMIT', () => {
    const r = validateAndNormalizeExploreSql('SELECT x FROM events LIMIT 9999')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sqlNormalized.toLowerCase()).toMatch(/limit\s+500$/)
  })

  it('rejects UNION', () => {
    const r = validateAndNormalizeExploreSql('SELECT 1 FROM events UNION SELECT 2 FROM events')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('explore_sql_forbidden_keyword')
  })
})
