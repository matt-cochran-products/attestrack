import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertWranglerAuth,
  attemptStep,
  createKvNamespaceForSite,
  postScaffoldCloudflareDeploy,
  type ConfirmRetryFn
} from './apply-cloudflare.js'
import { diffKvSeed, diffLines, formatKvSeedDiff } from './diff.js'
import { formatDnsInstructions } from './dns-guide.js'
import { defaultEnabledStrategyIds, initialKvSeed } from './kv-schema.js'
import { maskSecrets, registerSecret } from './mask.js'
import { findAttestrackMonorepoRoot, relativeFileDep } from './repo-root.js'
import { R2_SETUP_README } from './r2-setup.js'
import { defaultRunCommand, type RunCommandFn } from './run-command.js'
import {
  buildScaffoldPackageJson,
  standaloneDependencySpecifiers
} from './scaffold-package-json.js'
import { createStepPrinter } from './steps.js'
import { parseKvNamespaceIdFromWranglerToml } from './parse-wrangler-toml.js'
import { runDeployVerify, type VerifyOptions } from './verify.js'
import { buildWorkerEntry, buildWranglerToml } from './worker-template.js'

export { defaultEnabledStrategyIds, initialKvSeed } from './kv-schema.js'
export { formatDnsInstructions } from './dns-guide.js'
export { R2_SETUP_README } from './r2-setup.js'
export { buildWorkerEntry, buildWranglerToml } from './worker-template.js'
export {
  assertWranglerAuth,
  attemptStep,
  createKvNamespaceForSite,
  postScaffoldCloudflareDeploy,
  ATTESTRACK_REPO_GIT_URL,
  type ConfirmRetryFn
} from './apply-cloudflare.js'
export { defaultRunCommand, type RunCommandFn } from './run-command.js'
export { parseKvNamespaceIdFromWranglerToml } from './parse-wrangler-toml.js'
export { diffKvSeed, diffLines, formatKvSeedDiff } from './diff.js'
export { maskSecrets, registerSecret, clearRegisteredSecretsForTest } from './mask.js'
export { createStepPrinter, type StepPrinter } from './steps.js'
export {
  buildScaffoldPackageJson,
  standaloneDependencySpecifiers,
  STANDALONE_DEPENDENCY_RANGE_DEFAULT
} from './scaffold-package-json.js'
export {
  runDeployVerify,
  type FetchLike,
  type VerifyOptions,
  type VerifyReport
} from './verify.js'

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
  /** Skip KV re-seed (re-runs where the operator edited config via the portal). */
  skipSeed?: boolean
  dryRun?: boolean
  runCommand?: RunCommandFn
  /**
   * Non-interactive: if `attestrack-deploy/wrangler.toml` already has a KV id, reuse it (no new namespace).
   * Interactive users are prompted unless this is true.
   */
  reuseExistingKvWhenPresent?: boolean
  /** Test hook — answers CLI.4 retry prompts in scripted mode (absent = fail fast). */
  confirmRetry?: ConfirmRetryFn
  /** Test hook — answers the CLI.11 "apply these changes?" prompt in scripted mode (absent = apply). */
  confirmApplyChanges?: (diffText: string) => Promise<boolean>
  /** Test hook — post-deploy verification transport/timing (CLI.8 route poll). */
  verifyOverrides?: Pick<VerifyOptions, 'fetchFn' | 'attempts' | 'intervalMs' | 'sleep' | 'write'>
}

export type DeployState = {
  siteId: string
  domain: string
  workerUrl: string | null
  portalUrl: string | null
  pagesProjectName: string
  updatedAt: string
}

export const DEPLOY_STATE_FILENAME = 'deploy-state.json'

function slug(s: string): string {
  return s.replace(/[^a-z0-9-]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '') || 'site'
}

function readWranglerSemverFromDeployPackage(): string {
  try {
    const p = fileURLToPath(new URL('../package.json', import.meta.url))
    const j = JSON.parse(readFileSync(p, 'utf8')) as { dependencies?: { wrangler?: string } }
    return j.dependencies?.wrangler ?? '~4.86.0'
  } catch {
    return '~4.86.0'
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
    'Checklist + verification: docs/PILOT-OSS.md → "Cloudflare Access on the portal".',
    `Confirm protection any time with: npx @attestrack/deploy verify`,
    ''
  ]
}

