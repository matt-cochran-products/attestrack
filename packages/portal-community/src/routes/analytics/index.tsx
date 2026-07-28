import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortalShell } from '../../context/PortalShellContext';
import { listSavedQueries } from '../../lib/api/explore';
import type { SavedQueryEntry } from '../../lib/api/types';
import CuratedChartCard from '../../components/CuratedChartCard';
import PinnedQueryTile from '../../components/PinnedQueryTile';
import { paths } from '../paths';

/**
 * P4.3 — curated analytics views (ANA.*). Every card is computed server-side
 * (canned SQL through the gated Explore proxy, or recorded delivery stats) and
 * loads independently (ANA.6). Views are read-only (ANA.4); the date range is
 * session-global (ANA.5). Pinned saved queries (EXP.10) render as extra tiles.
 */
export default function AnalyticsPage() {
  const { analyticsRange, setAnalyticsRange } = usePortalShell();
  const [pinned, setPinned] = useState<SavedQueryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    listSavedQueries()
      .then((list) => {
        if (!cancelled) setPinned(list.filter((q) => q.pinned));
      })
      .catch(() => {
        /* pinned tiles are additive — the curated grid stands alone */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <div className="font-mono text-[13px] text-[var(--text-active)] font-medium">Analytics dashboard</div>
          <p className="font-sans text-[12px] text-[var(--text-muted)] mt-1 max-w-2xl">
            Curated views are read-only (ANA.4) and computed from your own warehouse or recorded
            delivery outcomes — never seeded numbers. Date range applies across Analytics for this
            session (ANA.5). Each chart loads independently (ANA.6).
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <label className="font-mono text-[10px] text-[var(--text-muted)] flex items-center gap-2">
            From
            <input
              type="date"
              value={analyticsRange.dateFrom}
              onChange={(e) => setAnalyticsRange({ ...analyticsRange, dateFrom: e.target.value })}
              className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] p-1 font-mono text-[11px] text-[var(--text-active)]"
            />
          </label>
          <label className="font-mono text-[10px] text-[var(--text-muted)] flex items-center gap-2">
            To
            <input
              type="date"
              value={analyticsRange.dateTo}
              onChange={(e) => setAnalyticsRange({ ...analyticsRange, dateTo: e.target.value })}
              className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] p-1 font-mono text-[11px] text-[var(--text-active)]"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <CuratedChartCard chartId="events-volume" form="bar" />
        <CuratedChartCard chartId="consent-rate-by-jurisdiction" form="line" />
        <CuratedChartCard chartId="destination-success-rate" form="bar" />
        <CuratedChartCard chartId="bot-share" form="line" />
      </div>

      <div>
        <div className="label mb-3">Pinned queries (EXP.10)</div>
        {pinned.length === 0 ? (
          <p className="font-mono text-[10px] text-[var(--text-muted)]">
            No pinned queries. Save a query in{' '}
            <Link to={paths.explore} className="underline text-[var(--accent-green)]">
              Explore
            </Link>{' '}
            and pin it with a chart to see it here. Pins are personal to your portal identity.
          </p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {pinned.map((q) => (
              <PinnedQueryTile key={q.id} query={q} />
            ))}
          </div>
        )}
      </div>

      <div className="card-surface p-6">
        <div className="label mb-2">Consent by applicable regulation (extensions)</div>
        <p className="font-sans text-[12px] text-[var(--text-muted)] mb-4">
          Regulation-scoped consent analytics ship with Attestrue Privacy Consent extensions — not in
          open-source Attestrack (ADR-010).
        </p>
        <Link to={paths.extensions} className="font-mono text-[11px] underline text-[var(--accent-green)]">
          Extensions handoff →
        </Link>
      </div>
    </div>
  );
}
