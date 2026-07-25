import type { ConsentDecision } from './consent.js'
import type { SitePipelineMode } from './consent-gate.js'
import type { ConsentMechanism } from './jurisdiction.js'

/**
 * Canonical first-party tracking event shape (worker → warehouse).
 * Fields are intentionally minimal for the contract spine; expand per ClickHouse/Tinybird specs later.
 */
export interface TrackingEventV1 {
  v: 1
  eventName: string
  siteId: string
  occurredAt: string
  consentDecision?: ConsentDecision
  jurisdiction?: string | null
  /**
   * Consent-gate honesty fields (P2.3), stamped server-side by the mandatory
   * consent strategy: the mode/mechanism in force and the decision ENFORCEMENT
   * would have made — so SHADOW-mode analytics can report the would-be enforced
   * rate (DASH.3) instead of inventing numbers.
   */
  consentMode?: SitePipelineMode
  consentMechanism?: ConsentMechanism
  consentWouldAllow?: boolean
}
