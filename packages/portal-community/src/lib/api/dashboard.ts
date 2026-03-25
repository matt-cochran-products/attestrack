import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { DashboardMetrics } from './types';

async function stubDashboardMetrics(): Promise<DashboardMetrics> {
  await stubDelay();
  return {
    eventsToday: 4847,
    driftAlertCount: 1,
    strategyStatus: 'degraded',
    strategySummary: 'TikTok Events API degraded',
    shadowModeLabel: 'Validation — volume and destination health (enforcement is Attestrue)',
  };
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (isLiveApi()) {
    return apiGet<DashboardMetrics>(`${PORTAL_WORKER_PREFIX}/dashboard`);
  }
  return stubDashboardMetrics();
}
