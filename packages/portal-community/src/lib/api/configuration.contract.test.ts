import { afterEach, describe, expect, it, vi } from 'vitest';
import { PORTAL_WORKER_PREFIX } from './constants';

describe('configuration live API paths', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('getSiteConfig GETs PORTAL_WORKER_PREFIX site-config', async () => {
    vi.stubEnv('VITE_ATTESTRACK_API_BASE_URL', 'https://w.example.com');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          siteId: 'x',
          domain: 'd',
          workerVersion: '1',
          shadowStart: 't',
          enforcementStart: null,
          mode: 'SHADOW',
          consentConfigured: false,
          state1TokenTTL: 1,
          ipHandling: 'x',
          trustedDomains: [],
          driftDetection: { enabled: false, quarantineNew: false, alertThreshold: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const { getSiteConfig } = await import('./configuration');
    const cfg = await getSiteConfig();
    expect(cfg.siteId).toBe('x');
    expect(fetchMock).toHaveBeenCalledWith(
      `https://w.example.com${PORTAL_WORKER_PREFIX}/site-config`,
      expect.anything()
    );
  });
});
