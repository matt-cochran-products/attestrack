import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { paths } from '../paths';
import { ConfirmPhraseDialog } from '../../components/ConfirmPhraseDialog';
import { usePortalShell } from '../../context/PortalShellContext';
import { updateMode } from '../../lib/api/configuration';
import type { SiteMode } from '../../lib/api/types';

export default function SiteConfigurationPage() {
  const { siteConfig, refresh } = usePortalShell();
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [targetMode, setTargetMode] = useState<SiteMode | null>(null);

  const startToggle = (mode: SiteMode) => {
    setTargetMode(mode);
    setPhraseOpen(true);
  };

  const phrase =
    targetMode === 'ENFORCEMENT' ? 'ENABLE ENFORCEMENT' : targetMode === 'SHADOW' ? 'RETURN TO SHADOW' : '';

  const applyMode = async () => {
    if (!targetMode) {
      return;
    }
    try {
      await updateMode(targetMode);
      toast.success('Mode updated (stub)');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setPhraseOpen(false);
      setTargetMode(null);
    }
  };

  if (!siteConfig) {
    return (
      <div className="p-6">
        <div className="h-8 bg-[var(--bg-card)] animate-pulse" />
      </div>
    );
  }

  const consentBlocked = !siteConfig.consentConfigured;

  return (
    <div className="p-6 space-y-6">
      <ConfirmPhraseDialog
        open={phraseOpen}
        title={targetMode === 'ENFORCEMENT' ? 'Enable enforcement' : 'Return to shadow mode'}
        description={
          targetMode === 'ENFORCEMENT'
            ? 'Enforcement means visitors who decline consent will not have tracking scripts activated. Your reported consent rate will reflect actual signal sent to ad networks (CFG.1).'
            : 'Returning to shadow mode restores observation-only behaviour. Typed confirmation is still required (CFG.2).'
        }
        phrase={phrase}
        confirmLabel="Confirm"
        onConfirm={applyMode}
        onCancel={() => {
          setPhraseOpen(false);
          setTargetMode(null);
        }}
      />

      <div className="card-surface p-6">
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-4">
          DEPLOYMENT MODE
        </div>

        {consentBlocked ? (
          <div className="p-6 border-l-4 border-l-[var(--accent-amber)] bg-[rgba(224,192,96,0.05)]">
            <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-3">
              ⊘ ENFORCEMENT UNAVAILABLE — no consent configuration published
            </div>
            <div className="font-sans font-light text-[13px] text-[var(--text-active)] leading-relaxed space-y-3 mb-4">
              <p>
                Enforcement cannot be activated until a consent configuration has been published. You cannot gate traffic
                on consent decisions that don&apos;t exist.
              </p>
              <div>
                <strong className="font-medium">Complete these steps first:</strong>
                <ol className="list-decimal ml-6 mt-2 space-y-1">
                  <li>Activate Attestrue extensions for policy, banner, and regulation configuration → {paths.extensions}</li>
                  <li>Publish versions and consent configuration in the licensed portal</li>
                  <li>Return here to activate enforcement</li>
                </ol>
              </div>
            </div>
            <div className="flex gap-4">
              <Link to={paths.extensions} className="btn-primary text-[10px]">
                Extensions handoff →
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="font-sans text-[13px] text-[var(--text-muted)]">
              Current mode: <span className="text-[var(--text-active)]">{siteConfig.mode}</span>
            </p>
            {siteConfig.mode !== 'ENFORCEMENT' && (
              <button type="button" className="btn-primary text-[10px]" onClick={() => startToggle('ENFORCEMENT')}>
                Enable enforcement…
              </button>
            )}
            {siteConfig.mode === 'ENFORCEMENT' && (
              <button type="button" className="btn-secondary text-[10px]" onClick={() => startToggle('SHADOW')}>
                Return to shadow mode…
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card-surface p-6">
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-4">GENERAL</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="label mb-1">Site ID</div>
            <div className="value-lg">{siteConfig.siteId}</div>
          </div>
          <div>
            <div className="label mb-1">Domain</div>
            <div className="value-lg">{siteConfig.domain}</div>
          </div>
          <div>
            <div className="label mb-1">Worker version</div>
            <div className="value-lg">{siteConfig.workerVersion}</div>
          </div>
          <div>
            <div className="label mb-1">Shadow start</div>
            <div className="value-lg">{siteConfig.shadowStart}</div>
          </div>
        </div>
      </div>

      <div className="card-surface p-6">
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-4">
          TRUSTED DOMAINS (egress allowlist)
        </div>
        <ul className="font-mono text-[11px] text-[var(--text-muted)] space-y-1 mb-4">
          {siteConfig.trustedDomains.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="font-sans text-[11px] text-[var(--text-muted)]">Add/remove with confirmation in the Worker-backed milestone (CFG.3).</p>
      </div>
    </div>
  );
}
