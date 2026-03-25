import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrue/sdk'
import type { ConsentEventRecordV1, StrategyManifest } from '@attestrue/types'
import { KV_KEY_CONSENT_EVENT_PREFIX } from '@attestrue/types'

function gpcActive(request: Request): boolean {
  return request.headers.get('Sec-GPC') === '1'
}

/**
 * **EvidenceUnsignedStrategy**: writes a flat `ConsentEventRecordV1` (self-attested).
 * Licensed **Proof** (witnessed trust chain, CETS v1.1) remains out of the public core per ADR-002.
 */
export const evidenceUnsignedStrategyManifest: StrategyManifest = {
  id: 'evidence-unsigned',
  stage: 'mandatory',
  displayName: 'Consent event log (unsigned operational record)'
}

export const evidenceUnsignedStrategy: Strategy = {
  id: 'evidence-unsigned',
  stage: 'mandatory',
  manifest: evidenceUnsignedStrategyManifest,
  async run(ctx: StrategyPipelineContext): Promise<StrategyResult> {
    const gpc = gpcActive(ctx.request)
    const honor = ctx.jurisdictionRow?.gpc_honor ?? false
    const siteId =
      ctx.tracking?.siteId ?? ctx.consent?.payload.siteId ?? 'unknown'
    const decision =
      ctx.consent?.payload.decision ?? ctx.tracking?.consentDecision ?? 'declined'
    const policyHash = ctx.consent?.payload.policyHash ?? ''

    const record: ConsentEventRecordV1 = {
      v: 1,
      recordedAt: new Date().toISOString(),
      siteId,
      decision,
      jurisdictionKey: ctx.jurisdictionKey ?? 'DEFAULT',
      policyHash,
      ioaAttested: ctx.consent != null,
      gpcSignalHonored: gpc && honor,
      configFingerprint: ctx.jurisdictionKey
    }

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    await ctx.host.kv.put(`${KV_KEY_CONSENT_EVENT_PREFIX}${id}`, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 90
    })

    return { continuePipeline: true }
  }
}
