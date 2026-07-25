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
  // P3.3 ANA copy amendment: no "recovered" claims — recovery is not measured
  // in v1 (requires a client beacon). Stub charts show plainly-labeled sample
  // volumes only; live mode reads operator-curated series from the Worker.
  return [
    {
      id: 'events-volume',
      title: 'Events ingested (7d) — sample data',
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
      id: 'bots-filtered',
      title: 'Bot requests filtered (7d) — sample data',
      points: [
        { label: 'Mar 18', value: 201 },
        { label: 'Mar 19', value: 340 },
        { label: 'Mar 20', value: 188 },
        { label: 'Mar 21', value: 422 },
        { label: 'Mar 22', value: 310 },
        { label: 'Mar 23', value: 288 },
        { label: 'Mar 24', value: 355 },
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
