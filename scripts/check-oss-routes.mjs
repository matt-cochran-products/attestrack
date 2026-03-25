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

console.log('[route-contract-check] docs/oss-http-contract.json matches worker-core sources.')
