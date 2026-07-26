import type { ConsentDecision } from './consent.js'
import type { ConsentMechanism } from './jurisdiction.js'

/**
 * Pipeline-effective site mode (P2.3). `NOT_CONFIGURED` and anything unknown
 * collapse to SHADOW — INV-B-03: new deployments always start in shadow mode.
 */
export type SitePipelineMode = 'SHADOW' | 'ENFORCEMENT'

/**
 * Minimal site configuration snapshot the Worker resolves ONCE per request and
 * hands to the strategy pipeline (mode gating, consent-event TTL).
 */
export interface PipelineSiteInfo {
  mode: SitePipelineMode
  siteId?: string
  domain?: string
  /** TTL for consent-event KV records in seconds (operator-configurable). */
  consentEventTtlSeconds?: number
}

/**
 * Outcome of the consent gate for one request — the single source of truth
 * destinations consult. Computed by the mandatory consent strategy from
 * {mode, jurisdiction row mechanism, GPC, verified token}.
 *
 * Semantics:
 * - `opt-in` mechanism: destinations require an affirmative `granted` decision.
 * - `opt-out` mechanism: destinations are allowed unless a declined or withdrawn
 *   decision (or an honored GPC signal) exists.
 * - SHADOW mode: destinations always run; `wouldAllow` records the decision
 *   ENFORCEMENT would have made (recorded for analytics honesty, DASH.3).
 * - ENFORCEMENT mode: `allowDestinations === wouldAllow`.
 */
export interface ConsentGateResult {
  mode: SitePipelineMode
  mechanism: ConsentMechanism
  /** Decision carried by the verified token (null: no/invalid token). */
  tokenDecision: ConsentDecision | null
  /** Decision after honoring GPC per-row (`gpc_honor`). */
  effectiveDecision: ConsentDecision | null
  /** True when GPC was present AND the resolved row honors it. */
  gpcApplied: boolean
  /** The decision ENFORCEMENT would make (recorded even in SHADOW). */
  wouldAllow: boolean
  /** The actual gate outcome for this request given `mode`. */
  allowDestinations: boolean
}
