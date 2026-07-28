import { paths } from '../paths';
import { usePortalShell } from '../../context/PortalShellContext';

const UPGRADE_ORIGIN = 'https://attestrue.com';

/**
 * Attestrack ships analytics + server-side measurement only.
 * Consent runtime, regulation UI, proof, and counsel workflows are Attestrue extensions (CDN + edge cache).
 */
export default function ExtensionsPage() {
  const { siteConfig } = usePortalShell();
  const siteId = siteConfig?.siteId ?? '';
  const upgradeHref = `${UPGRADE_ORIGIN}/upgrade?site_id=${encodeURIComponent(siteId)}`;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="font-mono text-lg text-[var(--text-active)] mb-4">Attestrue extensions</h1>
      <p className="font-mono text-[12px] text-[var(--text-muted)] leading-relaxed mb-6">
        Privacy consent, regulation configuration, independently witnessed records, and counsel portals are not part of
        open-source Attestrack. They are activated as licensed extensions: artifacts are published on the Attestrue CDN,
        cached on your Worker, and served first-party to visitors (see ADR-010).
      </p>
      <p className="font-mono text-[12px] text-[var(--text-muted)] leading-relaxed mb-6">
        Single-click handoff (includes your <span className="text-[var(--text-active)]">site_id</span> when loaded from
        a live Worker):
      </p>
      <a
        href={upgradeHref}
        className="inline-block font-mono text-[11px] px-4 py-2 border border-[rgba(255,255,255,0.15)] rounded hover:border-[var(--accent-green)] text-[var(--accent-green)]"
        target="_blank"
        rel="noreferrer"
      >
        Open attestrue.com upgrade →
      </a>
      <p className="font-mono text-[10px] text-[var(--text-muted)] mt-4">
        <a href={paths.upgrade} className="underline hover:text-[var(--text-active)]">
          In-portal upgrade overview
        </a>
      </p>
    </div>
  );
}
