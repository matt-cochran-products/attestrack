// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/api/delay', () => ({
  stubDelay: () => Promise.resolve(),
}));

// CodeMirror needs real DOM measurement — replace with a plain textarea so the
// page contract (EXP.13 gating, run flow, truncation notice) is what's tested.
function mockSqlEditor() {
  vi.doMock('../../components/SqlEditor', () => ({
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <textarea
        aria-label="Explore SQL editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  }));
}

async function renderExplore() {
  const { MemoryRouter } = await import('react-router-dom');
  const { default: ExplorePage } = await import('./index');
  render(
    <MemoryRouter initialEntries={['/explore']}>
      <ExplorePage />
    </MemoryRouter>,
  );
}

describe('Explore page (EXP.5/EXP.8/EXP.13 surfaces)', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('../../lib/api/analytics');
    vi.doUnmock('../../lib/api/explore');
    vi.doUnmock('../../components/SqlEditor');
    vi.resetModules();
  });

  it('EXP.13 — without a configured analytics destination the editor does not appear and the empty state links to Strategies', async () => {
    mockSqlEditor();
    vi.doMock('../../lib/api/analytics', () => ({
      getAnalyticsWarehouseStatus: async () => ({
        configured: false,
        message: 'Configure TINYBIRD_TOKEN or CLICKHOUSE_QUERY_URL on the Worker.',
      }),
    }));
    await renderExplore();

    expect(await screen.findByText('Analytics destination required')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Strategies/ });
    expect(link).toHaveAttribute('href', '/strategies');
    expect(screen.queryByLabelText('Explore SQL editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
  });

  it('EXP.5 — a truncated result shows the 500-row server-limit notice; EXP.8 — table stays the default view', async () => {
    mockSqlEditor();
    vi.doMock('../../lib/api/analytics', () => ({
      getAnalyticsWarehouseStatus: async () => ({ configured: true, message: 'ok' }),
    }));
    vi.doMock('../../lib/api/explore', () => ({
      validateExploreSql: () => ({ ok: true }),
      runExploreQuery: async () => ({
        columns: ['eventName', 'count'],
        rows: [{ eventName: 'page_view', count: 12040 }],
        rowCount: 1,
        truncated: true,
      }),
      listSavedQueries: async () => [],
      saveSavedQuery: async () => ({ id: 'x', name: 'x', sql: 'x', updatedAt: 'now' }),
      removeSavedQuery: async () => undefined,
      pinSavedQuery: async () => ({ id: 'x', name: 'x', sql: 'x', updatedAt: 'now' }),
    }));
    await renderExplore();

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    expect(
      await screen.findByText(/truncated at the 500-row server limit/i),
    ).toBeInTheDocument();
    // Result renders as a table (EXP.7) with the row present.
    expect(screen.getByText('page_view')).toBeInTheDocument();
    // EXP.8 — the chart selector defaults to table and no chart is auto-rendered.
    const select = screen.getByLabelText(/Chart/) as HTMLSelectElement;
    expect(select.value).toBe('table');
    expect(screen.queryByRole('img', { name: /chart/i })).not.toBeInTheDocument();
  });

  it('EXP.10 — saved queries expose pin/unpin actions', async () => {
    mockSqlEditor();
    vi.doMock('../../lib/api/analytics', () => ({
      getAnalyticsWarehouseStatus: async () => ({ configured: true, message: 'ok' }),
    }));
    const pinSpy = vi.fn(async () => ({
      id: 'q1',
      name: 'Q1',
      sql: 'SELECT 1 FROM events',
      updatedAt: 'now',
      pinned: true,
    }));
    vi.doMock('../../lib/api/explore', () => ({
      validateExploreSql: () => ({ ok: true }),
      runExploreQuery: async () => ({ columns: [], rows: [], rowCount: 0, truncated: false }),
      listSavedQueries: async () => [
        { id: 'q1', name: 'Q1', sql: 'SELECT 1 FROM events', updatedAt: 'now', pinned: false },
      ],
      saveSavedQuery: async () => ({ id: 'x', name: 'x', sql: 'x', updatedAt: 'now' }),
      removeSavedQuery: async () => undefined,
      pinSavedQuery: pinSpy,
    }));
    await renderExplore();

    fireEvent.click(await screen.findByRole('button', { name: 'pin to Analytics' }));
    expect(pinSpy).toHaveBeenCalledWith('q1', true, expect.objectContaining({ chartType: 'table' }));
  });
});
