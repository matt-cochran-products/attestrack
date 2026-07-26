import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { DashboardMetrics } from './types';

async function stubDashboardMetrics(): Promise<DashboardMetrics> {
  await stubDelay();
  return {
    eventsToday: 4847,
    driftAlertCount: 1,
    driftAlert: {
      at: '2026-03-22T09:14:00.000Z',
      expected: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      current: 'e5f6a7b8c9d0112233445566778899aabbccddeeff00112233445566778899aa',
    },
    strategyStatus: 'degraded',
    strategySummary: 'TikTok Events API reporting delivery errors',
    shadowModeLabel: 'Shadow — destinations run; the enforcement decision is recorded only',
  };
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (isLiveApi()) {
    return apiGet<DashboardMetrics>(`${PORTAL_WORKER_PREFIX}/dashboard`);
  }
  return stubDashboardMetrics();
}
