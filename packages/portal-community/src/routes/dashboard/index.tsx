import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { paths } from '../paths';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { getIncomingLogs } from '../../lib/api/logs';
import type { RequestLogRow } from '../../lib/api/types';

export default function DashboardPage() {
  const { loading, metrics, error } = useDashboardMetrics();
  const [recent, setRecent] = useState<RequestLogRow[]>([]);

  useEffect(() => {
    const t = window.setInterval(() => {
      void getIncomingLogs().then((rows) => setRecent(rows.slice(0, 6)));
    }, 8000);
    void getIncomingLogs().then((rows) => setRecent(rows.slice(0, 6)));
    return () => window.clearInterval(t);
  }, []);

  if (error) {
    return (
      <div className="p-6 font-mono text-[11px] text-[var(--accent-red)]">
        {error.message}
      </div>
    );
  }

  if (loading || !metrics) {
    return (
      <div className="p-6">
        <div className="h-8 bg-[var(--bg-card)] animate-pulse rounded-none mb-4" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="font-mono text-[11px] text-[var(--text-muted)]">
        Last 7 days (default).{' '}
        <Link to={paths.analytics} className="underline hover:text-[var(--text-active)]">
          Change range in Analytics →
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-surface p-4">
          <div className="label mb-2">Consent / regulation</div>
          <div className="font-mono text-[11px] text-[var(--text-muted)] mb-2">
            Not part of open-source Attestrack. Activate extensions for consent metrics (ADR-010).
          </div>
          <Link to={paths.extensions} className="font-mono text-[10px] underline text-[var(--accent-green)]">
            Extensions →
          </Link>
        </div>
        <div className="card-surface p-4">
          <div className="label mb-2">Events today</div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">
            {metrics.eventsToday.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">Incoming events (stub)</div>
        </div>
        <div className="card-surface p-4">
          <div className="label mb-2">Active drift alerts</div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">{metrics.driftAlertCount}</div>
          <Link to={paths.logs} className="font-mono text-[10px] underline text-[var(--accent-amber)]">
            View logs →
          </Link>
        </div>
        <div className="card-surface p-4">
          <div className="label mb-2">Strategy status</div>
          <div className="font-mono text-[12px] text-[var(--text-active)] mb-1">{metrics.strategyStatus}</div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">{metrics.strategySummary}</div>
          <Link to={paths.strategies} className="font-mono text-[10px] underline mt-2 inline-block">
            Open strategies →
          </Link>
        </div>
      </div>

      <div className="card-surface p-6">
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium mb-4">RECENT EVENTS</div>
        <p className="font-sans text-[12px] text-[var(--text-muted)] mb-4">
          Panel refreshes on an interval while this session is open (DASH.5 direction).
        </p>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.07)]">
              <th className="label text-left p-2">Timestamp</th>
              <th className="label text-left p-2">Event</th>
              <th className="label text-left p-2">Region</th>
              <th className="label text-left p-2">Signal</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((log, i) => (
              <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
                <td className="p-2 font-mono text-[10px] text-[var(--text-muted)]">{log.timestamp}</td>
                <td className="p-2 font-mono text-[11px] text-[var(--text-active)]">{log.event}</td>
                <td className="p-2 font-mono text-[10px] text-[var(--text-muted)]">{log.jurisdiction}</td>
                <td className="p-2 font-mono text-[10px]">{log.consent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <Link to={paths.signal} className="btn-secondary text-[10px] inline-block">
          Signal recovery (analytics entry) →
        </Link>
      </div>
    </div>
  );
}
