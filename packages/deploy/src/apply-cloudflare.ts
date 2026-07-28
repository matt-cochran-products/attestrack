import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initialKvSeed } from './kv-schema.js'
import { maskSecrets } from './mask.js'
import {
  parseKvNamespaceIdFromCreateOutput,
  parsePagesDevUrl,
  parseWorkersDevUrl
} from './parse-wrangler-output.js'
import type { RunCommandFn } from './run-command.js'
import type { StepPrinter } from './steps.js'

export const ATTESTRACK_REPO_GIT_URL = 'https://github.com/matt-cochran/attestrack.git'

/**
 * Recoverable-error retry hook (BEH CLI.4). Interactive runs pass a
 * readline-backed prompt; scripted runs may inject one. When absent, a failed
 * step throws immediately (no silent retries).
 */
export type ConfirmRetryFn = (message: string) => Promise<boolean>

export type PostScaffoldDeployOptions = {
  outDir: string
  siteId: string
  domain: string
  pagesProjectName: string
  skipPortal: boolean
  /** Skip `wrangler kv bulk put` (re-runs where the operator has edited KV via the portal). */
  skipSeed?: boolean
  dryRun: boolean
  /** Monorepo root when running in dev mode; null = standalone (published packages). */
  repoRoot: string | null
  run: RunCommandFn
  /** When set, pipes value to `wrangler secret put` (non-interactive). */
  consentSecretForPut?: string
  steps?: StepPrinter
  confirmRetry?: ConfirmRetryFn
}

export type PostScaffoldDeployResult = {
  workerUrl: string | null
  portalUrl: string | null
}

function npxCmd(): string {
  return 'npx'
}

async function wrangler(
  run: RunCommandFn,
  cwd: string,
  args: string[],
  extra?: { inheritStdio?: boolean; input?: string }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return run(npxCmd(), ['wrangler', ...args], { cwd, ...extra })
}

/**
 * Run `fn`; on failure, explain what went wrong (masked) and — when a retry
 * hook is present — offer to retry the step (BEH CLI.4). Unrecoverable steps
 * simply do not pass a `confirmRetry`.
 */
export async function attemptStep<T>(
  label: string,
  fn: () => Promise<T>,
  confirmRetry?: ConfirmRetryFn
): Promise<T> {
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      const message = maskSecrets(err instanceof Error ? err.message : String(err))
      if (!confirmRetry) throw new Error(message)
      const retry = await confirmRetry(
        `${label} failed:\n${message}\nThis step is usually recoverable (network / auth / transient Cloudflare error). Retry?`
      )
      if (!retry) throw new Error(`${label} failed (user declined retry):\n${message}`)
    }
  }
}

export async function assertWranglerAuth(run: RunCommandFn, cwd: string): Promise<void> {
  const who = await wrangler(run, cwd, ['whoami'])
  if (who.code !== 0) {
    throw new Error(
      'wrangler whoami failed. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN with Workers + KV + Pages permissions.'
    )
  }
}

/** Create a KV namespace titled `attestrack-kv-{siteId}`; returns namespace id. */
export async function createKvNamespaceForSite(
  run: RunCommandFn,
  cwd: string,
  siteId: string
): Promise<string> {
  const nsTitle = `attestrack-kv-${siteId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`
  const createNs = await wrangler(run, cwd, ['kv', 'namespace', 'create', nsTitle])
  const combined = createNs.stdout + createNs.stderr
  if (createNs.code !== 0) {
    throw new Error(maskSecrets(`wrangler kv namespace create failed:\n${combined}`))
  }
  const id = parseKvNamespaceIdFromCreateOutput(combined)
  if (!id) {
    throw new Error(maskSecrets(`Could not parse KV namespace id from wrangler output:\n${combined}`))
  }
  return id
}

/**
 * Standalone-mode portal source: the community portal is built from the
 * Attestrack repository (its Vite build bakes `VITE_ATTESTRACK_API_BASE_URL`
 * in at build time — INV-B-11: the portal is always deployed to the
 * *customer's* Pages, never hosted for them). When no monorepo is present the
 * CLI shallow-clones the repo into the scaffold and builds there.
 */
