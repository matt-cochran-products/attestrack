import { Link, useSearchParams } from 'react-router-dom';
import { paths } from '../paths';
import { usePortalShell } from '../../context/PortalShellContext';

const UPGRADE_ORIGIN = 'https://attestrue.com';

export default function UpgradePage() {
  const [params] = useSearchParams();
  const { siteConfig } = usePortalShell();
  const siteId = params.get('site_id') ?? siteConfig?.siteId ?? '';
  const upgradeHref = `${UPGRADE_ORIGIN}/upgrade?site_id=${encodeURIComponent(siteId)}`;

  return (
    <div className="p-6 space-y-8">
      <div>
        <div className="font-serif text-3xl text-[var(--text-active)] mb-4">ATTESTRUE EXTENSIONS</div>
        <div className="font-sans font-light text-[15px] text-[var(--text-active)] leading-relaxed max-w-3xl">
          Attestrack gives you analytics and server-side measurement on your own stack. Consent runtime, regulation
          configuration, witnessed records, and counsel workflows are optional Attestrue extensions — activated separately.
        </div>
        <p className="font-mono text-[11px] text-[var(--text-muted)] mt-4">
          PORTAL.10 — outbound link to Attestrue for upgrade:{' '}
          <a href={upgradeHref} className="text-[var(--accent-green)] underline" target="_blank" rel="noreferrer">
            {upgradeHref}
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card-surface p-6">
          <div className="font-mono text-sm text-[var(--text-active)] uppercase mb-3">PROOF LAYER</div>
          <div className="font-mono text-[11px] text-[var(--text-muted)] mb-4">Independent evidence</div>
          <div className="font-sans font-light text-[12px] text-[var(--text-muted)] mb-4">
            Your consent records exist only in your own infrastructure. Any record you generate yourself can be
            challenged.
          </div>
          <div className="font-mono text-[13px] text-[var(--text-active)] mb-2">$149/mo — founding rate</div>
          <a href={upgradeHref} className="btn-primary w-full text-[10px] block text-center" target="_blank" rel="noreferrer">
            Activate →
          </a>
        </div>

        <div className="card-surface p-6 border-2 border-[var(--accent-amber)]">
          <div className="font-mono text-sm text-[var(--text-active)] uppercase mb-3">COUNSEL ACCESS</div>
          <div className="font-mono text-[11px] text-[var(--text-muted)] mb-4">Attorney-supervised configuration</div>
          <div className="font-sans font-light text-[12px] text-[var(--text-muted)] mb-4">
            Your applicable-regulation configuration can be reviewed and published through licensed counsel workflows.
          </div>
          <div className="font-mono text-[13px] text-[var(--text-active)] mb-2">$59/mo per client</div>
          <Link to={paths.extensions} className="btn-secondary w-full text-[10px] block text-center">
            Extensions overview →
          </Link>
        </div>

        <div className="card-surface p-6">
          <div className="font-mono text-sm text-[var(--text-active)] uppercase mb-3">ADD-ONS</div>
          <div className="font-mono text-[11px] text-[var(--text-muted)] mb-4">Capability extensions</div>
          <div className="font-sans font-light text-[12px] text-[var(--text-muted)] mb-4">
            Network-level capabilities requiring specialized models.
          </div>
          <button type="button" className="btn-secondary w-full text-[10px]">
            Browse →
          </button>
        </div>
      </div>
    </div>
  );
}
