import type { CuratedChartSeries } from '../api/types';

/**
 * Merge curated multi-series points into Recharts row form:
 * `[{ label, [seriesName]: value }]`, preserving first-seen label order.
 * Missing (label × series) cells stay ABSENT (undefined) — a gap in the data
 * renders as a gap, never as an invented zero.
 */
export function mergeSeriesForRecharts(series: CuratedChartSeries[]): {
  data: Record<string, string | number>[];
  names: string[];
} {
  const names = series.map((s) => s.name);
  const order: string[] = [];
  const byLabel = new Map<string, Record<string, string | number>>();
  for (const s of series) {
    for (const p of s.points) {
      let row = byLabel.get(p.label);
      if (!row) {
        row = { label: p.label };
        byLabel.set(p.label, row);
        order.push(p.label);
      }
      row[s.name] = p.value;
    }
  }
  return { data: order.map((l) => byLabel.get(l) as Record<string, string | number>), names };
}