async function acquirePortalSourceDir(opts: {
  outDir: string
  repoRoot: string | null
  run: RunCommandFn
}): Promise<string> {
  if (opts.repoRoot) {
    return join(opts.repoRoot, 'packages', 'portal-community')
  }
  const cloneDir = join(opts.outDir, '.portal-src')
  const clone = await opts.run('git', ['clone', '--depth', '1', ATTESTRACK_REPO_GIT_URL, cloneDir], {
    cwd: opts.outDir
  })
  if (clone.code !== 0) {
    throw new Error(
      maskSecrets(
        [
          `git clone of ${ATTESTRACK_REPO_GIT_URL} failed (needed to build the portal in standalone mode):`,
          clone.stderr || clone.stdout,
          'Fix: install git and re-run, or re-run with --skip-portal and deploy the portal later from a repo clone (docs/PILOT-OSS.md).'
        ].join('\n')
      )
    )
  }
  const install = await opts.run(npxCmd(), ['pnpm@9', 'install', '--frozen-lockfile'], { cwd: cloneDir })
  if (install.code !== 0) {
    throw new Error(maskSecrets(`pnpm install in cloned repo failed:\n${install.stderr || install.stdout}`))
  }
  return join(cloneDir, 'packages', 'portal-community')
}

async function buildAndDeployPortal(opts: {
  outDir: string
  repoRoot: string | null
  pagesProjectName: string
  workerUrl: string | null
  run: RunCommandFn
}): Promise<string | null> {
  const portalDir = await acquirePortalSourceDir(opts)
  const env = {
    ...process.env,
    VITE_ATTESTRACK_API_BASE_URL: opts.workerUrl ?? ''
  }
  const buildCmd: [string, string[]] = opts.repoRoot
    ? ['pnpm', ['run', 'build']]
    : [npxCmd(), ['pnpm@9', 'run', 'build']]
  const buildPortal = await opts.run(buildCmd[0], buildCmd[1], { cwd: portalDir, env })
  if (buildPortal.code !== 0) {
    throw new Error(
      maskSecrets(
        `Portal build failed (\`pnpm run build\` in ${portalDir}). Install pnpm 9+ from the repo root.\n${buildPortal.stderr}`
      )
    )
  }

  const distDir = join(portalDir, 'dist')
  const pagesDeploy = await wrangler(opts.run, portalDir, [
    'pages',
    'deploy',
    distDir,
    '--project-name',
    opts.pagesProjectName
  ])
  if (pagesDeploy.code !== 0) {
    throw new Error(maskSecrets(`wrangler pages deploy failed:\n${pagesDeploy.stderr || pagesDeploy.stdout}`))
  }
  return parsePagesDevUrl(pagesDeploy.stdout + pagesDeploy.stderr)
}

