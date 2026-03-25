import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import type { RequestLogRow } from './types';

async function stubIncomingLogs(): Promise<RequestLogRow[]> {
  await stubDelay();
  return [
    { timestamp: '2026-03-24T14:22:07Z', event: 'purchase', source: 'browser', jurisdiction: 'US-CA', consent: 'GRANTED', processingTime: 142, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:21:54Z', event: 'page_view', source: 'browser', jurisdiction: 'US-CA', consent: 'GRANTED', processingTime: 38, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:21:49Z', event: 'add_to_cart', source: 'browser', jurisdiction: 'EU', consent: 'GRANTED', processingTime: 91, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:21:33Z', event: 'page_view', source: 'browser', jurisdiction: 'US-CA', consent: 'DENIED', processingTime: 31, status: 'BLOCKED_PRE_CONSENT' },
    { timestamp: '2026-03-24T14:21:18Z', event: 'page_view', source: 'browser', jurisdiction: 'US-VA', consent: 'GRANTED', processingTime: 44, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:20:55Z', event: 'page_view', source: 'browser', jurisdiction: 'US-CA', consent: 'GPC_DENIED', processingTime: 29, status: 'BLOCKED_GPC' },
    { timestamp: '2026-03-24T14:20:41Z', event: 'checkout', source: 'browser', jurisdiction: 'US-CA', consent: 'GRANTED', processingTime: 118, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:20:28Z', event: 'page_view', source: 'browser', jurisdiction: 'US-CA', consent: 'SHADOW', processingTime: 35, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:20:14Z', event: 'purchase', source: 'browser', jurisdiction: 'EU', consent: 'GRANTED', processingTime: 156, status: 'PROCESSED' },
    { timestamp: '2026-03-24T14:19:58Z', event: 'page_view', source: 'browser', jurisdiction: 'US-CA', consent: 'GRANTED', processingTime: 41, status: 'PROCESSED' },
  ];
}

export async function getIncomingLogs(): Promise<RequestLogRow[]> {
  if (isLiveApi()) {
    return apiGet<RequestLogRow[]>('/api/portal/logs/incoming');
  }
  return stubIncomingLogs();
}
