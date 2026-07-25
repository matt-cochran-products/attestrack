import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertWranglerAuth,
  createKvNamespaceForSite,
  postScaffoldCloudflareDeploy
} from './apply-cloudflare.js'
import { formatDnsInstructions } from './dns-guide.js'
import { defaultEnabledStrategyIds, initialKvSeed } from './kv-schema.js'
import { findAttestrackMonorepoRoot, relativeFileDep } from './repo-root.js'
import { R2_SETUP_README } from './r2-setup.js'
import { defaultRunCommand, type RunCommandFn } from './run-command.js'
import { buildScaffoldPackageJson } from './scaffold-package-json.js'
import { parseKvNamespaceIdFromWranglerToml } from './parse-wrangler-toml.js'
import { buildWorkerEntry, buildWranglerToml } from './worker-template.js'

export { defaultEnabledStrategyIds, initialKvSeed } from './kv-schema.js'
export { formatDnsInstructions } from './dns-guide.js'
export { R2_SETUP_README } from './r2-setup.js'
export { buildWorkerEntry, buildWranglerToml } from './worker-template.js'
export {
  assertWranglerAuth,
  createKvNamespaceForSite,
  postScaffoldCloudflareDeploy
} from './apply-cloudflare.js'
export { defaultRunCommand, type RunCommandFn } from './run-command.js'
export { parseKvNamespaceIdFromWranglerToml } from './parse-wrangler-toml.js'

export type ScriptedDeployAnswers = {
  siteId: string
  domain: string
  /** Scaffold-only: pre-filled KV id. Ignored when Cloudflare apply runs (namespace is created for you). */
  kvNamespaceId?: string
  pagesProjectName?: string
  consentSecretForPut?: string
  /**
   * When `attestrack-deploy/wrangler.toml` exists with a real KV id, skip `kv namespace create`
   * and reuse that id (BEH CLI.11 update path).
   */
  reuseExistingScaffold?: boolean
}

export type RunInteractiveDeployOptions = {
  scripted?: ScriptedDeployAnswers
  /** Files only; no wrangler / npm / Pages (legacy escape hatch). */
  scaffoldOnly?: boolean
  skipPortal?: boolean
  dryRun?: boolean
  runCommand?: RunCommandFn
  /**
   * Non-interactive: if `attestrack-deploy/wrangler.toml` already has a KV id, reuse it (no new namespace).
   * Interactive users are prompted unless this is true.
   */
  reuseExistingKvWhenPresent?: boolean
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9-]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '') || 'site'
}

function readWranglerSemverFromDeployPackage(): string {
  try {
    const p = fileURLToPath(new URL('../package.json', import.meta.url))
    const j = JSON.parse(readFileSync(p, 'utf8')) as { dependencies?: { wrangler?: string } }
    return j.dependencies?.wrangler ?? '^3.99.0'
  } catch {
    return '^3.99.0'
  }
}

function buildAccessReminder(portalHostname: string): string[] {
  return [
    '',
    '## Cloudflare Access (required for production)',
    '',
    `The portal will be public at ${portalHostname} until you protect it.`,
    'Add a Cloudflare Access application for that hostname (Zero Trust → Access → Applications).',
    'Restrict to your identity provider or allowlist; do not leave the operator portal unauthenticated.',
    ''
  ]
}

function buildCompletionBanner(opts: {
  workerUrl: string | null
  portalUrl: string | null
  outDir: string
  skipPortal: boolean
}): string {
  const lines = [
    '',
    '=== Attestrack deploy complete ===',
    opts.workerUrl ? `Worker: ${opts.workerUrl}` : 'Worker: (URL not detected — check wrangler output)',
    ''
  ]
  if (!opts.skipPortal) {
    lines.push(
      opts.portalUrl
        ? `Portal: ${opts.portalUrl}`
        : 'Portal: (URL not detected — check wrangler pages output)',
      ...buildAccessReminder(opts.portalUrl ?? 'your-pages-hostname.pages.dev')
    )
  }
  lines.push(`Scaffold: ${opts.outDir}`, '')
  return lines.join('\n')
}

