import type { Strategy } from './interfaces.js'

/**
 * Merge community (bundled) strategies with CDN-loaded extension strategies.
 * Any bundled strategy whose `id` appears in `extension.manifest.replaces` is dropped;
 * extensions are appended after the filtered bundled set. Order within each group is preserved.
 */
export function resolveStrategiesWithReplaces(
  bundled: readonly Strategy[],
  extensions: readonly Strategy[]
): Strategy[] {
  const replaced = new Set<string>()
  for (const ext of extensions) {
    const list = ext.manifest?.replaces
    if (!list) continue
    for (const id of list) replaced.add(id)
  }
  const kept = bundled.filter((s) => !replaced.has(s.id))
  return [...kept, ...extensions]
}
