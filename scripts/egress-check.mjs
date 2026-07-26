#!/usr/bin/env node
/**
 * P7.5 first-party-data egress gate (INV-B-01/02/16), mirroring
 * boundary-check.mjs. Mechanically enforces:
 *
 * 1. ZERO references to licensed-sibling (Attestrue) origins anywhere except
 *    an explicit allowlist: the ONE documented static handoff URL constant in
 *    packages/worker-core/src/portal.ts, the community portal's static
 *    upgrade-CTA links, and docs whose job is to document the boundary.
 * 2. INV-B-16: within packages/worker-core/src the sibling origin appears
 *    EXACTLY once (the `ATTESTRUE_UPGRADE_ORIGIN` constant in portal.ts), and
 *    no allowlisted SOURCE file performs network I/O at all — the handoff is
 *    a static string handed to the browser, never fetched.
 * 3. ZERO telemetry/analytics SDKs: no denylisted package in any workspace
 *    package.json and no denylisted import/require specifier in source.
 *    (Data leaves a deployment only via operator-configured destinations —
 *    ad networks, ClickHouse/Tinybird, OTLP — documented in
 *    docs/THREAT-MODEL.md "Data flows".)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Built from parts so this script never contains the literal itself. */
const sibling = ['attes', 'true'].join('')
/** Origin-shaped reference: attestrue.<tld> with optional scheme/subdomains. */
const siblingOriginPattern = new RegExp(`(?:[a-z0-9-]+\\.)*${sibling}\\.[a-z]{2,}`, 'giu')

/**
 * Files that may reference a sibling origin. Source files here must be
 * navigation-only (checked below); docs document the boundary/handoff.
 */
const allowedOriginFiles = new Set(
  [
    // The single documented static handoff constant (INV-B-16).
    'packages/worker-core/src/portal.ts',
    // Community portal static upgrade CTAs (links the USER clicks; no I/O).
    'packages/portal-community/src/routes/configuration/index.tsx',
    'packages/portal-community/src/routes/extensions/index.tsx',
    'packages/portal-community/src/routes/migration/index.tsx',
    'packages/portal-community/src/routes/upgrade/index.tsx',
    // Contract test asserting the 403 handoff payload.
    'packages/worker-core/__tests__/contract/create-fetch-handler.contract.test.ts',
    // Portal route map documenting the upgrade handoff targets.
    'packages/portal-community/docs/ROUTES.md',
    // Docs whose job is to document the boundary / upgrade handoff.
    'README.md',
    'ATTESTRACK-PRODUCTION-PLAN.md',
    path.join('docs', 'OSS-SCOPE-MATRIX.md'),
    path.join('docs', 'USER-JOURNEY.SPEC.md'),
    path.join('docs', 'BEHAVORIAL-SPEC.md'),
    path.join('docs', 'THREAT-MODEL.md'),
    path.join('ADR', 'ADR-001-shared-component-library.md'),
    path.join('ADR', 'ADR-010-attestrack-core-extension-cache.md')
  ].map((p) => path.join(root, p))
)

/** Network I/O tokens forbidden in allowlisted SOURCE files (not tests/docs). */
const networkTokens = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket(', 'EventSource(']

/**
 * Telemetry/analytics SDK denylist — none of these belong in a repo whose
 * pitch is "no data leaves the operator's infrastructure". Matched as package
 * name prefixes against dependency names and import/require specifiers.
 */
const telemetryDenylist = [
  'posthog',
  '@sentry/',
  '@segment/',
  'analytics-node',
  '@rudderstack/',
  'rudder-sdk',
  'mixpanel',
  '@amplitude/',
  'amplitude-js',
  'dd-trace',
  '@datadog/',
  'newrelic',
  '@bugsnag/',
  'bugsnag-js',
  'logrocket',
  '@fullstory/',
  'hotjar',
  '@hotjar/',
  'react-ga',
  'universal-analytics',
  '@google-analytics/',
  'plausible-tracker',
  'fathom-client',
  '@heap/',
  'heap-api'
]

// `.wrangler` (wrangler dev bundles) and `.portal-dist` (e2e portal build) are
// gitignored build artifacts of already-scanned allowlisted sources.
const scanIgnoreDir = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  '.cursor',
  '.claude',
  '.wrangler',
  '.portal-dist'
])
const scanExtensions = new Set(['.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.astro'])

