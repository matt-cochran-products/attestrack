import type { ExploreChartType } from '@attestrack/types';
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_SEQUENTIAL_RANGE,
  CHART_SERIES_COLORS,
  CHART_TEXT_COLOR,
  CHART_TOOLTIP_BG,
} from './palette';

/**
 * EXP.8 — visualisation is user-directed. This builder converts an Explore
 * result into an ECharts option ONLY for the chart type + column mapping the
 * user picked; it never infers a "best" chart. `table` is the default view and
 * is rendered by the results table, not here.
 */
export interface ExploreChartConfig {
  chartType: ExploreChartType;
  xColumn?: string;
  yColumn?: string;
  /** Heatmap cell value column. */
  valueColumn?: string;
}

export type ExploreChartBuild =
  | { ok: true; option: Record<string, unknown> }
  | { ok: false; reason: string };

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

const baseText = { color: CHART_TEXT_COLOR, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 };

function baseOption(): Record<string, unknown> {
  return {
    animation: false,
    textStyle: baseText,
    tooltip: {
      trigger: 'item',
      backgroundColor: CHART_TOOLTIP_BG,
      borderColor: CHART_GRID_COLOR,
      textStyle: { ...baseText, color: 'rgba(245,242,236,0.85)' },
    },
    color: [...CHART_SERIES_COLORS],
  };
}

function cartesianAxes(categories: string[]): Record<string, unknown> {
  return {
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: CHART_AXIS_COLOR } },
      axisLabel: baseText,
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: CHART_GRID_COLOR } },
      axisLabel: baseText,
    },
  };
}

export function buildExploreChartOption(
  columns: string[],
  rows: Record<string, unknown>[],
  config: ExploreChartConfig,
): ExploreChartBuild {
  const { chartType } = config;
  if (chartType === 'table') {
    return { ok: false, reason: 'Table is the default result view — no chart to build.' };
  }
  if (rows.length === 0) {
    return { ok: false, reason: 'Run a query first — a chart needs result rows.' };
  }
  const xColumn = config.xColumn ?? '';
  const yColumn = config.yColumn ?? '';
  if (!xColumn || !columns.includes(xColumn)) {
    return { ok: false, reason: 'Pick an X column from the result.' };
  }
  if (!yColumn || !columns.includes(yColumn)) {
    return { ok: false, reason: 'Pick a Y column from the result.' };
  }

  if (chartType === 'heatmap') {
    const valueColumn = config.valueColumn ?? '';
    if (!valueColumn || !columns.includes(valueColumn)) {
      return { ok: false, reason: 'Pick a value column for the heatmap cells.' };
    }
    const xCats: string[] = [];
    const yCats: string[] = [];
    const data: [number, number, number][] = [];
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
      const v = num(row[valueColumn]);
      if (v === null) continue;
      const x = str(row[xColumn]);
      const y = str(row[yColumn]);
      let xi = xCats.indexOf(x);
      if (xi === -1) {
        xi = xCats.length;
        xCats.push(x);
      }
      let yi = yCats.indexOf(y);
      if (yi === -1) {
        yi = yCats.length;
        yCats.push(y);
      }
      data.push([xi, yi, v]);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (data.length === 0) {
      return { ok: false, reason: `No numeric values in "${valueColumn}".` };
    }
    return {
      ok: true,
      option: {
        ...baseOption(),
        grid: { left: 80, right: 16, top: 24, bottom: 56 },
        xAxis: { type: 'category', data: xCats, axisLabel: baseText },
        yAxis: { type: 'category', data: yCats, axisLabel: baseText },
        visualMap: {
          min,
          max,
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          inRange: { color: [...CHART_SEQUENTIAL_RANGE] },
          textStyle: baseText,
        },
        series: [{ type: 'heatmap', data }],
      },
    };
  }

  if (chartType === 'pie') {
    const data = rows
      .map((row) => ({ name: str(row[xColumn]), value: num(row[yColumn]) }))
      .filter((d): d is { name: string; value: number } => d.value !== null);
    if (data.length === 0) {
      return { ok: false, reason: `No numeric values in "${yColumn}".` };
    }
    return {
      ok: true,
      option: {
        ...baseOption(),
        legend: { bottom: 0, textStyle: baseText },
        series: [
          {
            type: 'pie',
            radius: ['35%', '65%'],
            itemStyle: { borderColor: '#0a0a0a', borderWidth: 2 },
            label: { ...baseText, color: CHART_TEXT_COLOR },
            data,
          },
        ],
      },
    };
  }

  // line / area / bar / scatter share the cartesian shape.
  const categories: string[] = [];
  const values: (number | null)[] = [];
  let numericCount = 0;
  for (const row of rows) {
    categories.push(str(row[xColumn]));
    const v = num(row[yColumn]);
    if (v !== null) numericCount += 1;
    values.push(v);
  }
  if (numericCount === 0) {
    return { ok: false, reason: `No numeric values in "${yColumn}".` };
  }

  const series: Record<string, unknown> = {
    name: yColumn,
    data: values,
    ...(chartType === 'line' || chartType === 'area'
      ? {
          type: 'line',
          showSymbol: rows.length <= 60,
          symbolSize: 8,
          lineStyle: { width: 2 },
          ...(chartType === 'area' ? { areaStyle: { opacity: 0.25 } } : {}),
        }
      : chartType === 'bar'
        ? { type: 'bar', itemStyle: { borderRadius: [4, 4, 0, 0] }, barMaxWidth: 32 }
        : { type: 'scatter', symbolSize: 8 }),
  };

  return {
    ok: true,
    option: {
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as Record<string, unknown>),
        trigger: chartType === 'scatter' ? 'item' : 'axis',
      },
      ...cartesianAxes(categories),
      series: [series],
    },
  };
}
