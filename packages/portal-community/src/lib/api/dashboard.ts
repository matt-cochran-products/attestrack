import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import type { DashboardMetrics } from './types';

async function stubDashboardMetrics(): Promise<DashboardMetrics> {
  await stubDelay();
  return {
    eventsToday: 4847,
    driftAlertCount: 1,
    strategyStatus: 'degraded',
    strategySummary: 'TikTok Events API degraded',
    shadowModeLabel: 'Shadow mode — displayed rate is what would be enforced',
  };
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (isLiveApi()) {
    return apiGet<DashboardMetrics>('/api/portal/dashboard');
  }
  return stubDashboardMetrics();
}
