import type { HostRuntime } from '@attestrue/host-contracts'
import { consentCommitRequestSchema } from '@attestrue/schema'
import {
  createPrivacyConsentToken,
  resolveStrategiesWithReplaces,
  type Strategy,
  type StrategyLoader,
  type StrategyPipelineContext
} from '@attestrue/sdk'
import { runStrategiesForStage } from './composite.js'

export interface AttestrackWorkerOptions {
  host: HostRuntime
  consentSecretName: string
  bundledStrategies: readonly Strategy[]
  strategyLoader: StrategyLoader
}

export function createAttestrackFetchHandler(options: AttestrackWorkerOptions) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

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

    const extensions = await options.strategyLoader.loadForRequest(request)
    const effectiveStrategies = resolveStrategiesWithReplaces(options.bundledStrategies, extensions)

    const ctx: StrategyPipelineContext = {
      host: options.host,
      request
    }

    await runStrategiesForStage('mandatory', ctx, effectiveStrategies)
    await runStrategiesForStage('destination', ctx, effectiveStrategies)
    await runStrategiesForStage('analytics', ctx, effectiveStrategies)

    return Response.json(
      { ok: true, consentDecision: ctx.consent?.payload.decision ?? null },
      { headers: { 'cache-control': 'no-store' } }
    )
  }
}
