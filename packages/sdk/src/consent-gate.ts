import type {
  ConsentDecision,
  ConsentGateResult,
  JurisdictionConsentRow,
  SitePipelineMode
} from '@attestrack/types'
import type { StrategyPipelineContext } from './interfaces.js'

export interface EvaluateConsentGateInput {
  /** Pipeline mode resolved once per request from site config (default SHADOW — INV-B-03). */
  mode: SitePipelineMode
  /** Resolved jurisdiction row; absent rows behave as opt-in (safest default). */
  row?: Pick<JurisdictionConsentRow, 'mechanism' | 'gpc_honor'> | null
  /** Decision from a VERIFIED token, or null (no cookie / invalid / expired token). */
  tokenDecision: ConsentDecision | null
  /** Raw GPC signal from the request (`Sec-GPC: 1`). */
  gpcSignal: boolean
}

/**
 * Pure consent-gate semantics (P2.3):
 * - GPC is honored per row (`gpc_honor`) and acts as an opt-out signal:
 *   it downgrades any effective decision to `declined` — including "no token yet".
 * - `opt-in` mechanism allows destinations only on an affirmative `granted`.
 * - `opt-out` mechanism allows destinations absent a declined/withdrawn decision.
 * - SHADOW mode never blocks; the would-be ENFORCEMENT decision is preserved
 *   in `wouldAllow` so it can be recorded (analytics honesty).
 */
export function evaluateConsentGate(input: EvaluateConsentGateInput): ConsentGateResult {
  const mechanism = input.row?.mechanism ?? 'opt-in'
  const gpcApplied = input.gpcSignal && (input.row?.gpc_honor ?? false)
  const effectiveDecision: ConsentDecision | null = gpcApplied ? 'declined' : input.tokenDecision
  const wouldAllow =
    mechanism === 'opt-in'
      ? effectiveDecision === 'granted'
      : effectiveDecision !== 'declined' && effectiveDecision !== 'withdrawn'
  return {
    mode: input.mode,
    mechanism,
    tokenDecision: input.tokenDecision,
    effectiveDecision,
    gpcApplied,
    wouldAllow,
    allowDestinations: input.mode === 'SHADOW' ? true : wouldAllow
  }
}

/**
 * Single check destination strategies use before firing (P2.3).
 * Falls back to strict opt-in semantics when the consent gate has not run
 * (e.g. a custom pipeline without the mandatory consent strategy).
 */
export function destinationsAllowed(
  ctx: Pick<StrategyPipelineContext, 'consentGate' | 'consent'>
): boolean {
  if (ctx.consentGate) return ctx.consentGate.allowDestinations
  return ctx.consent?.payload.decision === 'granted'
}
