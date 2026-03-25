import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initialKvSeed } from './kv-schema.js'
import {
  parseKvNamespaceIdFromCreateOutput,
  parsePagesDevUrl,
  parseWorkersDevUrl
} from './parse-wrangler-output.js'
import type { RunCommandFn } from './run-command.js'

export type PostScaffoldDeployOptions = {
  outDir: string
  siteId: string
  domain: string
  pagesProjectName: string
  skipPortal: boolean
  dryRun: boolean
  repoRoot: string
  run: RunCommandFn
  /** When set, pipes value to `wrangler secret put` (non-interactive). */
  consentSecretForPut?: string
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
    throw new Error(`wrangler kv namespace create failed:\n${combined}`)
  }
  const id = parseKvNamespaceIdFromCreateOutput(combined)
  if (!id) {
    throw new Error(`Could not parse KV namespace id from wrangler output:\n${combined}`)
  }
  return id
}

export async function postScaffoldCloudflareDeploy(
  opts: PostScaffoldDeployOptions
): Promise<PostScaffoldDeployResult> {
  const { outDir, siteId, domain, pagesProjectName, skipPortal, dryRun, run, consentSecretForPut, repoRoot } =
    opts

  if (dryRun) {
    process.stdout.write(
      '[dry-run] would run: npm install, wrangler kv bulk put, secret put, deploy, optional pages deploy\n'
    )
    return {
      workerUrl: 'https://dry-run.workers.dev',
      portalUrl: skipPortal ? null : 'https://dry-run.pages.dev'
    }
  }

  const bulkPath = join(outDir, '.kv-bulk-upload.json')
  const seed = initialKvSeed(siteId, domain)
  const bulk = Object.entries(seed).map(([key, value]) => ({ key, value }))
  writeFileSync(bulkPath, JSON.stringify(bulk))

  const install = await run(npxCmd(), ['npm', 'install', '--no-fund', '--no-audit'], { cwd: outDir })
  if (install.code !== 0) {
    throw new Error(`npm install in scaffold failed:\n${install.stderr}`)
  }

  const bulkPut = await wrangler(run, outDir, ['kv', 'bulk', 'put', bulkPath, '--binding', 'ATTESTRACK_KV'])
  if (bulkPut.code !== 0) {
    throw new Error(`wrangler kv bulk put failed:\n${bulkPut.stderr || bulkPut.stdout}`)
  }

  if (consentSecretForPut !== undefined) {
    const sec = await wrangler(run, outDir, ['secret', 'put', 'CONSENT_TOKEN_SECRET'], {
      input: `${consentSecretForPut}\n`
    })
    if (sec.code !== 0) {
      throw new Error(`wrangler secret put CONSENT_TOKEN_SECRET failed:\n${sec.stderr || sec.stdout}`)
    }
  } else {
    process.stdout.write(
      '\nSet Worker secret CONSENT_TOKEN_SECRET (32+ characters). Wrangler will prompt securely.\n'
    )
    const sec = await wrangler(run, outDir, ['secret', 'put', 'CONSENT_TOKEN_SECRET'], { inheritStdio: true })
    if (sec.code !== 0) {
      throw new Error('wrangler secret put failed or was cancelled.')
    }
  }

  const dep = await wrangler(run, outDir, ['deploy'])
  if (dep.code !== 0) {
    throw new Error(`wrangler deploy failed:\n${dep.stderr || dep.stdout}`)
  }
  const workerUrl = parseWorkersDevUrl(dep.stdout + dep.stderr)

  let portalUrl: string | null = null
  if (!skipPortal) {
    const portalDir = join(repoRoot, 'packages', 'portal-community')
    const env = {
      ...process.env,
      VITE_ATTESTRACK_API_BASE_URL: workerUrl ?? ''
    }
    const buildPortal = await run('pnpm', ['run', 'build'], { cwd: portalDir, env })
    if (buildPortal.code !== 0) {
      throw new Error(
        `Portal build failed (\`pnpm run build\` in ${portalDir}). Install pnpm 9+ from the repo root.\n${buildPortal.stderr}`
      )
    }

    const distDir = join(portalDir, 'dist')
    const pagesDeploy = await wrangler(run, portalDir, [
      'pages',
      'deploy',
      distDir,
      '--project-name',
      pagesProjectName
    ])
    if (pagesDeploy.code !== 0) {
      throw new Error(`wrangler pages deploy failed:\n${pagesDeploy.stderr || pagesDeploy.stdout}`)
    }
    portalUrl = parsePagesDevUrl(pagesDeploy.stdout + pagesDeploy.stderr)
  }

  return { workerUrl, portalUrl }
}
