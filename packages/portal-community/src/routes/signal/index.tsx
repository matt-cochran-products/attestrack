import { Link } from 'react-router-dom';
import { paths } from '../paths';
import { useSignalRecovery } from '../../hooks/useSignalRecovery';

export default function SignalPage() {
  const { loading, metrics, error } = useSignalRecovery();

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
      <div className="card-surface p-6 border-l-4 border-l-[var(--accent-amber)]">
        <div className="flex items-start gap-4">
          <div className="text-2xl">ℹ</div>
          <div className="flex-1">
            <div className="font-mono text-sm text-[var(--accent-amber)] uppercase tracking-wide mb-3">
              CONSENT + REGULATION EXTENSIONS
            </div>
            <div className="font-sans font-light text-[13px] text-[var(--text-active)] leading-relaxed space-y-3">
              <p>
                Attestrack focuses on first-party analytics and server-side measurement. Consent runtime, regulation UI,
                and witnessed records are optional Attestrue extensions (CDN artifacts cached on your Worker).
              </p>
              <p>Consult qualified counsel for how consent applies to your stack and jurisdictions.</p>
            </div>
            <div className="flex gap-4 mt-4">
              <Link to={paths.extensions} className="btn-primary text-[10px] px-4 py-2">
                Learn about extensions →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {!metrics.measured && (
        <div className="card-surface p-6 border-l-4 border-l-[var(--accent-amber)]">
          <div className="font-mono text-[12px] text-[var(--accent-amber)] mb-2">
            SIGNAL RECOVERY — NOT MEASURED IN V1 (REQUIRES BEACON)
          </div>
          <p className="font-sans font-light text-[13px] text-[var(--text-active)] leading-relaxed">
            {metrics.message ??
              'Measuring events recovered from ad blockers or ITP requires comparing server-side ingest against a client-side beacon. Attestrack v1 does not ship that beacon, so no recovery numbers are shown — this page will stay honest rather than estimate.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card-surface p-4">
          <div className="label mb-2">Bot requests filtered (today)</div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">
            {metrics.botRequestsFiltered.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">
            Troll-shield heuristics (UA class, missing headers, host bot score) — ad destinations skipped, warehouse
            rows kept and labeled.
          </div>
        </div>

        <div className="card-surface p-4">
          <div className="label mb-2">Server-side event volume</div>
          <div className="font-sans text-[12px] text-[var(--text-muted)]">
            Ingested-event counts live on the{' '}
            <Link to={paths.dashboard} className="underline text-[var(--accent-green)]">
              Dashboard
            </Link>{' '}
            and in{' '}
            <Link to={paths.explore} className="underline text-[var(--accent-green)]">
              Explore
            </Link>{' '}
            against your own warehouse.
          </div>
        </div>
      </div>
    </div>
  );
}
