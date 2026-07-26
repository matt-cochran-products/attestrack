/**
 * Verifies docs/oss-http-contract.json matches worker-core source literals.
 * Run from repo root: node scripts/check-oss-routes.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = join(root, 'docs', 'oss-http-contract.json')
const constantsPath = join(root, 'packages', 'worker-core', 'src', 'constants.ts')
const portalPath = join(root, 'packages', 'worker-core', 'src', 'portal.ts')
const handlerPath = join(root, 'packages', 'worker-core', 'src', 'create-fetch-handler.ts')
const observabilityPath = join(root, 'packages', 'worker-core', 'src', 'observability.ts')

function fail(msg) {
  console.error(`[route-contract-check] ${msg}`)
  process.exit(1)
}

function extractConst(src, name) {
  const m = src.match(new RegExp(`export const ${name} = '([^']+)'`))
  return m ? m[1] : null
}

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const constantsSrc = readFileSync(constantsPath, 'utf8')
const portalSrc = readFileSync(portalPath, 'utf8')
const handlerSrc = readFileSync(handlerPath, 'utf8')

const tracking = extractConst(constantsSrc, 'TRACKING_EVENT_PATH')
const prefix = extractConst(portalSrc, 'PORTAL_API_PREFIX')

if (!tracking) fail(`Could not parse TRACKING_EVENT_PATH from ${constantsPath}`)
if (!prefix) fail(`Could not parse PORTAL_API_PREFIX from ${portalPath}`)

if (tracking !== contract.trackingPostPath) {
  fail(
    `tracking path mismatch: oss-http-contract.json has "${contract.trackingPostPath}" but constants.ts has "${tracking}". Update one source so they match.`
  )
}
if (prefix !== contract.portalApiPrefix) {
  fail(
    `portal prefix mismatch: oss-http-contract.json has "${contract.portalApiPrefix}" but portal.ts has "${prefix}". Update one source so they match.`
  )
}

for (const p of contract.topLevel.GET) {
  if (!handlerSrc.includes(`'${p}'`) && !handlerSrc.includes(`"${p}"`)) {
    fail(
      `topLevel GET "${p}" not found as literal in create-fetch-handler.ts — update handler or oss-http-contract.json.`
    )
  }
}

// OPTIONS preflight routes: handler must branch on OPTIONS and reference each
// path (as a literal, or via the tracking-path constant).
for (const p of contract.topLevel.OPTIONS ?? []) {
  if (!handlerSrc.includes("request.method === 'OPTIONS'")) {
    fail('create-fetch-handler.ts must handle OPTIONS preflight per oss-http-contract.json topLevel.OPTIONS.')
  }
  const isConstantBacked = p === contract.trackingPostPath
  if (!isConstantBacked && !handlerSrc.includes(`'${p}'`) && !handlerSrc.includes(`"${p}"`)) {
    fail(
      `topLevel OPTIONS "${p}" not found as literal in create-fetch-handler.ts — update handler or oss-http-contract.json.`
    )
  }
}

const consentPathLiteral = '/__attestrack__/consent/commit'
if (!contract.topLevel.POST.includes(consentPathLiteral)) {
  fail(`oss-http-contract.json topLevel.POST must include "${consentPathLiteral}"`)
}
if (!handlerSrc.includes(consentPathLiteral)) {
  fail(`create-fetch-handler.ts must include consent path "${consentPathLiteral}"`)
}

for (const p of contract.portalSubpaths.GET) {
  if (p === '/signal-recovery/timeline') {
    if (!portalSrc.includes("sub.startsWith('/signal-recovery/timeline')")) {
      fail(`portal.ts must handle GET prefix /signal-recovery/timeline per oss-http-contract.json`)
    }
    continue
  }
  const eq = `sub === '${p}'`
  if (!portalSrc.includes(eq)) {
    fail(
      `portal GET route "${p}" missing (${eq}) — update portal.ts or oss-http-contract.json.`
    )
  }
}

for (const p of contract.portalSubpaths.POST) {
  const eq = `sub === '${p}'`
  if (!portalSrc.includes(eq)) {
    fail(
      `portal POST route "${p}" missing (${eq}) — update portal.ts or oss-http-contract.json.`
    )
  }
}

const ext = contract.portalSubpathsRequiresAttestrue
if (ext) {
  for (const p of ext.GET ?? []) {
    if (!portalSrc.includes(`sub === '${p}'`)) {
      fail(
        `portal.ts must reference GET "${p}" (requires_attestrue) — update portal.ts or oss-http-contract.json portalSubpathsRequiresAttestrue.`
      )
    }
  }
  for (const p of ext.POST ?? []) {
    if (!portalSrc.includes(`sub === '${p}'`)) {
      fail(
        `portal POST route "${p}" missing for requires_attestrue — update portal.ts or oss-http-contract.json.`
      )
    }
  }
  if (!portalSrc.includes('requiresAttestruePortalResponse')) {
    fail('portal.ts must export or call requiresAttestruePortalResponse for extension-only routes.')
  }
}

// ── P3 observability honesty gates ─────────────────────────────────────────
// The dashboard/destinations/logs/signal endpoints must stay COMPUTED from
// recorded traffic (oss-http-contract.json `portalDataSources.computed`) —
// regressing to seeded KV JSON would violate the launch rule "do not ship a
// chart backed by invented numbers".
if (contract.portalDataSources) {
  const observabilitySrc = readFileSync(observabilityPath, 'utf8')
  if (!portalSrc.includes('computeDashboardMetrics')) {
    fail('portal.ts must compute /dashboard via computeDashboardMetrics (P3.2) — seeded dashboard JSON is not allowed.')
  }
  if (portalSrc.includes('KV_KEY_PORTAL_DASHBOARD') || portalSrc.includes('attestrack:portal:dashboard')) {
    fail('portal.ts must not read a seeded dashboard KV key — /dashboard is computed (P3.2 honesty gate).')
  }
  if (!portalSrc.includes('buildDestinationRows')) {
    fail('portal.ts must derive /destinations from recorded delivery stats via buildDestinationRows (P3.1).')
  }
  if (!portalSrc.includes('readRecentLogs')) {
    fail('portal.ts must serve /logs from the ingest log ring via readRecentLogs (P3.1).')
  }
  if (!observabilitySrc.includes('KV_KEY_DRIFT_MISMATCH')) {
    fail('observability.ts must read attestrack:drift:mismatch (KV_KEY_DRIFT_MISMATCH) for the drift surface (P3.5).')
  }
  if (!handlerSrc.includes('recordIngestObservability')) {
    fail('create-fetch-handler.ts must record ingest observability on /t/event (P3.1/P3.2).')
  }

  // ── P4.3 curated-analytics honesty gates ─────────────────────────────────
  // /analytics/curated must stay COMPUTED (canned SQL through the Explore gate
  // or recorded delivery stats) — never operator-seeded KV series, never a raw
  // second path to the warehouse.
  if (contract.portalDataSources.computed['/analytics/curated']) {
    const curatedPath = join(root, 'packages', 'worker-core', 'src', 'curated-analytics.ts')
    const curatedSrc = readFileSync(curatedPath, 'utf8')
    if (!portalSrc.includes('computeCuratedChart')) {
      fail('portal.ts must compute /analytics/curated via computeCuratedChart (P4.3) — seeded analytics JSON is not allowed.')
    }
    if (portalSrc.includes('KV_KEY_PORTAL_ANALYTICS') || portalSrc.includes('attestrack:portal:analytics')) {
      fail('portal.ts must not read the seeded analytics KV key — /analytics/curated is computed (P4.3 honesty gate).')
    }
    if (!curatedSrc.includes('validateAndNormalizeExploreSql')) {
      fail('curated-analytics.ts must run canned SQL through validateAndNormalizeExploreSql (same Explore gate — INV-B-14/15).')
    }
    if (!curatedSrc.includes('executeExploreSql')) {
      fail('curated-analytics.ts must execute via executeExploreSql (single warehouse path — INV-B-16); no direct fetch to the warehouse.')
    }
    if (/\bfetch\s*\(/.test(curatedSrc)) {
      fail('curated-analytics.ts must not call fetch directly — all warehouse access goes through executeExploreSql.')
    }
  }

  // ── P4.4 saved-queries gates ─────────────────────────────────────────────
  if (contract.portalSubpaths.POST.includes('/explore/saved-queries/pin')) {
    if (!portalSrc.includes('parseSavedQueriesKv')) {
      fail('portal.ts must read saved queries through the Zod-validated parseSavedQueriesKv shape (P4.4).')
    }
    if (!portalSrc.includes('Cf-Access-Authenticated-User-Email')) {
      fail('portal.ts must key saved-query pins on the Cf-Access-Authenticated-User-Email header (EXP.10).')
    }
  }
}

console.log('[route-contract-check] docs/oss-http-contract.json matches worker-core sources.')
