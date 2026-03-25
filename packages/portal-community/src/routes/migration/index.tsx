import { Link } from 'react-router-dom';
import { paths } from '../paths';
import { usePortalShell } from '../../context/PortalShellContext';

const UPGRADE_ORIGIN = 'https://attestrue.com';

/**
 * OSS does not ship a CMP replacement wizard. Migration / cutover from another CMP
 * is an Attestrue licensed journey — hand off in one click.
 */
export default function MigrationPage() {
  const { siteConfig } = usePortalShell();
  const siteId = siteConfig?.siteId ?? '';
  const upgradeHref = `${UPGRADE_ORIGIN}/upgrade?site_id=${encodeURIComponent(siteId)}`;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="font-mono text-[13px] text-[var(--text-active)]">Migration & CMP cutover</div>
      <p className="font-sans text-[12px] text-[var(--text-muted)] leading-relaxed">
        Attestrack does not include an in-portal wizard that positions open source as a full consent management platform
        replacement. Parallel validation, policy alignment, and cutover checklists for teams moving from another CMP are
        part of <strong className="text-[var(--text-active)]">Attestrue</strong> after you upgrade.
      </p>
      <a href={upgradeHref} className="btn-primary text-[10px] inline-block" target="_blank" rel="noreferrer">
        Continue on attestrue.com →
      </a>
      <p className="font-mono text-[10px] text-[var(--text-muted)]">
        <Link to={paths.extensions} className="underline">
          Extensions
        </Link>
        {' · '}
        <Link to={paths.configuration} className="underline">
          Site configuration
        </Link>
      </p>
    </div>
  );
}