function buildCompletionBanner(opts: {
  workerUrl: string | null
  portalUrl: string | null
  outDir: string
  domain: string
  skipPortal: boolean
}): string {
  const lines = [
    '',
    '=== Attestrack deploy complete ===',
    opts.workerUrl ? `Worker: ${opts.workerUrl}` : 'Worker: (URL not detected — check wrangler output)',
    '',
    // CLI.9 — copy-paste-ready script tag with the user's hostname substituted.
    'Add this tag to your site <head> (first-party, served by your Worker):',
    `  <script src="https://${opts.domain}/consent.js" defer></script>`,
    '',
    // CLI.10 — every new deployment starts in shadow mode; explain what that means.
    'Mode: SHADOW (always the starting mode). In shadow mode Attestrack records',
    'consent decisions and would-be outcomes but never blocks destinations.',
    'Switch to enforcement later from the portal once you have reviewed the data.',
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

type ScaffoldFilePlan = {
  wranglerToml: string
  workerEntry: string
  kvSeedJson: string
}

/**
 * CLI.11 — before overwriting an existing scaffold, show exactly what will
 * change (wrangler.toml + KV seed). Returns the human-readable diff text, or
 * null when this is a first run / nothing exists to compare.
 */
function buildRerunDiff(outDir: string, plan: ScaffoldFilePlan, skipSeed: boolean): string | null {
  const tomlPath = join(outDir, 'wrangler.toml')
  const seedPath = join(outDir, 'kv-seed.json')
  if (!existsSync(tomlPath) && !existsSync(seedPath)) return null

  const sections: string[] = []
  if (existsSync(tomlPath)) {
    const oldToml = readFileSync(tomlPath, 'utf8')
    const d = diffLines(oldToml, plan.wranglerToml)
    sections.push(d === '' ? 'wrangler.toml: no changes' : `wrangler.toml changes:\n${d}`)
  }
  if (existsSync(seedPath)) {
    try {
      const oldSeed = JSON.parse(readFileSync(seedPath, 'utf8')) as Record<string, string>
      const newSeed = JSON.parse(plan.kvSeedJson) as Record<string, string>
      const d = diffKvSeed(oldSeed, newSeed)
      const anyChange = d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0
      sections.push(
        anyChange || !skipSeed
          ? [
              'KV seed changes (these keys are re-written to your KV namespace on apply):',
              formatKvSeedDiff(d),
              skipSeed
                ? '(--skip-seed: files are refreshed but no KV write happens)'
                : 'Note: re-seeding overwrites these KV keys — config edited via the portal is replaced by the values above. Use --skip-seed to keep remote KV untouched.'
            ].join('\n')
          : 'kv-seed.json: no changes'
      )
    } catch {
      sections.push('kv-seed.json: existing file unreadable — it will be rewritten')
    }
  }
  return sections.join('\n\n')
}

export async function runInteractiveDeploy(options?: RunInteractiveDeployOptions): Promise<void> {
  const scaffoldOnly = options?.scaffoldOnly === true
  const skipPortal = options?.skipPortal === true
  const skipSeed = options?.skipSeed === true
  const dryRun =
    options?.dryRun === true || process.env.ATTESTRACK_DEPLOY_DRY_RUN === '1'
  const run = options?.runCommand ?? defaultRunCommand
  const scripted = options?.scripted
  const reuseFlag = options?.reuseExistingKvWhenPresent === true

  // CLI.5 / INV-B-10: register every secret we hold so no output path can echo it.
  registerSecret(scripted?.consentSecretForPut)

  const cwd = process.cwd()
  const repoRoot = findAttestrackMonorepoRoot(cwd)
  const standalone = repoRoot === null

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

  const rl = scripted ? null : createInterface({ input, output })
  // Piped/CI stdin that hits EOF must abort loudly (exit 1), never silently
  // "succeed" with nothing done. Interactive terminals are unaffected.
  let rlDone = false
  const rlClosedEarly = new Promise<never>((_, reject) => {
    rl?.on('close', () => {
      if (!rlDone) {
        reject(
          new Error(
            'stdin closed before required answers were provided — aborting. For non-interactive use pass flags (--dry-run, --reuse-kv, …) or the scripted API.'
          )
        )
      }
    })
  })
  rlClosedEarly.catch(() => {}) // pre-handled: only observed while a question is pending
  const ask = async (q: string): Promise<string> =>
    rl ? (await Promise.race([rl.question(maskSecrets(q)), rlClosedEarly])).trim() : ''
  const confirm = async (q: string, def: boolean): Promise<boolean> => {
    const raw = (await ask(`${q} [${def ? 'Y/n' : 'y/N'}]: `)).toLowerCase()
    if (raw === '') return def
    return raw === 'y' || raw === 'yes'
  }
  const confirmRetry: ConfirmRetryFn | undefined =
    options?.confirmRetry ?? (rl ? (msg) => confirm(`\n${msg}`, true) : undefined)

  try {
    if (scripted) {
      siteId = scripted.siteId
      domain = scripted.domain
      pagesProjectName = scripted.pagesProjectName ?? `attestrack-portal-${slug(siteId)}`
      if (!scaffoldOnly && parsedExistingKvId && !dryRun) {
        reuseExistingKv = scripted.reuseExistingScaffold === true || reuseFlag
      }
    } else {
      output.write('Attestrack — guided Cloudflare deploy\n')
      if (standalone && !scaffoldOnly) {
        output.write(
          '\nStandalone mode: scaffold uses the published @attestrack/* packages.\n(Running from a clone of the Attestrack repo instead uses local file: deps — dev mode.)\n'
        )
      }
      output.write('\n')
      siteId = (await ask('Site ID (e.g. my-store): ')) || 'site'
      domain = (await ask('Worker hostname (e.g. t.example.com): ')) || 't.example.com'
      const pagesDefault = `attestrack-portal-${slug(siteId)}`
      pagesProjectName = (await ask(`Cloudflare Pages project name [${pagesDefault}]: `)) || pagesDefault
      if (!scaffoldOnly && parsedExistingKvId && !dryRun) {
        if (reuseFlag) {
          reuseExistingKv = true
        } else {
          reuseExistingKv = await confirm(
            `Found existing ${wranglerTomlPath} (KV id ${parsedExistingKvId}). Reuse this namespace — refresh scaffold, re-seed KV, redeploy Worker${skipPortal ? '' : ' + portal'} — instead of creating a new KV namespace?`,
            true
          )
        }
      }
    }

    mkdirSync(outDir, { recursive: true })

    // CLI.3 — sequential numbered steps. Scaffold-only keeps the short flow.
    const totalSteps = scaffoldOnly ? 0 : skipPortal ? 8 : 9
    const steps = totalSteps > 0 ? createStepPrinter(totalSteps, (s) => output.write(s)) : null

    let kvNamespaceId: string
    if (scaffoldOnly) {
      kvNamespaceId =
        scripted?.kvNamespaceId?.trim() ||
        'REPLACE_WITH_KV_NAMESPACE_ID'
    } else {
      steps?.step('Verify Cloudflare authentication (wrangler whoami)')
      if (dryRun && options?.runCommand === undefined) {
        // --dry-run without an injected runner touches nothing, not even read-only wrangler calls.
        output.write('[dry-run] would run: wrangler whoami\n')
      } else {
        await attemptStep('wrangler whoami', () => assertWranglerAuth(run, outDir), confirmRetry)
      }
      steps?.step(
        reuseExistingKv && parsedExistingKvId
          ? `KV namespace — reuse existing ${parsedExistingKvId} (CLI.11 update path)`
          : 'KV namespace — create'
      )
      if (dryRun) {
        kvNamespaceId =
          reuseExistingKv && parsedExistingKvId ? parsedExistingKvId : 'dry-run-kv-id'
        output.write('[dry-run] would run: wrangler kv namespace create (or reuse existing id)\n')
      } else if (reuseExistingKv && parsedExistingKvId) {
        kvNamespaceId = parsedExistingKvId
      } else {
        kvNamespaceId = await attemptStep(
          'wrangler kv namespace create',
          () => createKvNamespaceForSite(run, outDir, siteId),
          confirmRetry
        )
      }
    }

    const wranglerSemver = readWranglerSemverFromDeployPackage()
    const plan: ScaffoldFilePlan = {
      wranglerToml: buildWranglerToml({ siteId, kvNamespaceBinding: kvNamespaceId }),
      workerEntry: buildWorkerEntry(),
      kvSeedJson: JSON.stringify(initialKvSeed(siteId, domain), null, 2)
    }

    steps?.step('Write scaffold files')
    const rerunDiff = buildRerunDiff(outDir, plan, skipSeed)
    if (rerunDiff !== null) {
      output.write(`\nRe-run detected — changes that will be applied (CLI.11):\n\n${maskSecrets(rerunDiff)}\n\n`)
      let proceed = true
      if (options?.confirmApplyChanges) {
        proceed = await options.confirmApplyChanges(rerunDiff)
      } else if (rl) {
        proceed = await confirm('Apply these changes?', true)
      }
      if (!proceed) {
        output.write('Aborted — no files changed, nothing deployed.\n')
        return
      }
    }

    writeFileSync(join(outDir, 'wrangler.toml'), plan.wranglerToml)
    writeFileSync(join(outDir, 'worker.ts'), plan.workerEntry)
    writeFileSync(join(outDir, 'kv-seed.json'), plan.kvSeedJson)
    writeFileSync(join(outDir, 'DNS.md'), formatDnsInstructions(domain, 'your-workers-subdomain.workers.dev'))
    writeFileSync(join(outDir, 'R2-OPTIONAL.md'), R2_SETUP_README)

    const deps = repoRoot
      ? {
          workerCore: relativeFileDep(outDir, join(repoRoot, 'packages', 'worker-core')),
          hostCloudflareWorker: relativeFileDep(
            outDir,
            join(repoRoot, 'packages', 'host-cloudflare-worker')
          ),
          strategies: relativeFileDep(outDir, join(repoRoot, 'packages', 'strategies'))
        }
      : standaloneDependencySpecifiers()
    writeFileSync(
      join(outDir, 'package.json'),
      buildScaffoldPackageJson({ ...deps, wranglerSemver })
    )

    writeFileSync(
      join(outDir, 'README.md'),
      buildScaffoldReadme({ domain, siteId, scaffoldOnly, standalone })
    )

    output.write(`\nWrote scaffold to ${outDir}\n`)

    if (scaffoldOnly) {
      if (standalone) {
        output.write(
          '\nStandalone scaffold: package.json references the published @attestrack/* packages.\nRun from an Attestrack repo clone instead to generate file: deps (dev mode).\n'
        )
      }
      return
    }

    const post = await postScaffoldCloudflareDeploy({
      outDir,
      siteId,
      domain,
      pagesProjectName,
      skipPortal,
      skipSeed,
      dryRun,
      repoRoot,
      run,
      consentSecretForPut: scripted?.consentSecretForPut,
      ...(steps ? { steps } : {}),
      ...(confirmRetry ? { confirmRetry } : {})
    })

    if (!dryRun) {
      const state: DeployState = {
        siteId,
        domain,
        workerUrl: post.workerUrl,
        portalUrl: post.portalUrl,
        pagesProjectName,
        updatedAt: new Date().toISOString()
      }
      writeFileSync(join(outDir, DEPLOY_STATE_FILENAME), `${JSON.stringify(state, null, 2)}\n`)
    }

    steps?.step('Verify deployment (health + custom-domain route)')
    if (dryRun) {
      output.write(
        '[dry-run] would poll: GET <worker-url>/health, then the custom-domain route (DNS can take up to 24 h)\n'
      )
    } else if (post.workerUrl) {
      // CLI.8: route verification poll. Soft-fails — deploy already happened;
      // the report tells the user what still needs DNS time or Access setup.
      await runDeployVerify({
        workerUrl: post.workerUrl,
        domain,
        ...(post.portalUrl ? { portalUrl: post.portalUrl } : {}),
        siteId,
        write: (s) => output.write(maskSecrets(s)),
        ...options?.verifyOverrides
      })
    } else {
      output.write('Worker URL not detected — skipping verification. Run `npx @attestrack/deploy verify --worker-url <url>` manually.\n')
    }

    output.write(
      buildCompletionBanner({
        workerUrl: post.workerUrl,
        portalUrl: post.portalUrl,
        outDir,
        domain,
        skipPortal
      })
    )
  } finally {
    rlDone = true
    rl?.close()
  }
}

/** Reads `attestrack-deploy/deploy-state.json` for `verify` without flags. */
export function readDeployState(cwd: string): DeployState | null {
  const p = join(cwd, 'attestrack-deploy', DEPLOY_STATE_FILENAME)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DeployState
  } catch {
    return null
  }
}

function buildScaffoldReadme(opts: {
  domain: string
  siteId: string
  scaffoldOnly: boolean
  standalone: boolean
}): string {
  const lines = [
    '# Attestrack worker scaffold',
    '',
    `Default enabled strategies (KV \`attestrack:enabled_strategies\`): ${JSON.stringify([...defaultEnabledStrategyIds])}.`,
    'Add destination ids (e.g. `meta-capi`) when you configure ad-network secrets.',
    '',
    opts.standalone
      ? 'Dependency mode: **standalone** — published `@attestrack/*` packages (npm). Re-run from an Attestrack repo clone to use local `file:` deps (dev mode).'
      : 'Dependency mode: **monorepo dev** — local `file:` deps into the Attestrack repo. Real deployments can use the published packages instead (run `npx @attestrack/deploy` outside the repo).',
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
    [
      '## Automated path',
      '',
      '`npx @attestrack/deploy` creates the KV namespace (or reuses an existing one if you confirm), installs deps, seeds KV,',
      'prompts for `CONSENT_TOKEN_SECRET`, deploys the Worker, and (unless `--skip-portal`) builds and deploys the portal to Cloudflare Pages.',
      'Re-run: use `--reuse-kv` for non-interactive reuse, or answer the reuse prompt when `wrangler.toml` already exists; the CLI shows a diff before applying (CLI.11).',
      'Use `--skip-seed` on re-runs to keep KV config the portal has edited.',
      'Post-deploy checks: `npx @attestrack/deploy verify` (health, custom-domain route, portal Access, consent commit).',
      ''
    ].join('\n'),
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
    'Rollback: `npx wrangler rollback` from this folder (see repository docs/PILOT-OSS.md → "Updates, migrations & rollback").',
    '',
    'See repository `docs/PILOT-OSS.md` for a full checklist and Cloudflare Access.',
    ''
  ]
  return lines.filter(Boolean).join('\n')
}
