/**
 * E2E worker entry — mirrors the deploy scaffold's generated `worker.ts`
 * (packages/deploy/src/worker-template.ts) so Playwright journeys run against
 * the SAME composition customers deploy: production host adapter + full
 * bundled strategy set + noop loader, under workerd via `wrangler dev`.
 */
import { createCloudflareHostRuntime } from '@attestrack/host-cloudflare-worker'
import { createAttestrackFetchHandler, noopStrategyLoader } from '@attestrack/worker-core'
import { allBundledStrategies } from '@attestrack/strategies'

interface Env {
  ATTESTRACK_KV: KVNamespace
  CONSENT_TOKEN_SECRET: string
  SITE_ID: string
}

/** As in the scaffold: every string binding reaches host.getSecret(). */
function stringBindings(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const host = createCloudflareHostRuntime({
      bindings: { kv: env.ATTESTRACK_KV },
      executionCtx: ctx,
      secretValues: stringBindings(env)
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
