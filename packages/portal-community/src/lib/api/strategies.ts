import { apiGet, apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import type { StrategiesResponse } from './types';

async function stubListStrategies(): Promise<StrategiesResponse> {
  await stubDelay();
  return {
    builtin: [
      { id: 'meta', name: 'Meta CAPI', status: 'active', eventsToday: 4291 },
      { id: 'google', name: 'Google Measurement Protocol', status: 'active', eventsToday: 4847 },
      { id: 'tiktok', name: 'TikTok Events API', status: 'degraded', eventsToday: 2018 },
      { id: 'microsoft', name: 'Microsoft UET', status: 'active', eventsToday: 1841 },
      { id: 'clickhouse', name: 'ClickHouse', status: 'active', eventsToday: 4903 },
      { id: 'tinybird', name: 'Tinybird', status: 'inactive', eventsToday: 0 },
      { id: 'tcf', name: 'TCF Consent String', status: 'active', eventsToday: null },
      { id: 'trollshield', name: 'TrollShield (local)', status: 'active', eventsToday: 4291 },
      { id: 'drift', name: 'Drift Detection', status: 'active', eventsToday: null },
    ],
    proofLayer: [
      { id: 'evidence', name: 'Evidence (Signed)', locked: true, description: 'Independent signed records' },
      { id: 'trollshield-premium', name: 'TrollShield Premium', locked: true, description: 'Cross-customer pattern matching' },
      { id: 'attribution', name: 'Attribution Engine', locked: true, description: 'Cross-network attribution' },
      { id: 'banner-intelligence', name: 'Banner Intelligence', locked: true, description: 'Network consent benchmarks' },
    ],
  };
}

export async function listStrategies(): Promise<StrategiesResponse> {
  if (isLiveApi()) {
    return apiGet<StrategiesResponse>('/api/portal/strategies');
  }
  return stubListStrategies();
}

export async function toggleStrategy(id: string, enabled: boolean): Promise<{ success: boolean }> {
  if (isLiveApi()) {
    return apiPost<{ success: boolean }>('/api/portal/strategies/toggle', { id, enabled });
  }
  await stubDelay();
  return { success: true };
}
