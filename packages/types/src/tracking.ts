import type { ConsentDecision } from './consent.js'

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
}
