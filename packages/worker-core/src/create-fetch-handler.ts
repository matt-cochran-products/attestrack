import type { HostRuntime } from '@attestrack/host-contracts'
import { consentCommitRequestSchema, trackingEventV1Schema } from '@attestrack/schema'
import {
  createPrivacyConsentToken,
  resolveStrategiesWithReplaces,
  type Strategy,
  type StrategyLoader,
  type StrategyPipelineContext
} from '@attestrack/sdk'
import { KV_KEY_ENABLED_STRATEGIES, KV_KEY_POLICY_PRIVACY, KV_KEY_POLICY_TERMS } from '@attestrack/types'
import {
  runDestinationStrategiesParallel,
  runMandatoryStrategies,
  runStrategiesForStage
} from './composite.js'
import { filterStrategiesByEnabledKv, parseEnabledStrategiesKv } from './enabled-strategies.js'
import { TRACKING_EVENT_PATH } from './constants.js'
import { handlePortalRequest } from './portal.js'

const DEFAULT_PRIVACY = 'Privacy policy not configured. Set KV key attestrack:policy:privacy.\n'
const DEFAULT_TERMS = 'Terms of use not configured. Set KV key attestrack:policy:terms.\n'

export interface AttestrackWorkerOptions {
  host: HostRuntime
  consentSecretName: string
  bundledStrategies: readonly Strategy[]
  strategyLoader: StrategyLoader
}

async function runPipeline(
  options: AttestrackWorkerOptions,
  request: Request,
  seed: Pick<StrategyPipelineContext, 'tracking' | 'consent'> = {}
): Promise<StrategyPipelineContext> {
  const extensions = await options.strategyLoader.loadForRequest(request)
  const merged = resolveStrategiesWithReplaces(options.bundledStrategies, extensions)
  const rawEnabled = await options.host.kv.get(KV_KEY_ENABLED_STRATEGIES)
  const enabledIds = parseEnabledStrategiesKv(rawEnabled)
  const effectiveStrategies = filterStrategiesByEnabledKv(merged, enabledIds)
  const ctx: StrategyPipelineContext = {
    host: options.host,
    request,
    ...seed
  }
  await runMandatoryStrategies(ctx, effectiveStrategies)
  await runDestinationStrategiesParallel(ctx, effectiveStrategies)
  await runStrategiesForStage('analytics', ctx, effectiveStrategies)
  return ctx
}

export function createAttestrackFetchHandler(options: AttestrackWorkerOptions) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    const portalRes = await handlePortalRequest(request, options.host)
    if (portalRes) return portalRes

    if (request.method === 'POST' && url.pathname === '/__attestrack__/consent/commit') {
      const secret = options.host.getSecret(options.consentSecretName)
      if (!secret) {
        return Response.json({ error: 'consent_secret_not_configured' }, { status: 503 })
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'invalid_json' }, { status: 400 })
      }
      const parsed = consentCommitRequestSchema.safeParse(body)
      if (!parsed.success) {
        return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
      }
      const token = await createPrivacyConsentToken(secret, parsed.data)
      return Response.json({ token })
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 })
    }

    if (request.method === 'GET' && url.pathname === '/privacy') {
      const text = (await options.host.kv.get(KV_KEY_POLICY_PRIVACY)) ?? DEFAULT_PRIVACY
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      })
    }

    if (request.method === 'GET' && url.pathname === '/terms') {
      const text = (await options.host.kv.get(KV_KEY_POLICY_TERMS)) ?? DEFAULT_TERMS
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      })
    }

    if (request.method === 'POST' && url.pathname === TRACKING_EVENT_PATH) {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'invalid_json' }, { status: 400 })
      }
      const parsed = trackingEventV1Schema.safeParse(body)
      if (!parsed.success) {
        return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
      }

      options.host.scheduleBackground(async () => {
        await runPipeline(options, request, { tracking: parsed.data })
      })

      return Response.json(
        { ok: true, accepted: true },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    const ctx = await runPipeline(options, request)

    return Response.json(
      { ok: true, consentDecision: ctx.consent?.payload.decision ?? null },
      { headers: { 'cache-control': 'no-store' } }
    )
  }
}
