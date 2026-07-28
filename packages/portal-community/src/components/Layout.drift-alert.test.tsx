// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardMetrics } from '../lib/api/types';

vi.mock('../lib/api/delay', () => ({
  stubDelay: () => Promise.resolve(),
}));

function metrics(over: Partial<DashboardMetrics>): DashboardMetrics {
  return {
    eventsToday: 0,
    driftAlertCount: 0,
    driftAlert: null,
    strategyStatus: 'inactive',
    strategySummary: '',
    shadowModeLabel: 'Shadow',
    ...over,
  };
}

async function renderLayout() {
  const { MemoryRouter } = await import('react-router-dom');
  const { Layout } = await import('./Layout');
  const { PortalShellProvider } = await import('../context/PortalShellContext');
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <PortalShellProvider>
        <Layout>
          <div>child</div>
        </Layout>
      </PortalShellProvider>
    </MemoryRouter>,
  );
}

describe('Layout drift banner (P3.1/P3.5 — driven by real drift state, never hardcoded)', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('../lib/api/dashboard');
    vi.resetModules();
  });

  it('shows the banner with mismatch details when the Worker reports drift', async () => {
    vi.doMock('../lib/api/dashboard', () => ({
      getDashboardMetrics: async () =>
        metrics({
          driftAlertCount: 1,
          driftAlert: {
            at: '2026-07-25T09:00:00.000Z',
            expected: 'aaaaaaaa1111',
            current: 'bbbbbbbb2222',
          },
        }),
    }));
    await renderLayout();

    const banner = await screen.findByText(/Config drift detected/);
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('aaaaaaaa');
    expect(banner.textContent).toContain('bbbbbbbb');
    expect(banner.textContent).toContain('2026-07-25T09:00:00.000Z');
  });

  it('renders NO banner when the Worker reports zero drift alerts', async () => {
    vi.doMock('../lib/api/dashboard', () => ({
      getDashboardMetrics: async () => metrics({ driftAlertCount: 0, driftAlert: null }),
    }));
    await renderLayout();

    // Wait for the shell to settle, then assert absence.
    await screen.findByText('Local stub data');
    expect(screen.queryByText(/drift/i)).not.toBeInTheDocument();
  });
});
