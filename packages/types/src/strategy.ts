import type { ConsentDecision } from './consent.js'

export type StrategyStage = 'mandatory' | 'destination' | 'analytics'

/** Declarative metadata for bundled or dynamically loaded strategies. */
export interface StrategyManifest {
  id: string
  stage: StrategyStage
  displayName: string
  /** When false, operator must explicitly enable (ad networks, analytics). */
  defaultEnabled?: boolean
  /**
   * Community strategy ids this artifact supersedes when injected by CDNLoader.
   * Example: premium `JurisdictionCompleteStrategy` sets `replaces: ['jurisdiction']`
   * so the bundled **JurisdictionStrategy** is omitted; KV schema and Worker stay the same.
   */
  replaces?: readonly string[]
}

/** Request body for minting a community consent token (browser → worker). */
export interface ConsentCommitRequest {
  siteId: string
  decision: ConsentDecision
  policyHash: string
  jurisdictionHint?: string
  /** Ids of IOA assertions the visitor affirmatively accepted (checkbox flow). */
  ioaAccepted?: readonly string[]
}