export async function postScaffoldCloudflareDeploy(
  opts: PostScaffoldDeployOptions
): Promise<PostScaffoldDeployResult> {
  const {
    outDir,
    siteId,
    domain,
    pagesProjectName,
    skipPortal,
    skipSeed,
    dryRun,
    run,
    consentSecretForPut,
    repoRoot,
    steps,
    confirmRetry
  } = opts

  const announce = (label: string) => steps?.step(label)

  if (dryRun) {
    announce('Install scaffold dependencies')
    process.stdout.write('[dry-run] would run: npm install --no-fund --no-audit (in scaffold)\n')
    announce(skipSeed ? 'Seed KV — skipped (--skip-seed)' : 'Seed KV')
    if (!skipSeed) {
      process.stdout.write('[dry-run] would run: wrangler kv bulk put .kv-bulk-upload.json --binding ATTESTRACK_KV\n')
    }
    announce('Set CONSENT_TOKEN_SECRET')
    process.stdout.write('[dry-run] would run: wrangler secret put CONSENT_TOKEN_SECRET (value never echoed)\n')
    announce('Deploy Worker')
    process.stdout.write('[dry-run] would run: wrangler deploy\n')
    if (!skipPortal) {
      announce('Build and deploy portal (your Cloudflare Pages)')
      process.stdout.write(
        repoRoot
          ? '[dry-run] would run: pnpm run build (packages/portal-community) + wrangler pages deploy\n'
          : `[dry-run] would run: git clone --depth 1 ${ATTESTRACK_REPO_GIT_URL}, pnpm install, portal build + wrangler pages deploy\n`
      )
    }
    return {
      workerUrl: 'https://dry-run.workers.dev',
      portalUrl: skipPortal ? null : 'https://dry-run.pages.dev'
    }
  }

  announce('Install scaffold dependencies')
  await attemptStep(
    'npm install (scaffold)',
    async () => {
      const install = await run(npxCmd(), ['npm', 'install', '--no-fund', '--no-audit'], { cwd: outDir })
      if (install.code !== 0) {
        throw new Error(`npm install in scaffold failed:\n${install.stderr}`)
      }
    },
    confirmRetry
  )

  announce(skipSeed ? 'Seed KV — skipped (--skip-seed)' : 'Seed KV')
  if (!skipSeed) {
    const bulkPath = join(outDir, '.kv-bulk-upload.json')
    const seed = initialKvSeed(siteId, domain)
    const bulk = Object.entries(seed).map(([key, value]) => ({ key, value }))
    writeFileSync(bulkPath, JSON.stringify(bulk))
    await attemptStep(
      'wrangler kv bulk put',
      async () => {
        const bulkPut = await wrangler(run, outDir, ['kv', 'bulk', 'put', bulkPath, '--binding', 'ATTESTRACK_KV'])
        if (bulkPut.code !== 0) {
          throw new Error(`wrangler kv bulk put failed:\n${bulkPut.stderr || bulkPut.stdout}`)
        }
      },
      confirmRetry
    )
  }

  announce('Set CONSENT_TOKEN_SECRET')
  if (consentSecretForPut !== undefined) {
    await attemptStep(
      'wrangler secret put CONSENT_TOKEN_SECRET',
      async () => {
        const sec = await wrangler(run, outDir, ['secret', 'put', 'CONSENT_TOKEN_SECRET'], {
          input: `${consentSecretForPut}\n`
        })
        if (sec.code !== 0) {
          throw new Error(`wrangler secret put CONSENT_TOKEN_SECRET failed:\n${sec.stderr || sec.stdout}`)
        }
      },
      confirmRetry
    )
  } else {
    process.stdout.write(
      '\nSet Worker secret CONSENT_TOKEN_SECRET (32+ characters). Wrangler will prompt securely (input masked, never logged).\n'
    )
    await attemptStep(
      'wrangler secret put CONSENT_TOKEN_SECRET',
      async () => {
        const sec = await wrangler(run, outDir, ['secret', 'put', 'CONSENT_TOKEN_SECRET'], { inheritStdio: true })
        if (sec.code !== 0) {
          throw new Error('wrangler secret put failed or was cancelled.')
        }
      },
      confirmRetry
    )
  }

  announce('Deploy Worker')
  const dep = await attemptStep(
    'wrangler deploy',
    async () => {
      const res = await wrangler(run, outDir, ['deploy'])
      if (res.code !== 0) {
        throw new Error(`wrangler deploy failed:\n${res.stderr || res.stdout}`)
      }
      return res
    },
    confirmRetry
  )
  const workerUrl = parseWorkersDevUrl(dep.stdout + dep.stderr)

  let portalUrl: string | null = null
  if (!skipPortal) {
    announce('Build and deploy portal (your Cloudflare Pages)')
    portalUrl = await attemptStep(
      'portal build + pages deploy',
      () => buildAndDeployPortal({ outDir, repoRoot, pagesProjectName, workerUrl, run }),
      confirmRetry
    )
  }

  return { workerUrl, portalUrl }
}
