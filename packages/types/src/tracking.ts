import type { ConsentDecision } from './consent.js'
import type { SitePipelineMode } from './consent-gate.js'
import type { ConsentMechanism } from './jurisdiction.js'

/** Coarse user-agent bucket — never the raw UA string (first-party/privacy). */
export type UserAgentClass = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'other'

/**
 * Canonical first-party tracking event shape (worker → warehouse). Kept in lockstep
 * with `@attestrack/schema`'s `trackingEventV1Schema` (the runtime validator) and the
 * `events` warehouse table (`@attestrack/schema` `warehouse/clickhouse.sql`). All
 * fields beyond the core spine are OPTIONAL so v1 clients stay valid; the schema
 * strips anything not listed, keeping the warehouse shape a closed contract.
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

  // Behavioral / semantic signals
  sessionId?: string
  pagePath?: string
  ctaType?: string
  scrollDepthPct?: number
  section?: string
  dwellMs?: number
  webVitalName?: string
  webVitalValue?: number
  params?: string

  // Analytics / attribution / identity (first-party only)
  visitorId?: string
  eventId?: string
  referrer?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  userAgentClass?: UserAgentClass
}
