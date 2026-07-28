import { describe, expect, it } from 'vitest';
import { ATTESTRACK_EXPLORE_CHART_TYPES } from '@attestrack/types';
import { buildExploreChartOption } from './echarts-option';

const columns = ['day', 'jurisdiction', 'count'];
const rows = [
  { day: '2026-07-24', jurisdiction: 'EU', count: '10' },
  { day: '2026-07-25', jurisdiction: 'EU', count: 20 },
  { day: '2026-07-25', jurisdiction: 'US-CA', count: 5 },
];

describe('buildExploreChartOption (EXP.8 — user-directed visualisation)', () => {
  it('covers exactly the spec chart-type list', () => {
    expect([...ATTESTRACK_EXPLORE_CHART_TYPES]).toEqual([
      'table',
      'line',
      'bar',
      'area',
      'scatter',
      'pie',
      'heatmap',
    ]);
  });

  it('never builds for table — the default stays the results table', () => {
    const r = buildExploreChartOption(columns, rows, { chartType: 'table' });
    expect(r.ok).toBe(false);
  });

  it.each(['line', 'bar', 'area', 'scatter'] as const)(
    'builds a cartesian %s option with coerced numeric values',
    (chartType) => {
      const r = buildExploreChartOption(columns, rows, {
        chartType,
        xColumn: 'day',
        yColumn: 'count',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const series = (r.option.series as Record<string, unknown>[])[0] as {
        type: string;
        data: (number | null)[];
      };
      expect(series.data).toEqual([10, 20, 5]);
      expect(series.type).toBe(chartType === 'area' ? 'line' : chartType);
    },
  );

  it('builds pie data as name/value pairs', () => {
    const r = buildExploreChartOption(columns, rows, {
      chartType: 'pie',
      xColumn: 'jurisdiction',
      yColumn: 'count',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const series = (r.option.series as Record<string, unknown>[])[0] as {
      data: { name: string; value: number }[];
    };
    expect(series.data).toHaveLength(3);
    expect(series.data[0]).toEqual({ name: 'EU', value: 10 });
  });

  it('heatmap requires a value column and indexes categories', () => {
    const missing = buildExploreChartOption(columns, rows, {
      chartType: 'heatmap',
      xColumn: 'day',
      yColumn: 'jurisdiction',
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toMatch(/value column/i);

    const r = buildExploreChartOption(columns, rows, {
      chartType: 'heatmap',
      xColumn: 'day',
      yColumn: 'jurisdiction',
      valueColumn: 'count',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const series = (r.option.series as Record<string, unknown>[])[0] as {
      data: [number, number, number][];
    };
    expect(series.data).toContainEqual([0, 0, 10]);
    expect(series.data).toContainEqual([1, 1, 5]);
  });

  it('rejects unknown columns and all-non-numeric Y columns with a reason', () => {
    const badCol = buildExploreChartOption(columns, rows, {
      chartType: 'line',
      xColumn: 'nope',
      yColumn: 'count',
    });
    expect(badCol.ok).toBe(false);

    const badY = buildExploreChartOption(columns, rows, {
      chartType: 'line',
      xColumn: 'day',
      yColumn: 'jurisdiction',
    });
    expect(badY.ok).toBe(false);
    if (badY.ok) return;
    expect(badY.reason).toMatch(/numeric/i);
  });

  it('rejects empty results — a chart never renders from nothing', () => {
    const r = buildExploreChartOption(columns, [], {
      chartType: 'line',
      xColumn: 'day',
      yColumn: 'count',
    });
    expect(r.ok).toBe(false);
  });
});
