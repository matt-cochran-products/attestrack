import { describe, expect, it } from 'vitest'
import { diffKvSeed, diffLines, formatKvSeedDiff } from '../src/index.js'

describe('diffLines (CLI.11 re-run diff)', () => {
  it('returns empty string for identical content', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toBe('')
  })

  it('marks removed and added lines, keeps common lines', () => {
    const before = 'name = "old"\nid = "kv-1"\nkeep = true'
    const after = 'name = "new"\nid = "kv-2"\nkeep = true'
    const d = diffLines(before, after)
    expect(d).toContain('- name = "old"')
    expect(d).toContain('+ name = "new"')
    expect(d).toContain('- id = "kv-1"')
    expect(d).toContain('+ id = "kv-2"')
    expect(d).toContain('  keep = true')
  })

  it('handles pure additions and deletions at the tail', () => {
    expect(diffLines('a', 'a\nb')).toContain('+ b')
    expect(diffLines('a\nb', 'a')).toContain('- b')
  })
})

describe('diffKvSeed', () => {
  it('classifies added / removed / changed / unchanged keys', () => {
    const d = diffKvSeed(
      { same: '1', changed: 'old', gone: 'x' },
      { same: '1', changed: 'new', added: 'y' }
    )
    expect(d.unchanged).toEqual(['same'])
    expect(d.changed).toEqual(['changed'])
    expect(d.removed).toEqual(['gone'])
    expect(d.added).toEqual(['added'])
    const text = formatKvSeedDiff(d)
    expect(text).toContain('+ added (new key)')
    expect(text).toContain('~ changed (value will change)')
    expect(text).toContain('- gone')
    expect(text).toContain('  same (unchanged)')
  })
})
