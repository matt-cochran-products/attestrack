import type { ConsentDecision } from './consent.js'
import type { SitePipelineMode } from './consent-gate.js'
import type { ConsentMechanism } from './jurisdiction.js'

/** Default TTL for consent-event KV records (operator-configurable via site config). */
export const DEFAULT_CONSENT_EVENT_TTL_SECONDS = 60 * 60 * 24 * 90

/**
 * Flat operational consent record written by the mandatory consent-log strategy (`evidence-unsigned` id).
 * Self-attested only in the public core — not the Proof / witnessed canonical document (token standard v9.2).
 */
export interface ConsentEventRecordV1 {
  v: 1
  /** ISO 8601 when the record was written */
  recordedAt: string
  siteId: string
  decision: ConsentDecision
  /** Resolved jurisdiction key after `jurisdiction` / premium replacement strategy */
  jurisdictionKey: string
  policyHash: string
  /**
   * True ONLY when the verified token carries affirmatively accepted IOA
   * assertion ids (`payload.ioa`) — never inferred from mere token presence.
   */
  ioaAttested: boolean
  gpcSignalHonored: boolean
  /** Consent mechanism of the resolved jurisdiction row when the gate ran (P2.5). */
  mechanism?: ConsentMechanism
  /** Site pipeline mode in force when the record was written (P2.5). */
  mode?: SitePipelineMode
  /** Optional hash or version label of the active ConsentConfig row for auditability */
  configFingerprint?: string
}
