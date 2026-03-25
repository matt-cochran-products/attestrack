import { Link } from 'react-router-dom';
import { paths } from '../paths';
import { usePortalShell } from '../../context/PortalShellContext';

const UPGRADE_ORIGIN = 'https://attestrue.com';

export default function SiteConfigurationPage() {
  const { siteConfig } = usePortalShell();

  const siteId = siteConfig?.siteId ?? '';
  const upgradeHref = `${UPGRADE_ORIGIN}/upgrade?site_id=${encodeURIComponent(siteId)}`;

  if (!siteConfig) {
    return (
      <div className="p-6">
        <div className="h-8 bg-[var(--bg-card)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="card-surface p-6">
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-4">
          Attestrue extensions
        </div>
        <p className="font-sans text-[13px] text-[var(--text-muted)] leading-relaxed mb-4 max-w-2xl">
          Open-source Attestrack covers measurement, transport, analytics, and destination delivery.{' '}
          <strong className="text-[var(--text-active)] font-medium">
            Banner configuration, policy versions, jurisdiction rules, consent enforcement, evidence, and witnessing
          </strong>{' '}
          are activated through Attestrue — one click opens checkout with your site id.
        </p>
        <a
          href={upgradeHref}
          className="btn-primary text-[10px] inline-block"
          target="_blank"
          rel="noreferrer"
        >
          Open attestrue.com upgrade →
        </a>
        <p className="font-mono text-[10px] text-[var(--text-muted)] mt-3">
          <Link to={paths.extensions} className="underline hover:text-[var(--text-active)]">
            Extensions overview
          </Link>
          {' · '}
          <Link to={paths.upgrade} className="underline hover:text-[var(--text-active)]">
            In-portal upgrade copy
          </Link>
        </p>
      </div>

      <div className="card-surface p-6">
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-4">Deployment</div>
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
            <div className="label mb-1">Validation period started</div>
            <div className="value-lg">{siteConfig.shadowStart}</div>
          </div>
        </div>
      </div>

      <div className="card-surface p-6">
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-4">
          Trusted domains (egress allowlist)
        </div>
        <ul className="font-mono text-[11px] text-[var(--text-muted)] space-y-1 mb-4">
          {siteConfig.trustedDomains.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="font-sans text-[11px] text-[var(--text-muted)]">
          Editing the allowlist via the portal uses the Worker when implemented (CFG.3). For enforcement and consent
          configuration, use Attestrue after upgrade.
        </p>
      </div>
    </div>
  );
}