export async function runInteractiveDeploy(options?: RunInteractiveDeployOptions): Promise<void> {
  const scaffoldOnly = options?.scaffoldOnly === true
  const skipPortal = options?.skipPortal === true
  const dryRun =
    options?.dryRun === true || process.env.ATTESTRACK_DEPLOY_DRY_RUN === '1'
  const run = options?.runCommand ?? defaultRunCommand
  const scripted = options?.scripted
  const reuseFlag = options?.reuseExistingKvWhenPresent === true

  const cwd = process.cwd()
  const repoRoot = findAttestrackMonorepoRoot(cwd)
  if (!scaffoldOnly && !repoRoot) {
    throw new Error(
      'Full Cloudflare deploy requires the Attestrack monorepo. Clone https://github.com/matt-cochran/attestrack and run from the repository root (see docs/PILOT-OSS.md).'
    )
  }

  const outDir = join(cwd, 'attestrack-deploy')
  const wranglerTomlPath = join(outDir, 'wrangler.toml')
  let parsedExistingKvId: string | null = null
  if (existsSync(wranglerTomlPath)) {
    try {
      parsedExistingKvId = parseKvNamespaceIdFromWranglerToml(
        readFileSync(wranglerTomlPath, 'utf8')
      )
    } catch {
      parsedExistingKvId = null
    }
  }

  let siteId: string
  let domain: string
  let pagesProjectName: string
  let reuseExistingKv = false

  if (scripted) {
    siteId = scripted.siteId
    domain = scripted.domain
    pagesProjectName = scripted.pagesProjectName ?? `attestrack-portal-${slug(siteId)}`
    if (!scaffoldOnly && parsedExistingKvId && !dryRun) {
      reuseExistingKv = scripted.reuseExistingScaffold === true || reuseFlag
    }
  } else {
    const rl = createInterface({ input, output })
    output.write('Attestrack — guided Cloudflare deploy\n\n')
    siteId = ((await rl.question('Site ID (e.g. my-store): ')) || 'site').trim()
    domain = ((await rl.question('Worker hostname (e.g. t.example.com): ')) || 't.example.com').trim()
    const pagesDefault = `attestrack-portal-${slug(siteId)}`
    pagesProjectName = (
      (await rl.question(`Cloudflare Pages project name [${pagesDefault}]: `)) || pagesDefault
    ).trim()
    if (!scaffoldOnly && parsedExistingKvId && !dryRun) {
      if (reuseFlag) {
        reuseExistingKv = true
      } else {
        const q = `Found existing ${wranglerTomlPath} (KV id ${parsedExistingKvId}). Reuse this namespace — refresh scaffold, re-seed KV, redeploy Worker${skipPortal ? '' : ' + portal'} — instead of creating a new KV namespace? [Y/n]: `
        const ans = ((await rl.question(q)) || 'y').trim().toLowerCase()
        reuseExistingKv = ans === '' || ans === 'y' || ans === 'yes'
      }
    }
    rl.close()
  }

  mkdirSync(outDir, { recursive: true })

  let kvNamespaceId: string
  if (scaffoldOnly) {
    kvNamespaceId =
      scripted?.kvNamespaceId?.trim() ||
      'REPLACE_WITH_KV_NAMESPACE_ID'
  } else {
    await assertWranglerAuth(run, outDir)
    if (dryRun) {
      kvNamespaceId =
        reuseExistingKv && parsedExistingKvId ? parsedExistingKvId : 'dry-run-kv-id'
    } else if (reuseExistingKv && parsedExistingKvId) {
      kvNamespaceId = parsedExistingKvId
      output.write(`\nReusing KV namespace id ${kvNamespaceId} (CLI.11 update path).\n`)
    } else {
      kvNamespaceId = await createKvNamespaceForSite(run, outDir, siteId)
    }
  }

  const wranglerSemver = readWranglerSemverFromDeployPackage()
  writeFileSync(join(outDir, 'wrangler.toml'), buildWranglerToml({ siteId, kvNamespaceBinding: kvNamespaceId }))
  writeFileSync(join(outDir, 'worker.ts'), buildWorkerEntry())
  writeFileSync(join(outDir, 'kv-seed.json'), JSON.stringify(initialKvSeed(siteId, domain), null, 2))
  writeFileSync(join(outDir, 'DNS.md'), formatDnsInstructions(domain, 'your-workers-subdomain.workers.dev'))
  writeFileSync(join(outDir, 'R2-OPTIONAL.md'), R2_SETUP_README)

  if (repoRoot) {
    const wc = join(repoRoot, 'packages', 'worker-core')
    const hcf = join(repoRoot, 'packages', 'host-cloudflare-worker')
    const strat = join(repoRoot, 'packages', 'strategies')
    const pkgJson = buildScaffoldPackageJson({
      workerCore: relativeFileDep(outDir, wc),
      hostCloudflareWorker: relativeFileDep(outDir, hcf),
      strategies: relativeFileDep(outDir, strat),
      wranglerSemver
    })
    writeFileSync(join(outDir, 'package.json'), pkgJson)
  } else {
    writeFileSync(
      join(outDir, 'README-MONOREPO.md'),
      [
        '# Monorepo required',
        '',
        'This scaffold was generated without resolving local `file:` dependencies.',
        'Clone the Attestrack repository (https://github.com/matt-cochran/attestrack) and re-run `npx @attestrack/deploy` from the repo root,',
        'or copy this folder into the repo and add package.json dependencies manually.',
        ''
      ].join('\n')
    )
  }

  writeFileSync(
    join(outDir, 'README.md'),
    buildScaffoldReadme({ domain, siteId, scaffoldOnly, hasPackageJson: !!repoRoot })
  )

  output.write(`\nWrote scaffold to ${outDir}\n`)

  if (scaffoldOnly) {
    if (!repoRoot) {
      output.write('\nNote: run from the Attestrack repo root to also generate package.json with file: deps.\n')
    }
    return
  }

  const monorepoRoot = repoRoot
  if (monorepoRoot === null) {
    throw new Error('internal: monorepo root required for Cloudflare apply')
  }

  const post = await postScaffoldCloudflareDeploy({
    outDir,
    siteId,
    domain,
    pagesProjectName,
    skipPortal,
    dryRun,
    repoRoot: monorepoRoot,
    run,
    consentSecretForPut: scripted?.consentSecretForPut
  })

  output.write(
    buildCompletionBanner({
      workerUrl: post.workerUrl,
      portalUrl: post.portalUrl,
      outDir,
      skipPortal
    })
  )
}

