import { apiGet, apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { SiteConfig } from './types';

async function stubGetSiteConfig(): Promise<SiteConfig> {
  await stubDelay();
  return {
    siteId: 'dep_m4x9k2',
    domain: 'meridiancommerce.com',
    workerVersion: 'attestrack-v1.4.2',
    shadowStart: '2025-09-12',
    enforcementStart: '2025-10-01',
    mode: 'SHADOW',
    consentConfigured: true,
    state1TokenTTL: 30,
    ipHandling: 'drop',
    trustedDomains: ['graph.facebook.com', 'www.googleadservices.com', 'business-api.tiktok.com'],
    driftDetection: {
      enabled: true,
      quarantineNew: true,
      alertThreshold: 100,
    },
  };
}

export async function getSiteConfig(): Promise<SiteConfig> {
  if (isLiveApi()) {
    return apiGet<SiteConfig>(`${PORTAL_WORKER_PREFIX}/site-config`);
  }
  return stubGetSiteConfig();
}

export async function updateTrustedDomains(domains: string[]): Promise<{ success: boolean }> {
  if (isLiveApi()) {
    return apiPost<{ success: boolean }>(`${PORTAL_WORKER_PREFIX}/site-config/trusted-domains`, { domains });
  }
  await stubDelay();
  return { success: true };
}
