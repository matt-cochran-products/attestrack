// @vitest-environment jsdom
/**
 * P6.4 — request-log view empty state (PORTAL.8): a fresh deploy explains the
 * data source instead of rendering a bare header table; populated logs render
 * rows. Includes a component-level axe scan (P6.5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

async function renderLogs() {
  const { default: RequestLogsPage } = await import('./index');
  return render(<RequestLogsPage />);
}

describe('RequestLogsPage', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('../../lib/api/logs');
    vi.resetModules();
  });

  it('shows an explanatory empty state when no ingest traffic exists yet', async () => {
    vi.doMock('../../lib/api/logs', () => ({ getIncomingLogs: async () => [] }));
    await renderLogs();
    expect(await screen.findByText('No requests logged yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/\/t\/event/)).toBeInTheDocument();
  });

  it('renders log rows when traffic exists', async () => {
    vi.doMock('../../lib/api/logs', () => ({
      getIncomingLogs: async () => [
        {
          timestamp: '2026-07-25T00:00:00Z',
          event: 'page_view',
          jurisdiction: 'EU',
          consent: 'granted',
          status: 'ok',
        },
      ],
    }));
    await renderLogs();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('page_view')).toBeInTheDocument();
    expect(screen.queryByText('No requests logged yet')).not.toBeInTheDocument();
  });

  it('empty state has no serious/critical axe violations', async () => {
    vi.doMock('../../lib/api/logs', () => ({ getIncomingLogs: async () => [] }));
    const { container } = await renderLogs();
    await screen.findByText('No requests logged yet');
    const results = await axe(container);
    const severe = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    expect(severe.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
  });
});
