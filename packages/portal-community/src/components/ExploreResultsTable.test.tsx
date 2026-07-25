// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ExploreResultsTable from './ExploreResultsTable';

const columns = ['eventName', 'count'];
const rows = [
  { eventName: 'page_view', count: 30 },
  { eventName: 'purchase', count: 5 },
  { eventName: 'signup', count: 12 },
];

function firstBodyCell(): string {
  const table = screen.getByRole('table');
  const body = table.querySelector('tbody');
  return body?.querySelector('td')?.textContent ?? '';
}

describe('ExploreResultsTable (EXP.7 — sortable, filterable, paginated table)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all rows and columns by default', () => {
    render(<ExploreResultsTable columns={columns} rows={rows} />);
    expect(screen.getByText('3 rows')).toBeInTheDocument();
    expect(screen.getByText('page_view')).toBeInTheDocument();
    expect(screen.getByText('purchase')).toBeInTheDocument();
    expect(screen.getByText('signup')).toBeInTheDocument();
  });

  it('sorts by column on header click (asc → desc)', () => {
    render(<ExploreResultsTable columns={columns} rows={rows} />);
    const header = screen.getByRole('button', { name: /count/ });
    fireEvent.click(header);
    expect(firstBodyCell()).toBe('purchase'); // count asc: 5 first
    fireEvent.click(header);
    expect(firstBodyCell()).toBe('page_view'); // count desc: 30 first
  });

  it('filters rows via the global filter input', () => {
    render(<ExploreResultsTable columns={columns} rows={rows} />);
    fireEvent.change(screen.getByLabelText('Filter rows'), { target: { value: 'sign' } });
    expect(screen.getByText('1 row')).toBeInTheDocument();
    expect(screen.getByText('signup')).toBeInTheDocument();
    expect(screen.queryByText('page_view')).not.toBeInTheDocument();
  });

  it('paginates beyond the page size', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ eventName: `e${i}`, count: i }));
    render(<ExploreResultsTable columns={columns} rows={many} pageSize={2} />);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('e0')).toBeInTheDocument();
    expect(screen.queryByText('e2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('e2')).toBeInTheDocument();

    const prev = screen.getByRole('button', { name: 'Prev' });
    fireEvent.click(prev);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('exposes aria-sort on sorted headers', () => {
    render(<ExploreResultsTable columns={columns} rows={rows} />);
    const table = screen.getByRole('table');
    const th = within(table).getAllByRole('columnheader')[1];
    expect(th).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(screen.getByRole('button', { name: /count/ }));
    expect(th).toHaveAttribute('aria-sort', 'ascending');
  });
});
