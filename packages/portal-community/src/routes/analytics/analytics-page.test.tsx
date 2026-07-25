// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { CuratedChart } from '../../lib/api/types';

vi.mock('../../lib/api/delay', () => ({
  stubDelay: () => Promise.resolve(),
}));

function chart(over: Partial<CuratedChart> & { id: CuratedChart['id'] }): CuratedChart {
  return {
    title: over.id,
    description: 'desc',
    unit: 'count',
    source: 'warehouse',
    state: 'ok',
    series: [],
    ...over,
  };
}

async function renderAnalytics() {
  const { MemoryRouter } = await import('react-router-dom');
  const { PortalShellProvider } = await import('../../context/PortalShellContext');
  const { default: AnalyticsPage } = await import('./index');
  render(
    <MemoryRouter initialEntries={['/analytics']}>
      <PortalShellProvider>
        <AnalyticsPage />
      </PortalShellProvider>
    </MemoryRouter>,
  );
}

describe('Analytics page (P4.3 curated views + EXP.10 pinned tiles)', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('../../lib/api/analytics');
    vi.doUnmock('../../lib/api/explore');
    vi.resetModules();
  });

  it('renders each curated chart independently with honest per-chart states (ANA.6)', async () => {
    vi.doMock('../../lib/api/analytics', () => ({
      getCuratedChart: async (id: CuratedChart['id']) => {
        if (id === 'events-volume') {
          return chart({
            id,
            title: 'Events ingested per day',
            series: [
              {
                name: 'Events',
                points: [
                  { label: '2026-07-24', value: 120 },
                  { label: '2026-07-25', value: 80 },
                ],
              },
            ],
          });
        }
        if (id === 'consent-rate-by-jurisdiction') {
          return chart({
            id,
            title: 'Consent rate by jurisdiction',
            unit: 'percent',
            state: 'not_configured',
            message: 'No analytics warehouse configured.',
          });
        }
        if (id === 'destination-success-rate') {
          return chart({
            id,
            title: 'Destination success rate',
            unit: 'percent',
            source: 'delivery_stats',
            state: 'empty',
            message: 'No delivery outcomes recorded yet.',
          });
        }
        return chart({
          id,
          title: 'Bot share of ingested events',
          unit: 'percent',
          state: 'error',
          message: 'Warehouse query failed: boom',
        });
      },
      getAnalyticsWarehouseStatus: async () => ({ configured: true, message: 'ok' }),
    }));
    vi.doMock('../../lib/api/explore', () => ({
      listSavedQueries: async () => [],
      runExploreQuery: async () => ({ columns: [], rows: [], rowCount: 0, truncated: false }),
    }));
    await renderAnalytics();

    // OK chart renders its title; states render their honest messages.
    expect(await screen.findByText('Events ingested per day')).toBeInTheDocument();

    const consentCard = await screen.findByTestId('curated-consent-rate-by-jurisdiction');
    expect(within(consentCard).getByText('No analytics warehouse configured.')).toBeInTheDocument();
    // EXP.13/ANA.3 — unconfigured/empty states link to Strategies.
    expect(
      within(consentCard).getByRole('link', { name: /Strategies/ }),
    ).toHaveAttribute('href', '/strategies');

    const destCard = await screen.findByTestId('curated-destination-success-rate');
    expect(within(destCard).getByText('No delivery outcomes recorded yet.')).toBeInTheDocument();
    expect(within(destCard).getByRole('link', { name: /Strategies/ })).toBeInTheDocument();

    const botCard = await screen.findByTestId('curated-bot-share');
    expect(within(botCard).getByText(/Warehouse query failed: boom/)).toBeInTheDocument();
    // Error state carries no strategies CTA and no chart — and never fake series.
    expect(within(botCard).queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders pinned saved queries as tiles via the gated proxy (EXP.10)', async () => {
    vi.doMock('../../lib/api/analytics', () => ({
      getCuratedChart: async (id: CuratedChart['id']) =>
        chart({ id, state: 'empty', message: 'empty' }),
      getAnalyticsWarehouseStatus: async () => ({ configured: true, message: 'ok' }),
    }));
    const runSpy = vi.fn(async () => ({
      columns: ['eventName', 'c'],
      rows: [{ eventName: 'page_view', c: 12 }],
      rowCount: 1,
      truncated: false,
    }));
    vi.doMock('../../lib/api/explore', () => ({
      listSavedQueries: async () => [
        { id: 'q1', name: 'Unpinned', sql: 'SELECT 2 FROM events', updatedAt: 'now', pinned: false },
        {
          id: 'q2',
          name: 'My pinned events',
          sql: 'SELECT eventName, count() AS c FROM events GROUP BY eventName',
          updatedAt: 'now',
          pinned: true,
          pinnedChart: { chartType: 'table' },
        },
      ],
      runExploreQuery: runSpy,
    }));
    await renderAnalytics();

    const tile = await screen.findByTestId('pinned-q2');
    expect(within(tile).getByText('My pinned events')).toBeInTheDocument();
    expect(await within(tile).findByText('page_view')).toBeInTheDocument();
    // Only the pinned query renders a tile, and its SQL goes through runExploreQuery.
    expect(screen.queryByTestId('pinned-q1')).not.toBeInTheDocument();
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the pin hint when nothing is pinned', async () => {
    vi.doMock('../../lib/api/analytics', () => ({
      getCuratedChart: async (id: CuratedChart['id']) =>
        chart({ id, state: 'empty', message: 'empty' }),
      getAnalyticsWarehouseStatus: async () => ({ configured: true, message: 'ok' }),
    }));
    vi.doMock('../../lib/api/explore', () => ({
      listSavedQueries: async () => [],
      runExploreQuery: async () => ({ columns: [], rows: [], rowCount: 0, truncated: false }),
    }));
    await renderAnalytics();

    expect(await screen.findByText(/No pinned queries/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore');
  });
});
