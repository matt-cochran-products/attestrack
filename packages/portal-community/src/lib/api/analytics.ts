import type { CuratedChartId } from '@attestrack/types';
import { apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { CuratedChart } from './types';

/**
 * P4.3 curated analytics client. Live mode: one POST per chart (ANA.6 — charts
 * load independently) against `/analytics/curated`; the Worker computes each
 * chart from canned SQL through the gated Explore proxy or from recorded
 * delivery stats — never operator-seeded series.
 *
 * Stub mode (no `VITE_ATTESTRACK_API_BASE_URL`): plainly-labeled sample data
 * only — every title carries a "sample data" suffix and the shell shows the
 * "Local stub data" source chip (REPO-SPEC stub-vs-live visibility).
 */

const STUB_SUFFIX = ' — sample data';

const stubCharts: Record<CuratedChartId, CuratedChart> = {
  'events-volume': {
    id: 'events-volume',
    title: `Events ingested per day${STUB_SUFFIX}`,
    description: 'Stub series for layout preview. Live mode computes this from your warehouse.',
    unit: 'count',
    source: 'warehouse',
    state: 'ok',
    series: [
      {
        name: 'Events',
        points: [
          { label: '2026-03-18', value: 4102 },
          { label: '2026-03-19', value: 4847 },
          { label: '2026-03-20', value: 3991 },
          { label: '2026-03-21', value: 5203 },
          { label: '2026-03-22', value: 4918 },
          { label: '2026-03-23', value: 4441 },
          { label: '2026-03-24', value: 4847 },
        ],
      },
    ],
  },
  'consent-rate-by-jurisdiction': {
    id: 'consent-rate-by-jurisdiction',
    title: `Consent rate by jurisdiction${STUB_SUFFIX}`,
    description: 'Stub series for layout preview. Live mode computes this from recorded decisions.',
    unit: 'percent',
    source: 'warehouse',
    state: 'ok',
    series: [
      {
        name: 'EU',
        points: [
          { label: '2026-03-22', value: 64.1 },
          { label: '2026-03-23', value: 61.8 },
          { label: '2026-03-24', value: 66.4 },
        ],
      },
      {
        name: 'US-CA',
        points: [
          { label: '2026-03-22', value: 88.9 },
          { label: '2026-03-23', value: 91.2 },
          { label: '2026-03-24', value: 90.4 },
        ],
      },
    ],
  },
  'destination-success-rate': {
    id: 'destination-success-rate',
    title: `Destination success rate${STUB_SUFFIX}`,
    description: 'Stub series for layout preview. Live mode reads recorded delivery outcomes.',
    unit: 'percent',
    source: 'delivery_stats',
    state: 'ok',
    series: [
      {
        name: 'Success rate',
        points: [
          { label: 'ClickHouse HTTP sink', value: 99.2 },
          { label: 'Meta Conversions API', value: 97.5 },
        ],
      },
    ],
  },
  'bot-share': {
    id: 'bot-share',
    title: `Bot share of ingested events${STUB_SUFFIX}`,
    description: 'Stub series for layout preview. Live mode computes this from bot-labeled rows.',
    unit: 'percent',
    source: 'warehouse',
    state: 'ok',
    series: [
      {
        name: 'Bot share',
        points: [
          { label: '2026-03-22', value: 6.3 },
          { label: '2026-03-23', value: 6.5 },
          { label: '2026-03-24', value: 7.3 },
        ],
      },
    ],
  },
};

export async function getCuratedChart(
  chartId: CuratedChartId,
  params: { dateFrom: string; dateTo: string },
): Promise<CuratedChart> {
  if (isLiveApi()) {
    return apiPost<CuratedChart>(`${PORTAL_WORKER_PREFIX}/analytics/curated`, {
      chartId,
      ...params,
    });
  }
  await stubDelay();
  return stubCharts[chartId];
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
