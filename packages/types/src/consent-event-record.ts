import type { ConsentDecision } from './consent.js'

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
  ioaAttested: boolean
  gpcSignalHonored: boolean
  /** Optional hash or version label of the active ConsentConfig row for auditability */
  configFingerprint?: string
}
