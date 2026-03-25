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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card-surface p-4">
          <div className="label mb-2">Events recovered from ad blockers</div>
          <div className="font-mono text-[10px] text-[var(--text-muted)] mb-1">
            Recovered = events delivered server-side that browser-only tagging would miss.
          </div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">
            {metrics.eventsFromBlockers.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-[var(--accent-green)]">+{metrics.blockersPct}% vs browser-only</div>
        </div>

        <div className="card-surface p-4">
          <div className="label mb-2">Events recovered from ITP/restrictions</div>
          <div className="font-mono text-[10px] text-[var(--text-muted)] mb-1">
            Recovered = server-side persistence across ITP-style cookie windows.
          </div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">
            {metrics.eventsFromITP.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-[var(--accent-green)]">+{metrics.itpPct}% vs browser-only</div>
        </div>

        <div className="card-surface p-4">
          <div className="label mb-2">Cookie IDs beyond 7 days</div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">
            {metrics.cookieIdsPreserved.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">Attribution extended</div>
        </div>

        <div className="card-surface p-4">
          <div className="label mb-2">Bot requests filtered</div>
          <div className="font-mono text-2xl text-[var(--text-active)] mb-1">
            {metrics.botRequestsFiltered.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">Removed from pipeline</div>
        </div>
      </div>
    </div>
  );
}
