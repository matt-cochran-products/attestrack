import { describe, expect, it } from 'vitest'
import {
  SAVED_QUERIES_MAX_ENTRIES,
  parseSavedQueriesKv,
  savedQueryChartConfigSchema,
  savedQueryEntrySchema
} from '../src/portal-saved-queries.schema.js'

const valid = {
  id: 'q1',
  name: 'Events by name',
  sql: 'SELECT eventName, count() AS c FROM events GROUP BY eventName',
  updatedAt: '2026-07-25T00:00:00.000Z'
}

describe('savedQueryEntrySchema (P4.4 — Zod-validated KV shape, INV-B-17)', () => {
  it('accepts a minimal valid entry', () => {
    expect(savedQueryEntrySchema.safeParse(valid).success).toBe(true)
  })

  it('accepts per-user pins with chart config (EXP.10)', () => {
    const r = savedQueryEntrySchema.safeParse({
      ...valid,
      pins: [
        {
          user: 'analyst@example.com',
          pinnedAt: '2026-07-25T00:00:00.000Z',
          chart: { chartType: 'line', xColumn: 'day', yColumn: 'c' }
        }
      ]
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown chart types and extra keys (strict)', () => {
    expect(
      savedQueryChartConfigSchema.safeParse({ chartType: 'sunburst' }).success
    ).toBe(false)
    expect(
      savedQueryEntrySchema.safeParse({ ...valid, extra: true }).success
    ).toBe(false)
  })

  it('rejects empty/oversized fields', () => {
    expect(savedQueryEntrySchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    expect(savedQueryEntrySchema.safeParse({ ...valid, sql: 'x'.repeat(10_001) }).success).toBe(
      false
    )
  })
})

describe('parseSavedQueriesKv', () => {
  it('parses null / corrupt JSON / non-array to []', () => {
    expect(parseSavedQueriesKv(null)).toEqual([])
    expect(parseSavedQueriesKv('{not json')).toEqual([])
    expect(parseSavedQueriesKv('{"a":1}')).toEqual([])
  })

  it('drops invalid entries individually, keeps valid ones', () => {
    const raw = JSON.stringify([valid, { id: '', name: 'bad', sql: '', updatedAt: '' }, null])
    const out = parseSavedQueriesKv(raw)
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('q1')
  })

  it('bounds the list at SAVED_QUERIES_MAX_ENTRIES', () => {
    const many = Array.from({ length: SAVED_QUERIES_MAX_ENTRIES + 10 }, (_, i) => ({
      ...valid,
      id: `q${i}`
    }))
    expect(parseSavedQueriesKv(JSON.stringify(many))).toHaveLength(SAVED_QUERIES_MAX_ENTRIES)
  })
})
