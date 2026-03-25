import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { paths } from '../routes/paths';
import { usePortalShell } from '../context/PortalShellContext';

const navSections = [
  {
    title: 'OVERVIEW',
    items: [{ path: paths.dashboard, label: 'Dashboard' }],
  },
  {
    title: 'TRACKING',
    items: [
      { path: paths.signal, label: 'Signal Recovery' },
      { path: paths.destinations, label: 'Destinations' },
      { path: paths.logs, label: 'Request Logs' },
    ],
  },
  {
    title: 'ANALYTICS',
    items: [
      { path: paths.analytics, label: 'Analytics' },
      { path: paths.explore, label: 'Explore' },
    ],
  },
  {
    title: 'EXTENSIONS',
    items: [{ path: paths.extensions, label: 'Attestrue extensions' }],
  },
  {
    title: 'CONFIGURATION',
    items: [
      { path: paths.strategies, label: 'Strategies' },
      { path: paths.configuration, label: 'Site Config' },
    ],
  },
];

const bottomNav = [{ path: paths.upgrade, label: 'Upgrade / extensions' }];

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { siteConfig, modeShellLabel, isLiveWorker, dataSourceShellLabel } = usePortalShell();
  const [driftAlertDismissed, setDriftAlertDismissed] = useState(false);

  const isDriftAlertActive = true;

  const modeChipClass = 'bg-[rgba(224,192,96,0.15)] border-[rgba(224,192,96,0.3)]';

  const modeTextClass = 'text-[var(--accent-amber)]';

  return (
    <div className="flex min-h-screen bg-[var(--bg-shell)]">
      <aside className="w-[220px] border-r border-[rgba(255,255,255,0.07)] flex flex-col">
        <div className="p-5 border-b border-[rgba(255,255,255,0.07)]">
          <div className="font-mono text-sm">
            <span className="text-[var(--text-active)]">Attest</span>
            <span className="text-[var(--accent-green)]">rack</span>
          </div>
          <div className="font-mono text-[9px] text-[var(--text-muted)] mt-1">by Attestrue</div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.title} className="mb-6">
              <div className="label px-5 mb-2">{section.title}</div>
              {section.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`block px-5 py-2 font-mono text-[11px] transition-colors ${
                    location.pathname === item.path
                      ? 'text-[var(--text-active)] border-l-2 border-[var(--red)] bg-[rgba(255,255,255,0.02)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-active)] border-l-2 border-transparent'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}

          <div className="border-t border-[rgba(255,255,255,0.07)] pt-4 mt-4">
            {bottomNav.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`block px-5 py-2 font-mono text-[11px] transition-colors ${
                  location.pathname === item.path
                    ? 'text-[var(--text-active)] border-l-2 border-[var(--red)] bg-[rgba(255,255,255,0.02)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-active)] border-l-2 border-transparent'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="p-5 border-t border-[rgba(255,255,255,0.07)]">
          <div className="font-mono text-[10px] text-[var(--text-muted)]">
            <div>{siteConfig?.domain ?? '…'}</div>
            <div className="text-[var(--text-label)] mt-1">{siteConfig?.siteId ?? '…'}</div>
            <div className="text-[var(--text-label)] mt-1">Community</div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="border-b border-[rgba(255,255,255,0.07)] px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="font-mono text-[11px] text-[var(--text-muted)]">
            {location.pathname.split('/').filter(Boolean).join(' / ') || 'dashboard'}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className={`px-3 py-1.5 rounded-full border ${modeChipClass}`}>
              <span className={`font-mono text-[10px] uppercase tracking-wide ${modeTextClass}`}>
                {modeShellLabel}
              </span>
            </div>

            <div
              className={`px-3 py-1.5 rounded-full border font-mono text-[10px] uppercase tracking-wide ${
                isLiveWorker
                  ? 'border-[rgba(76,175,125,0.35)] bg-[rgba(76,175,125,0.12)] text-[var(--accent-green)]'
                  : 'border-[rgba(224,192,96,0.35)] bg-[rgba(224,192,96,0.1)] text-[var(--accent-amber)]'
              }`}
              title="Set VITE_ATTESTRACK_API_BASE_URL in .env for live Worker data (see packages/portal-community/.env.example)."
            >
              {dataSourceShellLabel}
            </div>

            <div className="font-mono text-[10px] text-[var(--text-label)]">{siteConfig?.siteId ?? '…'}</div>
          </div>
        </header>

        {isDriftAlertActive && !driftAlertDismissed && (
          <div className="border-b border-[rgba(224,192,96,0.3)] bg-[rgba(224,192,96,0.08)] px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] text-[var(--accent-amber)]">
                <span className="mr-2">⚠</span>
                1 drift alert — Unknown script: analytics.newvendor.com · 847 requests blocked · 2 days ago
                <Link to={paths.logs} className="ml-4 underline hover:text-[var(--text-active)]">
                  View logs →
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setDriftAlertDismissed(true)}
                className="text-[var(--text-muted)] hover:text-[var(--text-active)] font-mono text-[10px]"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
