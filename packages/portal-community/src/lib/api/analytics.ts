import { apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';

/** Curated analytics chart payload (Worker + ClickHouse proxy). */
export interface AnalyticsChartSeries {
  id: string;
  title: string;
  points: { label: string; value: number }[];
}

async function stubCuratedCharts(): Promise<AnalyticsChartSeries[]> {
  await stubDelay();
  return [
    {
      id: 'blockers',
      title: 'Events recovered from ad blockers (7d)',
      points: [
        { label: 'Mar 18', value: 4102 },
        { label: 'Mar 19', value: 4847 },
        { label: 'Mar 20', value: 3991 },
        { label: 'Mar 21', value: 5203 },
        { label: 'Mar 22', value: 4918 },
        { label: 'Mar 23', value: 4441 },
        { label: 'Mar 24', value: 4847 },
      ],
    },
    {
      id: 'itp',
      title: 'Events recovered from ITP / restrictions (7d)',
      points: [
        { label: 'Mar 18', value: 1201 },
        { label: 'Mar 19', value: 1340 },
        { label: 'Mar 20', value: 1188 },
        { label: 'Mar 21', value: 1422 },
        { label: 'Mar 22', value: 1310 },
        { label: 'Mar 23', value: 1288 },
        { label: 'Mar 24', value: 1355 },
      ],
    },
  ];
}

export async function getCuratedAnalyticsCharts(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<AnalyticsChartSeries[]> {
  if (isLiveApi()) {
    return apiPost<AnalyticsChartSeries[]>(`${PORTAL_WORKER_PREFIX}/analytics/curated`, params);
  }
  return stubCuratedCharts();
}

export interface WarehouseStatus {
  configured: boolean;
  message: string;
}

export async function getAnalyticsWarehouseStatus(): Promise<WarehouseStatus> {
  if (isLiveApi()) {
    return apiPost<WarehouseStatus>(`${PORTAL_WORKER_PREFIX}/analytics/warehouse-status`, {});
  }
  await stubDelay();
  return {
    configured: true,
    message: 'Stub: ClickHouse connection assumed. Set VITE_ATTESTRACK_API_BASE_URL for live status.',
  };
}
