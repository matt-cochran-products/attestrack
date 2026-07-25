import { Suspense, lazy, useEffect, useState } from 'react';
import { runExploreQuery } from '../lib/api/explore';
import type { ExploreQueryResult, SavedQueryEntry } from '../lib/api/types';
import { buildExploreChartOption } from '../lib/charts/echarts-option';

const ExploreChart = lazy(() => import('./ExploreChart'));

/**
 * EXP.10 — a pinned saved query rendered as an Analytics dashboard tile.
 * The SQL runs through the SAME gated Explore proxy as the Explore surface
 * (never a second path); the chart form is the one the user picked when
 * pinning (EXP.8 — user-directed). `table` pins render rows, not a chart.
 */
export default function PinnedQueryTile({ query }: { query: SavedQueryEntry }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ExploreQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    runExploreQuery(query.sql)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query.sql]);

  const chartConfig = query.pinnedChart ?? { chartType: 'table' as const };

  return (
    <div className="card-surface p-6" data-testid={`pinned-${query.id}`}>
      <div className="label mb-1">{query.name}</div>
      <p className="font-mono text-[9px] text-[var(--text-label)] mb-4 truncate" title={query.sql}>
        {query.sql}
      </p>

      {loading && <div className="h-40 bg-[var(--bg-card)] animate-pulse" aria-label="Loading pinned query" />}

      {!loading && error && (
        <div className="font-mono text-[11px] text-[var(--accent-red)]">Query failed: {error}</div>
      )}

      {!loading && !error && result && result.rows.length === 0 && (
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          Query returned no rows for the current data.
        </div>
      )}

      {!loading && !error && result && result.rows.length > 0 && (
        <TileBody result={result} chartConfig={chartConfig} />
      )}
    </div>
  );
}

function TileBody({
  result,
  chartConfig,
}: {
  result: ExploreQueryResult;
  chartConfig: NonNullable<SavedQueryEntry['pinnedChart']>;
}) {
  if (chartConfig.chartType !== 'table') {
    const build = buildExploreChartOption(result.columns, result.rows, chartConfig);
    if (build.ok) {
      return (
        <Suspense fallback={<div className="h-40 bg-[var(--bg-card)] animate-pulse" />}>
          <ExploreChart option={build.option} height={220} />
        </Suspense>
      );
    }
    return (
      <div className="font-mono text-[11px] text-[var(--text-muted)]">
        Pinned chart config no longer matches the result: {build.reason}
      </div>
    );
  }

  const rows = result.rows.slice(0, 10);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px]">
        <thead>
          <tr className="border-b border-[rgba(255,255,255,0.07)]">
            {result.columns.map((c) => (
              <th key={c} className="label text-left p-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
              {result.columns.map((c) => (
                <td key={c} className="p-2 font-mono text-[10px] text-[var(--text-muted)]">
                  {String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > 10 && (
        <p className="font-mono text-[9px] text-[var(--text-label)] p-2">
          Showing first 10 of {result.rows.length} rows — open in Explore for the full result.
        </p>
      )}
    </div>
  );
}
