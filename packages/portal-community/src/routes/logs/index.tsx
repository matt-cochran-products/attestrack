import { useRequestLogs } from '../../hooks/useRequestLogs';

export default function RequestLogsPage() {
  const { loading, logs } = useRequestLogs();

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
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.07)]">
              <th className="label text-left p-3">Timestamp</th>
              <th className="label text-left p-3">Event</th>
              <th className="label text-left p-3">Jurisdiction</th>
              <th className="label text-left p-3">Consent</th>
              <th className="label text-right p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
                <td className="p-3 font-mono text-[10px] text-[var(--text-muted)]">{log.timestamp}</td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-active)]">{log.event}</td>
                <td className="p-3 font-mono text-[10px] text-[var(--text-muted)]">{log.jurisdiction}</td>
                <td className="p-3 font-mono text-[10px]">{log.consent}</td>
                <td className="p-3 font-mono text-[10px] text-right">{log.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
