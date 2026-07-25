import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrack/sdk'
import type { ConsentEventRecordV1, StrategyManifest } from '@attestrack/types'
import { DEFAULT_CONSENT_EVENT_TTL_SECONDS, KV_KEY_CONSENT_EVENT_PREFIX } from '@attestrack/types'

function gpcActive(request: Request): boolean {
  return request.headers.get('Sec-GPC') === '1'
}

/**
 * **EvidenceUnsignedStrategy**: writes a flat `ConsentEventRecordV1` (self-attested).
 * Licensed **Proof** (witnessed trust chain, CETS v1.1) remains out of the public core per ADR-002.
 *
 * P2.5 correctness:
 * - `ioaAttested` reflects ACTUAL IOA acceptance (token `payload.ioa` non-empty),
 *   never mere token presence.
 * - `mechanism` and `mode` from the consent gate are recorded for auditability.
 * - The KV TTL is operator-configurable (site config `consentEventTtlSeconds`).
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
    const siteId = ctx.tracking?.siteId ?? ctx.consent?.payload.siteId ?? 'unknown'
    const decision =
      ctx.consentGate?.effectiveDecision ??
      ctx.consent?.payload.decision ??
      ctx.tracking?.consentDecision ??
      'declined'
    const policyHash = ctx.consent?.payload.policyHash ?? ''
    const acceptedIoa = ctx.consent?.payload.ioa ?? []

    const record: ConsentEventRecordV1 = {
      v: 1,
      recordedAt: new Date().toISOString(),
      siteId,
      decision,
      jurisdictionKey: ctx.jurisdictionKey ?? 'DEFAULT',
      policyHash,
      ioaAttested: acceptedIoa.length > 0,
      gpcSignalHonored: gpc && honor,
      ...(ctx.consentGate
        ? { mechanism: ctx.consentGate.mechanism, mode: ctx.consentGate.mode }
        : ctx.jurisdictionRow
          ? { mechanism: ctx.jurisdictionRow.mechanism }
          : {}),
      configFingerprint: ctx.jurisdictionKey
    }

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    await ctx.host.kv.put(`${KV_KEY_CONSENT_EVENT_PREFIX}${id}`, JSON.stringify(record), {
      expirationTtl: ctx.site?.consentEventTtlSeconds ?? DEFAULT_CONSENT_EVENT_TTL_SECONDS
    })

    return { continuePipeline: true }
  }
}
