export {
  CONSENT_COOKIE_NAME,
  communityConsentStrategyManifest,
  createConsentCookieStrategy,
  defaultCommunityStrategies,
  verifyCommunityConsentToken
} from './mandatory/consent.js'
export {
  communityJurisdictionStrategy,
  communityJurisdictionStrategyManifest
} from './mandatory/jurisdiction.js'
export {
  evidenceUnsignedStrategy,
  evidenceUnsignedStrategyManifest
} from './mandatory/consent-log.js'
export {
  communityTrollShieldStrategy,
  communityTrollShieldStrategyManifest
} from './mandatory/troll-shield.js'

/** Suggested Stage-1 order for bundled community mandatory strategies. */
export const communityMandatoryStage1Order: readonly string[] = [
  'jurisdiction',
  'consent',
  'evidence-unsigned',
  'troll-shield'
]
