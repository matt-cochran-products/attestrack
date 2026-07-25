/**
 * Re-run diff display (BEH CLI.11): before overwriting scaffold files on a
 * re-run, the CLI shows exactly what will change (`wrangler.toml`,
 * `kv-seed.json`) so updating an existing deployment is never a blind write.
 */

/** Longest-common-subsequence line diff — files here are tiny (< 200 lines). */
export function diffLines(before: string, after: string): string {
  if (before === after) return ''
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  // lcs[i][j] = LCS length of a[i..] vs b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`)
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${a[i]}`)
      i++
    } else {
      out.push(`+ ${b[j]}`)
      j++
    }
  }
  while (i < n) out.push(`- ${a[i++]}`)
  while (j < m) out.push(`+ ${b[j++]}`)
  return out.join('\n')
}

export type KvSeedDiff = {
  added: string[]
  removed: string[]
  changed: string[]
  unchanged: string[]
}

export function diffKvSeed(
  before: Record<string, string>,
  after: Record<string, string>
): KvSeedDiff {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  const unchanged: string[] = []
  for (const key of Object.keys(after)) {
    if (!(key in before)) added.push(key)
    else if (before[key] !== after[key]) changed.push(key)
    else unchanged.push(key)
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) removed.push(key)
  }
  return { added, removed, changed, unchanged }
}

export function formatKvSeedDiff(diff: KvSeedDiff): string {
  const lines: string[] = []
  for (const k of diff.added) lines.push(`+ ${k} (new key)`)
  for (const k of diff.changed) lines.push(`~ ${k} (value will change)`)
  for (const k of diff.removed) lines.push(`- ${k} (no longer seeded; existing KV value is left as-is)`)
  for (const k of diff.unchanged) lines.push(`  ${k} (unchanged)`)
  return lines.join('\n')
}
