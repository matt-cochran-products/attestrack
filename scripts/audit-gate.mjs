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
 * Accepted advisories. Every entry MUST have a rationale. Most entries are
 * transitive dependencies of `wrangler` (packages/deploy) — operator-side
 * deploy-time CLI tooling that never runs in the Worker or in any published
 * runtime bundle. Remove entries as wrangler upgrades land.
 *
 * wrangler is held at 4.86.0 — the last release whose engines allow node 20
 * (4.87.0+ requires node >=22; this repo targets node 20, see
 * docs/DEPENDENCY-NOTES.md). The undici entries below are fixed in
 * undici 7.28.0, which arrives via miniflare only with wrangler >=4.87 —
 * i.e. they drop out when the repo moves its node floor to 22.
 */
const ALLOWLIST = new Map([
  [
    'GHSA-vxpw-j846-p89q',
    'undici via wrangler>miniflare — deploy-time CLI only, not Worker runtime'
  ],
  [
    'GHSA-vmh5-mc38-953g',
    'undici SOCKS5 ProxyAgent TLS bypass via wrangler>miniflare — deploy-time CLI only, no ' +
      'SOCKS5 proxying in the deploy path, not Worker runtime; fixed in undici 7.28.0 which ' +
      'ships with wrangler >=4.87 (requires node >=22)'
  ],
  [
    'GHSA-hm92-r4w5-c3mj',
    'undici SOCKS5 proxy-pool cross-origin routing via wrangler>miniflare — deploy-time CLI ' +
      'only, no SOCKS5 proxying in the deploy path, not Worker runtime; fixed in undici 7.28.0 ' +
      'which ships with wrangler >=4.87 (requires node >=22)'
  ],
  ['GHSA-96hv-2xvq-fx4p', 'ws via wrangler>miniflare — deploy-time CLI only, not Worker runtime'],
  ['GHSA-f88m-g3jw-g9cj', 'sharp via wrangler — deploy-time CLI only, not Worker runtime'],
  [
    'GHSA-qwww-vcr4-c8h2',
    'react-router RSC-mode CSRF (action execution before 400) via react-router-dom@7 in ' +
      'portal-community — the portal is a client-only Vite SPA (BrowserRouter, no SSR, no RSC, ' +
      'no server actions), so the vulnerable server-mode code path never executes; first ' +
      'patched release is react-router 8.3.0 (next major, no react-router-dom@8 exists) — ' +
      'revisit on the react-router 8 migration'
  ]
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
