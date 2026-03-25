import { apiGet, apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { BannerConfigState } from './types';

async function stubGetBannerConfig(): Promise<BannerConfigState> {
  await stubDelay();
  return {
    configured: false,
    status: 'NOT_CONFIGURED',
    jurisdictions: [],
  };
}

export async function getBannerConfig(): Promise<BannerConfigState> {
  if (isLiveApi()) {
    return apiGet<BannerConfigState>(`${PORTAL_WORKER_PREFIX}/banner`);
  }
  return stubGetBannerConfig();
}

export async function updateBannerConfig(config: Record<string, unknown>): Promise<{ success: boolean }> {
  if (isLiveApi()) {
    return apiPost<{ success: boolean }>(`${PORTAL_WORKER_PREFIX}/banner`, config);
  }
  await stubDelay();
  return { success: true };
}

export async function getBannerHistory(): Promise<unknown[]> {
  if (isLiveApi()) {
    return apiGet<unknown[]>(`${PORTAL_WORKER_PREFIX}/banner/history`);
  }
  await stubDelay();
  return [];
}
