import { createHash } from 'node:crypto'
import {
  COMMUNITY_DEFAULT_CONSENT_CONFIG,
  KV_KEY_CONSENT_CONFIG,
  KV_KEY_DRIFT_EXPECTED,
  KV_KEY_ENABLED_STRATEGIES,
  KV_KEY_POLICY_PRIVACY,
  KV_KEY_POLICY_TERMS,
  KV_KEY_PORTAL_SITE_CONFIG
} from '@attestrack/types'

/** Default optional strategies: analytics + drift only; ad destinations off until secrets exist. */
export const defaultEnabledStrategyIds = ['clickhouse', 'tinybird', 'drift-detection'] as const

/** Initial KV entries suggested for a new Attestrack deployment. */
export function initialKvSeed(siteId: string, domain: string): Record<string, string> {
  const siteConfig = {
    siteId,
    domain,
    workerVersion: '0.0.0',
    shadowStart: new Date().toISOString(),
    enforcementStart: null,
    mode: 'SHADOW' as const,
    consentConfigured: true,
    state1TokenTTL: 86400,
    ipHandling: 'hash_salt',
    trustedDomains: [] as string[],
    driftDetection: { enabled: true, quarantineNew: false, alertThreshold: 0.05 },
    // P2: consent cookie Domain (cross-subdomain topology) + consent-event record TTL.
    cookieDomain: domain,
    consentEventTtlSeconds: 60 * 60 * 24 * 90
  }
  const consentConfigJson = JSON.stringify(COMMUNITY_DEFAULT_CONSENT_CONFIG)
  return {
    [KV_KEY_PORTAL_SITE_CONFIG]: JSON.stringify(siteConfig),
    [KV_KEY_CONSENT_CONFIG]: consentConfigJson,
    [KV_KEY_ENABLED_STRATEGIES]: JSON.stringify([...defaultEnabledStrategyIds]),
    [KV_KEY_POLICY_PRIVACY]: 'Privacy policy — replace via KV or portal.\n',
    [KV_KEY_POLICY_TERMS]: 'Terms of use — replace via KV or portal.\n',
    // P3.5: drift detection baseline — SHA-256 of the consent-config JSON
    // exactly as seeded, matching the drift-detection strategy's hash of the
    // raw KV value. Without this key drift could never be evaluated.
    [KV_KEY_DRIFT_EXPECTED]: sha256Hex(consentConfigJson)
  }
}

/** SHA-256 hex — identical to the Worker-side drift-detection hashing of the raw KV string. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
