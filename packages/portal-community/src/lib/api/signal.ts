import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import type { SignalRecoveryMetrics } from './types';

async function stubGetSignalRecovery(): Promise<SignalRecoveryMetrics> {
  await stubDelay();
  return {
    eventsFromBlockers: 34291,
    blockersPct: 18,
    eventsFromITP: 12847,
    itpPct: 9,
    cookieIdsPreserved: 28103,
    botRequestsFiltered: 4291,
  };
}

export async function getSignalRecovery(): Promise<SignalRecoveryMetrics> {
  if (isLiveApi()) {
    return apiGet<SignalRecoveryMetrics>('/api/portal/signal-recovery');
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
    return apiGet<RecoveryTimelinePoint[]>(`/api/portal/signal-recovery/timeline?days=${days}`);
  }
  await stubDelay();
  return [
    { date: 'Mar 18', serverSide: 4102, browserEstimate: 3472 },
    { date: 'Mar 19', serverSide: 4847, browserEstimate: 4103 },
    { date: 'Mar 20', serverSide: 3991, browserEstimate: 3381 },
    { date: 'Mar 21', serverSide: 5203, browserEstimate: 4402 },
    { date: 'Mar 22', serverSide: 4918, browserEstimate: 4161 },
    { date: 'Mar 23', serverSide: 4441, browserEstimate: 3761 },
    { date: 'Mar 24', serverSide: 4847, browserEstimate: 4103 },
  ];
}
