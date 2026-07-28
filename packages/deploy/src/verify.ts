import { maskSecrets } from './mask.js'

/**
 * Post-deploy verification (BEH CLI.8 route check + plan P5.3 `verify`).
 *
 * Checks, in order:
 *  1. Worker `/health` (workers.dev URL — should pass immediately after deploy)
 *  2. Custom-domain route `/health` (DNS/route propagation can take up to 24 h,
 *     so a miss here is reported as *pending*, not failure)
 *  3. Portal behind Cloudflare Access (a 30x redirect to `cloudflareaccess.com`
 *     means protected; a 200 means the operator portal is PUBLIC — loud warning)
 *  4. Consent commit round-trip (POST `/__attestrack__/consent/commit` returns
 *     `{ token }` when `CONSENT_TOKEN_SECRET` is configured)
 *
 * All network access goes through an injectable `fetchFn` so the whole flow is
 * testable without live Cloudflare resources.
 */

export type FetchLikeResponse = {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: 'manual' | 'follow'
  }
) => Promise<FetchLikeResponse>

export type VerifyOptions = {
  workerUrl: string
  /** Custom tracking hostname (e.g. t.example.com). Optional. */
  domain?: string
  /** Portal (Cloudflare Pages) URL. Optional. */
  portalUrl?: string
  /** Site id used for the synthetic consent-commit check. */
  siteId?: string
  fetchFn?: FetchLike
  /** Custom-domain poll attempts (default 3; DNS can take up to 24 h — re-run later). */
  attempts?: number
  intervalMs?: number
  write?: (s: string) => void
  sleep?: (ms: number) => Promise<void>
}

export type VerifyReport = {
  workerHealth: 'ok' | 'fail'
  domainRoute: 'ok' | 'pending' | 'skipped'
  portalAccess: 'protected' | 'unprotected' | 'unreachable' | 'skipped'
  consentCommit: 'ok' | 'secret_not_configured' | 'fail' | 'skipped'
  /** Hard result: worker reachable and consent commit works. DNS "pending" and portal warnings do not flip this. */
  ok: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function defaultFetch(): FetchLike {
  return (url, init) => fetch(url, init)
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/u, '')
}

async function checkHealth(fetchFn: FetchLike, baseUrl: string): Promise<boolean> {
  try {
    const res = await fetchFn(`${normalizeBase(baseUrl)}/health`, { redirect: 'manual' })
    if (res.status !== 200) return false
    const body = await res.text()
    return body.trim() === 'ok'
  } catch {
    return false
  }
}

