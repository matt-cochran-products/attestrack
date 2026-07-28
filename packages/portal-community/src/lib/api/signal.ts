import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { SignalRecoveryMetrics } from './types';

async function stubGetSignalRecovery(): Promise<SignalRecoveryMetrics> {
  await stubDelay();
  // Mirrors the live Worker's P3.3 de-scope: recovery is not measured in v1.
  return {
    measured: false,
    reason: 'requires_beacon',
    message:
      'Signal-recovery comparison (server-side events vs browser-blocked estimate) requires a client beacon that Attestrack v1 does not ship. No recovery numbers are reported rather than estimated ones.',
    botRequestsFiltered: 4291,
  };
}

export async function getSignalRecovery(): Promise<SignalRecoveryMetrics> {
  if (isLiveApi()) {
    return apiGet<SignalRecoveryMetrics>(`${PORTAL_WORKER_PREFIX}/signal-recovery`);
  }
  return stubGetSignalRecovery();
}

export interface RecoveryTimelinePoint {
  date: string;
  serverSide: number;
  browserEstimate: number;
}

export async function getRecoveryTimeline(days: 7 | 30 | 90): Promise<RecoveryTimelinePoint[]> {
  if (isLiveApi()) {
    return apiGet<RecoveryTimelinePoint[]>(`${PORTAL_WORKER_PREFIX}/signal-recovery/timeline?days=${days}`);
  }
  await stubDelay();
  // De-scoped with signal recovery (P3.3): the browser-estimate series would be
  // invented without a client beacon, so the stub matches the live Worker: [].
  return [];
}
