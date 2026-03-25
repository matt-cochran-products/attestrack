import { useDestinations } from '../../hooks/useDestinations';

export default function DestinationsPage() {
  const { loading, destinations, alerts } = useDestinations();

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-8 bg-[var(--bg-card)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.07)]">
              <th className="label text-left p-3">Destination</th>
              <th className="label text-left p-3">Status</th>
              <th className="label text-right p-3">Success rate</th>
              <th className="label text-left p-3">Last event</th>
              <th className="label text-left p-3">Auth</th>
              <th className="label text-right p-3">Events today</th>
            </tr>
          </thead>
          <tbody>
            {destinations.map((dest) => (
              <tr
                key={dest.id}
                className={`border-b border-[rgba(255,255,255,0.05)] ${
                  dest.status === 'degraded' ? 'bg-[rgba(224,192,96,0.05)]' : ''
                }`}
              >
                <td className="p-3 font-mono text-[11px] text-[var(--text-active)]">{dest.name}</td>
                <td className="p-3">
                  {dest.status === 'healthy' && (
                    <span className="font-mono text-[11px] text-[var(--accent-green)]">✓ Healthy</span>
                  )}
                  {dest.status === 'degraded' && (
                    <span className="font-mono text-[11px] text-[var(--accent-amber)]">⚠ Degraded</span>
                  )}
                  {dest.status === 'inactive' && (
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">— Inactive</span>
                  )}
                </td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-active)] text-right">
                  {dest.successRate > 0 ? `${dest.successRate}%` : '—'}
                </td>
                <td className="p-3 font-mono text-[10px] text-[var(--text-muted)]">{dest.lastEvent ?? '—'}</td>
                <td className="p-3 font-mono text-[10px] text-[var(--text-muted)]">{dest.auth}</td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-active)] text-right">
                  {dest.eventsToday > 0 ? dest.eventsToday.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-surface p-6">
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium mb-4">ALERT RULES</div>
        <div className="space-y-3">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-[rgba(255,255,255,0.05)] pb-3"
            >
              <div className="flex-1">
                <div className="font-mono text-[11px] text-[var(--text-active)]">{alert.destination}</div>
                <div className="font-mono text-[10px] text-[var(--text-muted)]">
                  {alert.condition} · {alert.email}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="status-dot active" />
                <span className="font-mono text-[10px] text-[var(--accent-green)]">Active</span>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary mt-4 text-[10px]">
          + Add alert rule
        </button>
      </div>
    </div>
  );
}
