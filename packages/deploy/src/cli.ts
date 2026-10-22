#!/usr/bin/env node
import { maskSecrets } from './mask.js'
import { readDeployState, runInteractiveDeploy } from './index.js'
import { runDeployVerify } from './verify.js'

const HELP = `attestrack-deploy — guided Cloudflare deploy for Attestrack

Usage:
  npx @attestrack/deploy [flags]          Guided deploy (Worker + KV + optional Pages portal)
  npx @attestrack/deploy verify [flags]   Post-deploy checks (health, DNS route, Access, consent)

Deploy flags:
  --scaffold-only   Write files only; no wrangler / npm / Pages
  --skip-portal     Worker only; no Pages build or deploy
  --skip-seed       Do not re-write KV seed keys (keep portal-edited config)
  --reuse-kv        Non-interactive reuse of an existing scaffold's KV namespace
  --dry-run         Print every step without touching Cloudflare (also: ATTESTRACK_DEPLOY_DRY_RUN=1)
  --clickhouse-vpc-service-id <id>
                     Bind private ClickHouse through a Cloudflare Workers VPC service

Verify flags (defaults come from attestrack-deploy/deploy-state.json when present):
  --worker-url <url>   Worker URL (e.g. https://attestrack-x.y.workers.dev)
  --domain <host>      Custom tracking hostname (e.g. t.example.com)
  --portal-url <url>   Portal (Pages) URL
  --site-id <id>       Site id for the synthetic consent-commit check
`

function parseFlagValue(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i >= 0 && i + 1 < args.length && !args[i + 1]!.startsWith('--')) return args[i + 1]
  return undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP)
    return
  }

  if (args[0] === 'verify' || args.includes('--verify')) {
    const rest = args.filter((a) => a !== 'verify' && a !== '--verify')
    const state = readDeployState(process.cwd())
    const workerUrl = parseFlagValue(rest, '--worker-url') ?? state?.workerUrl ?? undefined
    if (!workerUrl) {
      process.stderr.write(
        'verify: no --worker-url given and no attestrack-deploy/deploy-state.json found (run a deploy first, or pass --worker-url).\n'
      )
      process.exit(2)
    }
    const domain = parseFlagValue(rest, '--domain') ?? state?.domain ?? undefined
    const portalUrl = parseFlagValue(rest, '--portal-url') ?? state?.portalUrl ?? undefined
    const siteId = parseFlagValue(rest, '--site-id') ?? state?.siteId ?? undefined
    const report = await runDeployVerify({
      workerUrl,
      ...(domain ? { domain } : {}),
      ...(portalUrl ? { portalUrl } : {}),
      ...(siteId ? { siteId } : {})
    })
    process.exit(report.ok ? 0 : 1)
  }

  const scaffoldOnly = args.includes('--scaffold-only')
  const skipPortal = args.includes('--skip-portal')
  const skipSeed = args.includes('--skip-seed')
  const reuseExistingKvWhenPresent = args.includes('--reuse-kv')
  const dryRun = args.includes('--dry-run')
  const clickhouseVpcServiceId = parseFlagValue(args, '--clickhouse-vpc-service-id')

  await runInteractiveDeploy({
    scaffoldOnly,
    skipPortal,
    skipSeed,
    reuseExistingKvWhenPresent,
    dryRun,
    ...(clickhouseVpcServiceId ? { clickhouseVpcServiceId } : {})
  })
}

void main().catch((err: unknown) => {
  // Masked (CLI.5 / INV-B-10): error text may embed subprocess output.
  process.stderr.write(`${maskSecrets(err instanceof Error ? (err.stack ?? err.message) : String(err))}\n`)
  process.exit(1)
})
