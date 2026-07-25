import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';

/**
 * EXP.7 — results are a data table first: column sorting, basic (global)
 * filtering, and pagination. Visualisation is additive and never replaces
 * the raw table.
 */
export interface ExploreResultsTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  pageSize?: number;
}

export default function ExploreResultsTable({
  columns,
  rows,
  pageSize = 50,
}: ExploreResultsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columnDefs = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((name) => ({
        id: name,
        header: name,
        accessorFn: (row) => row[name],
        cell: (info) => String(info.getValue() ?? ''),
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    // Deterministic toggle order (asc → desc) for every column type.
    sortDescFirst: false,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Filter rows…"
          aria-label="Filter rows"
          className="bg-[rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.12)] px-2 py-1 font-mono text-[10px] text-[var(--text-active)] min-w-[160px]"
        />
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {filteredCount} row{filteredCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[400px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-[rgba(255,255,255,0.07)]">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="label text-left p-2"
                      aria-sort={
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true">
                          {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-[rgba(255,255,255,0.05)]">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2 font-mono text-[10px] text-[var(--text-muted)]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--text-muted)]">
          <button
            type="button"
            className="btn-secondary text-[10px]"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </button>
          <span>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="btn-secondary text-[10px]"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
