import type { Strategy } from '@attestrue/sdk'
import { createClickHouseStrategy } from './analytics/clickhouse.js'
import { createOtelStrategy } from './analytics/otel.js'
import { createTinybirdStrategy } from './analytics/tinybird.js'
import { createGoogleMpStrategy } from './ad-networks/google.js'
import { createMetaCapiStrategy } from './ad-networks/meta.js'
import { createMicrosoftUetStrategy } from './ad-networks/microsoft.js'
import { createTikTokEventsStrategy } from './ad-networks/tiktok.js'
import { createDriftDetectionStrategy } from './drift/detection.js'
import { defaultCommunityStrategies } from './mandatory/consent.js'

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

export { createMetaCapiStrategy } from './ad-networks/meta.js'
export { createGoogleMpStrategy } from './ad-networks/google.js'
export { createTikTokEventsStrategy } from './ad-networks/tiktok.js'
export { createMicrosoftUetStrategy } from './ad-networks/microsoft.js'
export { createClickHouseStrategy } from './analytics/clickhouse.js'
export { createOtelStrategy } from './analytics/otel.js'
export { createTinybirdStrategy } from './analytics/tinybird.js'
export { createDriftDetectionStrategy } from './drift/detection.js'

/** Mandatory + optional destination/analytics strategies for a full Attestrack worker bundle. */
export function allBundledStrategies(consentSecretEnvName = 'CONSENT_TOKEN_SECRET'): Strategy[] {
  return [
    ...defaultCommunityStrategies(consentSecretEnvName),
    createMetaCapiStrategy(),
    createGoogleMpStrategy(),
    createTikTokEventsStrategy(),
    createMicrosoftUetStrategy(),
    createClickHouseStrategy(),
    createOtelStrategy(),
    createTinybirdStrategy(),
    createDriftDetectionStrategy()
  ]
}

/** Suggested Stage-1 order for bundled community mandatory strategies. */
export const communityMandatoryStage1Order: readonly string[] = [
  'jurisdiction',
  'consent',
  'evidence-unsigned',
  'troll-shield'
]
