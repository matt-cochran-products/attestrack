import { Link } from 'react-router-dom';
import { usePortalShell } from '../../context/PortalShellContext';
import { useCuratedAnalytics } from '../../hooks/useCuratedAnalytics';
import { paths } from '../paths';

function MiniBarChart({ series }: { series: { label: string; value: number }[] }) {
  const max = Math.max(...series.map((p) => p.value), 1);
  return (
    <div className="flex items-end gap-1 h-28">
      {series.map((p) => (
        <div key={p.label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-[var(--red)] opacity-90"
            style={{ height: `${(p.value / max) * 100}%`, minHeight: '4px' }}
            title={`${p.label}: ${p.value}`}
          />
          <span className="font-mono text-[8px] text-[var(--text-label)] rotate-0">{p.label.slice(-2)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const { analyticsRange, setAnalyticsRange } = usePortalShell();
  const { loading, charts, warehouse, error } = useCuratedAnalytics();

  if (error) {
    return (
      <div className="p-6 font-mono text-[11px] text-[var(--accent-red)]">
        {error.message}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <div className="font-mono text-[13px] text-[var(--text-active)] font-medium">Analytics dashboard</div>
          <p className="font-sans text-[12px] text-[var(--text-muted)] mt-1 max-w-2xl">
            Curated views are read-only (ANA.4). Date range applies across Analytics for this session (ANA.5). Each chart
            loads independently (ANA.6).
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <label className="font-mono text-[10px] text-[var(--text-muted)] flex items-center gap-2">
            From
            <input
              type="date"
              value={analyticsRange.dateFrom}
              onChange={(e) =>
                setAnalyticsRange({ ...analyticsRange, dateFrom: e.target.value })
              }
              className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] p-1 font-mono text-[11px] text-[var(--text-active)]"
            />
          </label>
          <label className="font-mono text-[10px] text-[var(--text-muted)] flex items-center gap-2">
            To
            <input
              type="date"
              value={analyticsRange.dateTo}
              onChange={(e) =>
                setAnalyticsRange({ ...analyticsRange, dateTo: e.target.value })
              }
              className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] p-1 font-mono text-[11px] text-[var(--text-active)]"
            />
          </label>
        </div>
      </div>

      {warehouse && !warehouse.configured && (
        <div className="card-surface p-6 border-l-4 border-l-[var(--accent-amber)]">
          <div className="font-mono text-[12px] text-[var(--accent-amber)] mb-2">ClickHouse / Tinybird not configured</div>
          <p className="font-sans text-[13px] text-[var(--text-muted)]">{warehouse.message}</p>
        </div>
      )}

      {loading && (
        <div className="h-24 bg-[var(--bg-card)] animate-pulse" />
      )}

      {!loading && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {charts.map((chart) => (
            <div key={chart.id} className="card-surface p-6">
              <div className="label mb-4">{chart.title}</div>
              <MiniBarChart series={chart.points} />
            </div>
          ))}
        </div>
      )}

      <div className="card-surface p-6">
        <div className="label mb-2">Consent by applicable regulation (extensions)</div>
        <p className="font-sans text-[12px] text-[var(--text-muted)] mb-4">
          Regulation-scoped consent analytics ship with Attestrue Privacy Consent extensions — not in open-source Attestrack
          (ADR-010).
        </p>
        <Link to={paths.extensions} className="font-mono text-[11px] underline text-[var(--accent-green)]">
          Extensions handoff →
        </Link>
      </div>
    </div>
  );
}
