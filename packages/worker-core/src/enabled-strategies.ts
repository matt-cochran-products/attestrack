import type { Strategy } from '@attestrue/sdk'

/**
 * Parse KV value for `KV_KEY_ENABLED_STRATEGIES`.
 * Returns `null` when the key is absent or invalid → caller treats as “all optional strategies allowed”.
 */
export function parseEnabledStrategiesKv(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === '') return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return null
    if (!v.every((x) => typeof x === 'string')) return null
    return v
  } catch {
    return null
  }
}

/** Keep mandatory stage always; filter destination + analytics by allowlist when `enabledIds` is non-null. */
export function filterStrategiesByEnabledKv(
  strategies: readonly Strategy[],
  enabledIds: string[] | null
): Strategy[] {
  if (enabledIds === null) return [...strategies]
  const allow = new Set(enabledIds)
  return strategies.filter((s) => s.stage === 'mandatory' || allow.has(s.id))
}
