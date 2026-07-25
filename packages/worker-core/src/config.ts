import type { HostRuntime } from '@attestrack/host-contracts'
import { KV_KEY_PORTAL_SITE_CONFIG } from '@attestrack/types'

/**
 * Operational mode for the consent pipeline (INV-B-03: new deployments start in SHADOW).
 * SHADOW: destinations run; the would-be enforcement decision is recorded for analytics honesty.
 * ENFORCEMENT: the consent gate actually blocks destinations.
 */
export type SiteMode = 'SHADOW' | 'ENFORCEMENT' | 'NOT_CONFIGURED'

/** Site configuration JSON stored at {@link KV_KEY_PORTAL_SITE_CONFIG}. */
export interface SiteConfigKv {
  siteId: string
  domain: string
  workerVersion: string
  shadowStart: string
  enforcementStart: string | null
  mode: SiteMode
  consentConfigured: boolean
  /** Consent token TTL in seconds (mint-time `expiresAt` + cookie Max-Age). */
  state1TokenTTL: number
  ipHandling: string
  trustedDomains: string[]
  driftDetection: { enabled: boolean; quarantineNew: boolean; alertThreshold: number }
  /**
   * Cookie `Domain` attribute for the `at_consent` cookie (cross-subdomain topology:
   * page on `www.`, worker on `t.`). Defaults to `domain` when unset.
   */
  cookieDomain?: string
  /** TTL for consent-event KV records in seconds (default 90 days). */
  consentEventTtlSeconds?: number
}

export const DEFAULT_CONSENT_EVENT_TTL_SECONDS = 60 * 60 * 24 * 90

export const defaultSiteConfig: SiteConfigKv = {
  siteId: 'local',
  domain: 'example.com',
  workerVersion: '0.0.0',
  shadowStart: new Date().toISOString(),
  enforcementStart: null,
  mode: 'SHADOW',
  consentConfigured: true,
  state1TokenTTL: 86400,
  ipHandling: 'hash_salt',
  trustedDomains: [],
  driftDetection: { enabled: true, quarantineNew: false, alertThreshold: 0.05 }
}

/**
 * Read the operator site configuration from KV (defaults preserved for missing fields).
 * Call once per request and pass the result down — mode/CORS/cookie decisions must
 * all observe the same snapshot.
 */
export async function readSiteConfig(host: HostRuntime): Promise<SiteConfigKv> {
  const raw = await host.kv.get(KV_KEY_PORTAL_SITE_CONFIG)
  if (!raw) return defaultSiteConfig
  try {
    const v = JSON.parse(raw) as Partial<SiteConfigKv>
    return { ...defaultSiteConfig, ...v }
  } catch {
    return defaultSiteConfig
  }
}

export async function writeSiteConfig(host: HostRuntime, config: SiteConfigKv): Promise<void> {
  await host.kv.put(KV_KEY_PORTAL_SITE_CONFIG, JSON.stringify(config))
}

/** Pipeline mode from config; anything but explicit ENFORCEMENT behaves as SHADOW (INV-B-03). */
export function effectiveSiteMode(config: Pick<SiteConfigKv, 'mode'>): 'SHADOW' | 'ENFORCEMENT' {
  return config.mode === 'ENFORCEMENT' ? 'ENFORCEMENT' : 'SHADOW'
}
