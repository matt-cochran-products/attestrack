import type { Strategy, StrategyPipelineContext, StrategyResult } from '@attestrack/sdk'
import type { ConsentEventRecordV1, StrategyManifest } from '@attestrack/types'
import { DEFAULT_CONSENT_EVENT_TTL_SECONDS, KV_KEY_CONSENT_EVENT_PREFIX } from '@attestrack/types'

function gpcActive(request: Request): boolean {
  return request.headers.get('Sec-GPC') === '1'
}

/**
 * Deterministic record id for a token-backed consent event: the token's
 * signature segment (unique per payload+key — it IS the HMAC) plus the
 * effective decision (GPC can flip a granted token to declined at gate time,
 * and that state change deserves its own record).
 */
function tokenRecordId(rawToken: string, decision: string): string {
  const parts = rawToken.split('.')
  const sig = parts.length === 3 ? parts[2]! : rawToken
  return `tok:${sig}:${decision}`
}

/** Deterministic per-UTC-day record id for an honored GPC signal without a token. */
function gpcRecordId(siteId: string, jurisdictionKey: string, now: Date): string {
  return `gpc:${siteId}:${jurisdictionKey}:${now.toISOString().slice(0, 10)}`
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
 *
 * P7.1 KV write-amplification mitigation (threat model: consent-event flooding):
 * - A record is written ONLY when an actual consent signal is present — a
 *   verified consent token (`ctx.consent`) or an honored GPC header. Anonymous
 *   requests with neither write NOTHING, so unauthenticated traffic cannot
 *   grow KV (cost/DoS vector: every `/t/event` or stray request used to write
 *   one record per hit).
 * - Records are deduplicated via deterministic KV keys (read-before-write):
 *   one record per (token signature, effective decision), and one per
 *   (siteId, jurisdiction, UTC day) for token-less honored-GPC signals.
 *   Re-presenting the same cookie on every page view no longer amplifies.
 * - Rationale for the semantic change: a per-request "no signal present"
 *   record is not consent evidence — it is anonymous, self-attested, carries
 *   no user identity, and is fully derivable from config + the observability
 *   counters. Actual decisions (token) and decision-signals (GPC) are kept.
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
    const token = ctx.consent ?? null
    const gpcHonored = gpc && honor

    // P7.1: no consent signal → no KV write (anonymous-flood mitigation).
    if (!token && !gpcHonored) {
      return { continuePipeline: true }
    }

    const now = new Date()
    const siteId = ctx.tracking?.siteId ?? token?.payload.siteId ?? 'unknown'
    const decision =
      ctx.consentGate?.effectiveDecision ??
      token?.payload.decision ??
      ctx.tracking?.consentDecision ??
      'declined'
    const policyHash = token?.payload.policyHash ?? ''
    const acceptedIoa = token?.payload.ioa ?? []
    const jurisdictionKey = ctx.jurisdictionKey ?? 'DEFAULT'

    const id = token
      ? tokenRecordId(token.raw, decision)
      : gpcRecordId(siteId, jurisdictionKey, now)
    const key = `${KV_KEY_CONSENT_EVENT_PREFIX}${id}`

    // Dedup: deterministic key already recorded → skip the write. The read is
    // cheap relative to a KV write and bounds steady-state writes to one per
    // distinct decision, not one per request.
    if (await ctx.host.kv.get(key)) {
      return { continuePipeline: true }
    }

    const record: ConsentEventRecordV1 = {
      v: 1,
      recordedAt: now.toISOString(),
      siteId,
      decision,
      jurisdictionKey,
      policyHash,
      ioaAttested: acceptedIoa.length > 0,
      gpcSignalHonored: gpcHonored,
      ...(ctx.consentGate
        ? { mechanism: ctx.consentGate.mechanism, mode: ctx.consentGate.mode }
        : ctx.jurisdictionRow
          ? { mechanism: ctx.jurisdictionRow.mechanism }
          : {}),
      configFingerprint: ctx.jurisdictionKey
    }

    await ctx.host.kv.put(key, JSON.stringify(record), {
      expirationTtl: ctx.site?.consentEventTtlSeconds ?? DEFAULT_CONSENT_EVENT_TTL_SECONDS
    })

    return { continuePipeline: true }
  }
}
