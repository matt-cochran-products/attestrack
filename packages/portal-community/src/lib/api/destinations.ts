import { apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import type { AlertRule, DestinationRow } from './types';

async function stubListDestinations(): Promise<DestinationRow[]> {
  await stubDelay();
  return [
    { id: 'meta', name: 'Meta CAPI', status: 'healthy', successRate: 98.2, lastEvent: '2 min ago', auth: 'valid', eventsToday: 4291 },
    { id: 'google', name: 'Google GA4+Ads', status: 'healthy', successRate: 99.1, lastEvent: '2 min ago', auth: 'valid', eventsToday: 4847 },
    { id: 'tiktok', name: 'TikTok Events API', status: 'degraded', successRate: 82.1, lastEvent: '14 min ago', auth: 'valid', eventsToday: 2018 },
    { id: 'microsoft', name: 'Microsoft UET', status: 'healthy', successRate: 98.8, lastEvent: '3 min ago', auth: 'valid', eventsToday: 1841 },
    { id: 'clickhouse', name: 'ClickHouse', status: 'healthy', successRate: 100, lastEvent: '2 min ago', auth: 'valid', eventsToday: 4903 },
    { id: 'tinybird', name: 'Tinybird', status: 'inactive', successRate: 0, lastEvent: null, auth: 'not configured', eventsToday: 0 },
  ];
}

async function stubGetAlertRules(): Promise<AlertRule[]> {
  await stubDelay();
  return [
    { destination: 'Meta CAPI', condition: 'Success rate < 95%', email: 'alex@meridiancommerce.com', active: true },
    { destination: 'TikTok', condition: 'No events in 2 hours', email: 'alex@meridiancommerce.com', active: true },
  ];
}

export async function listDestinations(): Promise<DestinationRow[]> {
  if (isLiveApi()) {
    return apiGet<DestinationRow[]>('/api/portal/destinations');
  }
  return stubListDestinations();
}

export async function getAlertRules(): Promise<AlertRule[]> {
  if (isLiveApi()) {
    return apiGet<AlertRule[]>('/api/portal/destinations/alert-rules');
  }
  return stubGetAlertRules();
}
