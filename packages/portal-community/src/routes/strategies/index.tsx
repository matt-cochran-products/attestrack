import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmPhraseDialog } from '../../components/ConfirmPhraseDialog';
import { useStrategies } from '../../hooks/useStrategies';
import type { StrategyRow } from '../../lib/api/types';

export default function StrategiesPage() {
  const { loading, strategies, setEnabled } = useStrategies();
  const [pendingDisable, setPendingDisable] = useState<StrategyRow | null>(null);

  const confirmDisable = async () => {
    if (!pendingDisable) {
      return;
    }
    try {
      await setEnabled(pendingDisable.id, false);
      toast.success(`Strategy ${pendingDisable.name} disabled`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update strategy');
    } finally {
      setPendingDisable(null);
    }
  };

  if (loading || !strategies) {
    return (
      <div className="p-6">
        <div className="h-8 bg-[var(--bg-card)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <ConfirmPhraseDialog
        open={pendingDisable !== null}
        title="Disable strategy"
        description="Disabling stops events flowing to this destination immediately. This requires typed confirmation (STR.3)."
        phrase={pendingDisable?.name ?? ''}
        confirmLabel="Disable"
        onConfirm={confirmDisable}
        onCancel={() => setPendingDisable(null)}
      />

      <div className="card-surface p-6">
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium mb-4">
          BUILT-IN STRATEGIES — Community
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.07)]">
              <th className="label text-left p-3">Strategy</th>
              <th className="label text-left p-3">Status</th>
              <th className="label text-right p-3">Events today</th>
              <th className="label text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {strategies.builtin.map((s) => (
              <tr key={s.id} className="border-b border-[rgba(255,255,255,0.05)]">
                <td className="p-3 font-mono text-[11px] text-[var(--text-active)]">
                  <div className="flex items-center gap-2">
                    {s.status === 'active' && <span className="status-dot active" />}
                    {s.status === 'degraded' && <span className="status-dot warning" />}
                    {s.name}
                  </div>
                </td>
                <td className="p-3">
                  {s.status === 'active' && (
                    <span className="font-mono text-[11px] text-[var(--accent-green)]">✓ Active</span>
                  )}
                  {s.status === 'degraded' && (
                    <span className="font-mono text-[11px] text-[var(--accent-amber)]">⚠ Degraded</span>
                  )}
                  {s.status === 'inactive' && (
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">— Inactive — no endpoint configured</span>
                  )}
                </td>
                <td className="p-3 font-mono text-[11px] text-[var(--text-muted)] text-right">
                  {s.eventsToday != null ? s.eventsToday.toLocaleString() : '—'}
                </td>
                <td className="p-3 text-right">
                  {s.status === 'active' || s.status === 'degraded' ? (
                    <button
                      type="button"
                      className="btn-destructive text-[9px] py-1 px-2"
                      onClick={() => setPendingDisable(s)}
                    >
                      Disable
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary text-[9px] py-1 px-2"
                      onClick={async () => {
                        try {
                          await setEnabled(s.id, true);
                          toast.success('Strategy enabled (stub)');
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Failed');
                        }
                      }}
                    >
                      Enable
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-surface p-6 opacity-60">
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium mb-4">
          PROOF LAYER — Requires license
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.07)]">
              <th className="label text-left p-3">Strategy</th>
              <th className="label text-left p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {strategies.proofLayer.map((s) => (
              <tr key={s.id} className="border-b border-[rgba(255,255,255,0.05)]">
                <td className="p-3 font-mono text-[11px] text-[var(--text-active)]">
                  <div className="flex items-center gap-2">
                    <span>🔒</span>
                    {s.name}
                  </div>
                </td>
                <td className="p-3 font-mono text-[10px] text-[var(--text-muted)]">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a
          href="https://github.com/matt-cochran/attestrack/blob/main/ADAPTER-DEVELOPMENT-GUIDE.md"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-[var(--accent-green)] mt-4 inline-block underline"
        >
          Community strategy submissions (GitHub) →
        </a>
      </div>
    </div>
  );
}
