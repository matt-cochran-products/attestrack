#!/usr/bin/env node
/**
 * P6.6 — Worker bundle budget. Cloudflare rejects Workers over ~1 MiB gzipped
 * (free plan; 10 MiB paid). This gate bundles the EXACT composition the deploy
 * scaffold ships (packages/deploy/src/worker-template.ts: host adapter +
 * worker-core + full bundled strategy set) with esbuild, gzips it, and fails
 * when the budget is exceeded — so a dependency added to the worker path can
 * never silently break customer deploys.
 *
 * Budget: 700 KiB gzip — headroom under the 1 MiB free-plan limit while loud
 * enough to catch accidental heavyweight deps. Raise CONSCIOUSLY if needed.
 *
 * Requires built workspaces (`pnpm build` first — CI orders it after build).
 */
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const BUDGET_GZIP_BYTES = 700 * 1024

// Mirror of the scaffold worker entry (deploy/src/worker-template.ts).
const entrySource = `
import { createCloudflareHostRuntime } from '@attestrack/host-cloudflare-worker'
import { createAttestrackFetchHandler, noopStrategyLoader } from '@attestrack/worker-core'
import { allBundledStrategies } from '@attestrack/strategies'

export default {
  async fetch(request, env, ctx) {
    const host = createCloudflareHostRuntime({
      bindings: { kv: env.ATTESTRACK_KV },
      executionCtx: ctx,
      secretValues: { CONSENT_TOKEN_SECRET: env.CONSENT_TOKEN_SECRET }
    })
    const handler = createAttestrackFetchHandler({
      host,
      consentSecretName: 'CONSENT_TOKEN_SECRET',
      bundledStrategies: allBundledStrategies('CONSENT_TOKEN_SECRET'),
      strategyLoader: noopStrategyLoader
    })
    return handler(request)
  }
}
`

const tmp = mkdtempSync(join(tmpdir(), 'attestrack-worker-size-'))
try {
  const entryPath = join(tmp, 'worker.mjs')
  writeFileSync(entryPath, entrySource)
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    minify: true,
    format: 'esm',
    // workerd runtime, not Node: fail the build if anything pulls in node builtins.
    platform: 'browser',
    conditions: ['workerd', 'worker', 'import'],
    absWorkingDir: repoRoot,
    // The entry lives in a tmpdir, outside the workspace — alias the three
    // top-level workspace imports to their built dists; their own transitive
    // imports resolve through each package's node_modules as usual.
    alias: {
      '@attestrack/host-cloudflare-worker': join(repoRoot, 'packages/host-cloudflare-worker/dist/index.js'),
      '@attestrack/worker-core': join(repoRoot, 'packages/worker-core/dist/index.js'),
      '@attestrack/strategies': join(repoRoot, 'packages/strategies/dist/index.js')
    },
    write: false,
    logLevel: 'silent'
  })
  const code = result.outputFiles[0].contents
  const gzip = gzipSync(code, { level: 9 }).byteLength
  const fmt = (n) => `${(n / 1024).toFixed(1)} KiB`
  const line = `[worker-size-check] scaffold worker bundle: ${fmt(code.byteLength)} raw, ${fmt(gzip)} gzip (budget ${fmt(BUDGET_GZIP_BYTES)} gzip, CF free-plan limit 1024 KiB)`
  if (gzip > BUDGET_GZIP_BYTES) {
    console.error(`${line}\n[worker-size-check] FAIL — over budget. A new dependency on the worker path likely regressed deployability.`)
    process.exit(1)
  }
  console.log(`${line} — OK`)
} catch (e) {
  console.error('[worker-size-check] FAIL — could not bundle the scaffold worker composition.')
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