function walkFiles (dir, out = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const rel = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (scanIgnoreDir.has(ent.name)) continue
      walkFiles(rel, out)
    } else if (scanExtensions.has(path.extname(ent.name))) {
      out.push(rel)
    }
  }
  return out
}

let failed = false
const thisScript = fileURLToPath(import.meta.url)
const files = walkFiles(root)

// ── Rule 1: sibling origins only in allowlisted files ─────────────────────
for (const file of files) {
  if (file === thisScript) continue
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  siblingOriginPattern.lastIndex = 0
  if (siblingOriginPattern.test(text) && !allowedOriginFiles.has(file)) {
    console.error(`[egress-check] Sibling origin reference outside allowlist: ${path.relative(root, file)}`)
    failed = true
  }
}

// ── Rule 2: INV-B-16 — exactly one origin constant in worker-core src; no
//    network I/O in any allowlisted source file ─────────────────────────────
const workerSrcDir = path.join(root, 'packages', 'worker-core', 'src')
let workerOriginCount = 0
let workerOriginFiles = []
for (const file of files.filter((f) => f.startsWith(workerSrcDir))) {
  const text = fs.readFileSync(file, 'utf8')
  const matches = text.match(siblingOriginPattern) ?? []
  if (matches.length > 0) {
    workerOriginCount += matches.length
    workerOriginFiles.push(path.relative(root, file))
  }
}
if (workerOriginCount !== 1 || workerOriginFiles[0] !== path.join('packages', 'worker-core', 'src', 'portal.ts')) {
  console.error(
    `[egress-check] INV-B-16 violated: expected exactly ONE sibling-origin literal in packages/worker-core/src (portal.ts handoff constant), found ${workerOriginCount} in [${workerOriginFiles.join(', ')}]`
  )
  failed = true
}
for (const file of allowedOriginFiles) {
  if (!file.includes(`${path.sep}src${path.sep}`)) continue
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue // absent allowlist entries are fine (e.g. routes refactored away)
  }
  for (const token of networkTokens) {
    if (text.includes(token)) {
      console.error(
        `[egress-check] ${path.relative(root, file)} may reference the sibling origin ONLY as a static link, but contains network token "${token}"`
      )
      failed = true
    }
  }
}

// ── Rule 3: no telemetry/analytics SDKs ───────────────────────────────────
function denylisted (specifier) {
  return telemetryDenylist.find((d) => specifier === d || specifier.startsWith(d))
}

for (const file of files) {
  const rel = path.relative(root, file)
  if (path.basename(file) === 'package.json') {
    let pkg
    try {
      pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pkg[section] ?? {})) {
        const hit = denylisted(dep)
        if (hit) {
          console.error(`[egress-check] Telemetry/analytics dependency "${dep}" (${hit}) in ${rel}`)
          failed = true
        }
      }
    }
  }
  if (!['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(path.extname(file))) continue
  if (file === thisScript) continue
  const text = fs.readFileSync(file, 'utf8')
  const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/gu
  let m
  while ((m = importRe.exec(text)) !== null) {
    const hit = denylisted(m[1])
    if (hit) {
      console.error(`[egress-check] Telemetry/analytics import "${m[1]}" (${hit}) in ${rel}`)
      failed = true
    }
  }
}

if (failed) {
  process.exit(1)
}
console.log('[egress-check] OK — no sibling-origin egress (single static handoff constant) and no telemetry SDKs.')
