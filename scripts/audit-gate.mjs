#!/usr/bin/env node
/**
 * P7.4 supply-chain gate: fail CI when `pnpm audit --prod` reports a HIGH or
 * CRITICAL advisory that is not explicitly accepted below.
 *
 * Policy (documented threshold, docs/THREAT-MODEL.md §Supply chain):
 * - critical/high in PROD dependency paths: fail, unless the advisory id is in
 *   ALLOWLIST with a written rationale (transitive, tooling-only reach, fix
 *   tracked). Allowlist entries are re-justified whenever the lockfile bumps
 *   the parent dependency; Dependabot PRs surface the fixes.
 * - moderate/low, and dev-only paths: reported by `pnpm audit` for visibility
 *   but do not gate — the Worker runtime ships none of them.
 *
 * Runs `pnpm audit --prod --json` itself (requires network to the npm audit
 * endpoint, like `pnpm install`).
 */
import { execFileSync } from 'node:child_process'

/**
 * Accepted advisories. Every entry MUST have a rationale. All current entries
 * are transitive dependencies of `wrangler` (packages/deploy) — operator-side
 * deploy-time CLI tooling that never runs in the Worker or in any published
 * runtime bundle. Remove entries as wrangler upgrades land.
 */
const ALLOWLIST = new Map([
  ['GHSA-vrm6-8vpv-qv8q', 'undici via wrangler>miniflare — deploy-time CLI only, not Worker runtime'],
  ['GHSA-v9p9-hfj2-hcw8', 'undici via wrangler>miniflare — deploy-time CLI only, not Worker runtime'],
  ['GHSA-vxpw-j846-p89q', 'undici via wrangler>miniflare — deploy-time CLI only, not Worker runtime'],
  ['GHSA-737v-mqg7-c878', 'defu via wrangler>unenv — deploy-time CLI only, not Worker runtime'],
  ['GHSA-96hv-2xvq-fx4p', 'ws via wrangler>miniflare — deploy-time CLI only, not Worker runtime'],
  ['GHSA-f88m-g3jw-g9cj', 'sharp via wrangler — deploy-time CLI only, not Worker runtime']
])

const GATED_SEVERITIES = new Set(['high', 'critical'])

let stdout = ''
try {
  stdout = execFileSync('pnpm', ['audit', '--prod', '--json'], { encoding: 'utf8' })
} catch (err) {
  // pnpm audit exits non-zero when vulnerabilities exist — the JSON report is
  // still on stdout. Any other failure (no network, bad JSON) fails the gate.
  stdout = err && typeof err.stdout === 'string' ? err.stdout : ''
}

let report
try {
  report = JSON.parse(stdout)
} catch {
  console.error('[audit-gate] Could not parse `pnpm audit --prod --json` output.')
  process.exit(1)
}

const advisories = Object.values(report.advisories ?? {})
const gated = advisories.filter((a) => GATED_SEVERITIES.has(a.severity))
const unaccepted = gated.filter((a) => !ALLOWLIST.has(a.github_advisory_id))
const accepted = gated.filter((a) => ALLOWLIST.has(a.github_advisory_id))

for (const a of accepted) {
  console.log(
    `[audit-gate] accepted ${a.severity.toUpperCase()} ${a.github_advisory_id} (${a.module_name}): ${ALLOWLIST.get(a.github_advisory_id)}`
  )
}

const staleAllowlist = [...ALLOWLIST.keys()].filter(
  (id) => !gated.some((a) => a.github_advisory_id === id)
)
for (const id of staleAllowlist) {
  console.log(`[audit-gate] NOTE: allowlist entry ${id} no longer reported — remove it.`)
}

if (unaccepted.length > 0) {
  for (const a of unaccepted) {
    const paths = (a.findings ?? [])
      .flatMap((f) => f.paths ?? [])
      .slice(0, 3)
      .join('\n    ')
    console.error(
      `[audit-gate] ${a.severity.toUpperCase()} ${a.github_advisory_id} in ${a.module_name}: ${a.title}\n    ${paths}`
    )
  }
  console.error(
    `[audit-gate] ${unaccepted.length} unaccepted high/critical advisor${unaccepted.length === 1 ? 'y' : 'ies'} in prod dependency paths.`
  )
  console.error(
    '[audit-gate] Fix by upgrading, or add the GHSA id to ALLOWLIST in scripts/audit-gate.mjs with a written rationale.'
  )
  process.exit(1)
}

console.log(`[audit-gate] OK — no unaccepted high/critical advisories in prod dependency paths.`)
