import { Link } from 'react-router-dom';
import type { CuratedChartId } from '@attestrack/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useCuratedChart } from '../hooks/useCuratedChart';
import { mergeSeriesForRecharts } from '../lib/charts/recharts-data';
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_TEXT_COLOR,
  CHART_TOOLTIP_BG,
  seriesColor,
} from '../lib/charts/palette';
import { paths } from '../routes/paths';

/**
 * P4.3 — one curated analytics card (ANA.2 honest subset). Read-only (ANA.4),
 * loads independently (ANA.6), one-line framing always present (ANA.7
 * discipline). Every number comes from the Worker's computed payload; empty /
 * not-configured / error states render as states with a strategies link
 * (ANA.3/EXP.13) — never as placeholder charts.
 */
export interface CuratedChartCardProps {
  chartId: CuratedChartId;
  /** Deliberate (user-of-the-codebase-directed) form per chart — not inferred from data. */
  form: 'line' | 'bar';
}

const tooltipStyle = {
  backgroundColor: CHART_TOOLTIP_BG,
  border: `1px solid ${CHART_GRID_COLOR}`,
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 10,
};

const tickStyle = { fill: CHART_TEXT_COLOR, fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' };

export default function CuratedChartCard({ chartId, form }: CuratedChartCardProps) {
  const { loading, chart, error } = useCuratedChart(chartId);

  return (
    <div className="card-surface p-6" data-testid={`curated-${chartId}`}>
      <div className="label mb-1">{chart?.title ?? chartId}</div>
      {chart && (
        <p className="font-sans text-[11px] text-[var(--text-muted)] mb-4">{chart.description}</p>
      )}

      {loading && <div className="h-40 bg-[var(--bg-card)] animate-pulse" aria-label="Loading chart" />}

      {!loading && error && (
        <div className="font-mono text-[11px] text-[var(--accent-red)]">
          Failed to load: {error.message}
        </div>
      )}

      {!loading && !error && chart && chart.state !== 'ok' && (
        <div
          className={`font-mono text-[11px] ${
            chart.state === 'error' ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'
          }`}
        >
          <p className="mb-2">{chart.message}</p>
          {(chart.state === 'not_configured' || chart.state === 'empty') && (
            <Link to={paths.strategies} className="underline text-[var(--accent-green)]">
              Configure destinations in Strategies →
            </Link>
          )}
        </div>
      )}

      {!loading && !error && chart && chart.state === 'ok' && (
        <>
          <ChartBody chart={chart} form={form} />
          {chart.truncated && (
            <p className="font-mono text-[10px] text-[var(--accent-amber)] mt-2">
              Result truncated at the 500-row Explore limit — narrow the date range for full
              resolution.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ChartBody({
  chart,
  form,
}: {
  chart: NonNullable<ReturnType<typeof useCuratedChart>['chart']>;
  form: 'line' | 'bar';
}) {
  const { data, names } = mergeSeriesForRecharts(chart.series);
  const yDomain: [number, number | 'auto'] = chart.unit === 'percent' ? [0, 100] : [0, 'auto'];
  const multi = names.length > 1;

  if (form === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={tickStyle} stroke={CHART_AXIS_COLOR} interval="preserveStartEnd" />
          <YAxis tick={tickStyle} stroke={CHART_AXIS_COLOR} domain={yDomain} width={44} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          {multi && <Legend wrapperStyle={tickStyle} />}
          {names.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              fill={seriesColor(i)}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
        <XAxis dataKey="label" tick={tickStyle} stroke={CHART_AXIS_COLOR} interval="preserveStartEnd" />
        <YAxis tick={tickStyle} stroke={CHART_AXIS_COLOR} domain={yDomain} width={44} />
        <Tooltip contentStyle={tooltipStyle} />
        {multi && <Legend wrapperStyle={tickStyle} />}
        {names.map((name, i) => (
          <Line
            key={name}
            dataKey={name}
            stroke={seriesColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