function buildScaffoldReadme(opts: {
  domain: string
  siteId: string
  scaffoldOnly: boolean
  hasPackageJson: boolean
}): string {
  const lines = [
    '# Attestrack worker scaffold',
    '',
    `Default enabled strategies (KV \`attestrack:enabled_strategies\`): ${JSON.stringify([...defaultEnabledStrategyIds])}.`,
    'Add destination ids (e.g. `meta-capi`) when you configure ad-network secrets.',
    '',
    '## Worker secrets (`wrangler secret put <NAME>`)',
    '',
    '- `CONSENT_TOKEN_SECRET` — required; 32+ characters',
    '- ClickHouse: `CLICKHOUSE_HTTP_URL`, `CLICKHOUSE_QUERY_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`',
    '- Tinybird: `TINYBIRD_TOKEN`, `TINYBIRD_DATASOURCE`, optional `TINYBIRD_API_URL`',
    '- Google MP: `GOOGLE_MP_API_SECRET`, `GOOGLE_MEASUREMENT_ID`',
    '- Meta CAPI: `META_ACCESS_TOKEN`, `META_PIXEL_ID`',
    '- TikTok: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_PIXEL_ID`',
    '- Microsoft UET: `MICROSOFT_UET_ACCESS_TOKEN`, `MICROSOFT_UET_TAG_ID`',
    '',
    opts.hasPackageJson
      ? [
          '## Automated path',
          '',
          'From the repo root, `npx @attestrack/deploy` creates the KV namespace (or reuses an existing one if you confirm), installs deps, seeds KV,',
          'prompts for `CONSENT_TOKEN_SECRET`, deploys the Worker, and (unless `--skip-portal`) builds and deploys the portal to Cloudflare Pages.',
          'Re-run: use `--reuse-kv` for non-interactive reuse, or answer the reuse prompt when `wrangler.toml` already exists.',
          ''
        ].join('\n')
      : '',
    opts.scaffoldOnly
      ? [
          '## Manual path (scaffold-only)',
          '',
          '1. `cd` this folder; ensure package.json lists `@attestrack/*` dependencies.',
          '2. `npm install`',
          '3. `npx wrangler secret put CONSENT_TOKEN_SECRET`',
          '4. `npx wrangler kv bulk put .kv-bulk-upload.json --binding ATTESTRACK_KV` (after creating the namespace)',
          '5. `npx wrangler deploy`',
          ''
        ].join('\n')
      : '',
    'Script tag (first-party):',
    `  <script src="https://${opts.domain}/consent.js" defer></script>`,
    '',
    'See repository `docs/PILOT-OSS.md` for a full checklist and Cloudflare Access.',
    ''
  ]
  return lines.filter(Boolean).join('\n')
}