export async function runDeployVerify(options: VerifyOptions): Promise<VerifyReport> {
  const write = options.write ?? ((s: string) => process.stdout.write(maskSecrets(s)))
  const fetchFn = options.fetchFn ?? defaultFetch()
  const sleep = options.sleep ?? defaultSleep
  const attempts = options.attempts ?? 3
  const intervalMs = options.intervalMs ?? 2000
  const workerBase = normalizeBase(options.workerUrl)

  write('\nAttestrack deploy verification\n')

  // 1. Worker health
  write(`\n[verify 1/4] Worker health — GET ${workerBase}/health\n`)
  const workerHealthy = await checkHealth(fetchFn, workerBase)
  const workerHealth: VerifyReport['workerHealth'] = workerHealthy ? 'ok' : 'fail'
  write(
    workerHealthy
      ? '  OK — worker responded 200 "ok"\n'
      : '  FAIL — /health did not return 200 "ok". Check `npx wrangler tail` in your scaffold directory.\n'
  )

  // 2. Custom-domain route (DNS can take up to 24 h)
  let domainRoute: VerifyReport['domainRoute'] = 'skipped'
  if (options.domain) {
    const domainBase = `https://${options.domain}`
    write(`\n[verify 2/4] Custom-domain route — GET ${domainBase}/health (up to ${attempts} attempts)\n`)
    domainRoute = 'pending'
    for (let i = 1; i <= attempts; i++) {
      if (await checkHealth(fetchFn, domainBase)) {
        domainRoute = 'ok'
        break
      }
      if (i < attempts) await sleep(intervalMs)
    }
    write(
      domainRoute === 'ok'
        ? `  OK — ${options.domain} routes to your Worker\n`
        : [
            `  PENDING — ${options.domain} is not serving the Worker yet.`,
            '  DNS and custom-domain attachment can take up to 24 hours to propagate.',
            '  This is normal right after deploy; re-run `npx @attestrack/deploy verify` later.',
            '  See attestrack-deploy/DNS.md for the exact record to configure.',
            ''
          ].join('\n')
    )
  } else {
    write('\n[verify 2/4] Custom-domain route — skipped (no domain provided)\n')
  }

  // 3. Portal behind Cloudflare Access
  let portalAccess: VerifyReport['portalAccess'] = 'skipped'
  if (options.portalUrl) {
    write(`\n[verify 3/4] Portal Access protection — GET ${options.portalUrl}\n`)
    try {
      const res = await fetchFn(normalizeBase(options.portalUrl), { redirect: 'manual' })
      const location = res.headers.get('location') ?? ''
      if (res.status >= 300 && res.status < 400 && location.includes('cloudflareaccess.com')) {
        portalAccess = 'protected'
        write('  OK — portal redirects to Cloudflare Access (protected)\n')
      } else if (res.status >= 300 && res.status < 400) {
        portalAccess = 'unprotected'
        write(
          `  WARNING — portal redirects to ${location || '(unknown)'} — not Cloudflare Access. Treat as UNPROTECTED.\n`
        )
      } else if (res.status === 200) {
        portalAccess = 'unprotected'
        write(
          [
            '  WARNING — the portal answered 200 without an Access redirect: it is PUBLIC.',
            '  Create a Cloudflare Access application for this hostname before real use',
            '  (Zero Trust → Access → Applications). See docs/PILOT-OSS.md → Cloudflare Access checklist.',
            ''
          ].join('\n')
        )
      } else {
        portalAccess = 'unreachable'
        write(`  WARN — portal returned HTTP ${res.status}; could not determine Access status.\n`)
      }
    } catch {
      portalAccess = 'unreachable'
      write('  WARN — portal not reachable; could not determine Access status.\n')
    }
  } else {
    write('\n[verify 3/4] Portal Access protection — skipped (no portal URL provided)\n')
  }

  // 4. Consent commit round-trip
  write(`\n[verify 4/4] Consent commit — POST ${workerBase}/__attestrack__/consent/commit\n`)
  let consentCommit: VerifyReport['consentCommit'] = 'fail'
  try {
    const res = await fetchFn(`${workerBase}/__attestrack__/consent/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: options.siteId ?? 'deploy-verify',
        decision: 'granted',
        policyHash: 'deploy-verify'
      })
    })
    if (res.status === 200) {
      const body = (await res.text()) || ''
      consentCommit = body.includes('"token"') ? 'ok' : 'fail'
    } else if (res.status === 503) {
      consentCommit = 'secret_not_configured'
    } else {
      consentCommit = 'fail'
    }
  } catch {
    consentCommit = 'fail'
  }
  write(
    consentCommit === 'ok'
      ? '  OK — consent commit returned a token\n'
      : consentCommit === 'secret_not_configured'
        ? '  FAIL — CONSENT_TOKEN_SECRET is not set. Run `npx wrangler secret put CONSENT_TOKEN_SECRET` in attestrack-deploy/.\n'
        : '  FAIL — consent commit did not return a token (check worker logs).\n'
  )

  const ok = workerHealth === 'ok' && consentCommit === 'ok'
  write(
    ok
      ? '\nVerification passed.' +
          (domainRoute === 'pending' ? ' (custom-domain route still propagating — up to 24 h)' : '') +
          (portalAccess === 'unprotected' ? ' WARNING: portal is unprotected.' : '') +
          '\n'
      : '\nVerification FAILED — see messages above.\n'
  )

  return { workerHealth, domainRoute, portalAccess, consentCommit, ok }
}
