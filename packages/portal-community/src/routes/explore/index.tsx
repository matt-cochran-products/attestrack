import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ATTESTRACK_EXPLORE_ALLOWED_TABLES,
  ATTESTRACK_EXPLORE_CHART_TYPES,
  ATTESTRACK_EXPLORE_MAX_ROWS,
  type ExploreChartType,
} from '@attestrack/types';
import {
  listSavedQueries,
  pinSavedQuery,
  removeSavedQuery,
  runExploreQuery,
  saveSavedQuery,
  validateExploreSql,
} from '../../lib/api/explore';
import { getAnalyticsWarehouseStatus, type WarehouseStatus } from '../../lib/api/analytics';
import { ApiError } from '../../lib/api/http';
import type { SavedQueryChartConfig, SavedQueryEntry } from '../../lib/api/types';
import { buildExploreChartOption } from '../../lib/charts/echarts-option';
import { downloadCsv } from '../../lib/explore/csv';
import SqlEditor from '../../components/SqlEditor';
import ExploreResultsTable from '../../components/ExploreResultsTable';
import { paths } from '../paths';

const ExploreChart = lazy(() => import('../../components/ExploreChart'));

function formatExploreError(e: unknown): string {
  if (e instanceof ApiError && e.details && typeof e.details === 'object') {
    const body = e.details as { details?: { reason?: string }; reason?: string };
    return body.details?.reason ?? body.reason ?? e.message;
  }
  return e instanceof Error ? e.message : 'Query failed';
}

export default function ExplorePage() {
  const [warehouse, setWarehouse] = useState<WarehouseStatus | null>(null);
  const [sql, setSql] = useState(
    'SELECT eventName, count() AS count FROM events GROUP BY eventName LIMIT 100',
  );
  const [saveName, setSaveName] = useState('');
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [saved, setSaved] = useState<SavedQueryEntry[]>([]);

  // EXP.8 — visualisation is user-directed: table is the default; the user
  // picks the chart type and the column mapping explicitly.
  const [chartType, setChartType] = useState<ExploreChartType>('table');
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [valueColumn, setValueColumn] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAnalyticsWarehouseStatus()
      .then((w) => {
        if (!cancelled) setWarehouse(w);
      })
      .catch(() => {
        if (!cancelled) {
          setWarehouse({ configured: false, message: 'Could not reach the Worker for warehouse status.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      const list = await listSavedQueries();
      setSaved(list);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  const run = useCallback(async () => {
    const v = validateExploreSql(sql);
    if (!v.ok) {
      toast.error(v.reason);
      return;
    }
    setLoading(true);
    try {
      const res = await runExploreQuery(sql);
      setColumns(res.columns);
      setRows(res.rows);
      setTruncated(res.truncated);
      setHasResult(true);
      toast.success('Query completed');
    } catch (e) {
      toast.error(formatExploreError(e));
    } finally {
      setLoading(false);
    }
  }, [sql]);

  const save = async () => {
    const v = validateExploreSql(sql);
    if (!v.ok) {
      toast.error(v.reason);
      return;
    }
    try {
      await saveSavedQuery(saveName.trim() || 'Saved query', sql);
      setSaveName('');
      toast.success('Saved to KV');
      void refreshSaved();
    } catch (e) {
      toast.error(formatExploreError(e));
    }
  };

  const loadSaved = (entry: SavedQueryEntry) => {
    setSql(entry.sql);
    toast.message(`Loaded: ${entry.name}`);
  };

  const delSaved = async (id: string) => {
    try {
      await removeSavedQuery(id);
      void refreshSaved();
      toast.success('Removed');
    } catch (e) {
      toast.error(formatExploreError(e));
    }
  };

  const currentChartConfig: SavedQueryChartConfig = useMemo(
    () => ({
      chartType,
      ...(xColumn ? { xColumn } : {}),
      ...(yColumn ? { yColumn } : {}),
      ...(valueColumn ? { valueColumn } : {}),
    }),
    [chartType, xColumn, yColumn, valueColumn],
  );

  const togglePin = async (entry: SavedQueryEntry) => {
    try {
      await pinSavedQuery(entry.id, !entry.pinned, entry.pinned ? undefined : currentChartConfig);
      toast.success(
        entry.pinned ? 'Unpinned from Analytics' : 'Pinned to Analytics with the current viz',
      );
      void refreshSaved();
    } catch (e) {
      toast.error(formatExploreError(e));
    }
  };

  const chartBuild = useMemo(
    () =>
      chartType === 'table'
        ? null
        : buildExploreChartOption(columns, rows, currentChartConfig),
    [chartType, columns, rows, currentChartConfig],
  );

  // EXP.13 — without a configured analytics destination the editor does not
  // appear; the empty state links to Strategies where it can be configured.
  if (warehouse && !warehouse.configured) {
    return (
      <div className="p-6 space-y-6">
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium">Explore</div>
        <div className="card-surface p-6 border-l-4 border-l-[var(--accent-amber)] max-w-2xl">
          <div className="font-mono text-[12px] text-[var(--accent-amber)] mb-2">
            Analytics destination required
          </div>
          <p className="font-sans text-[13px] text-[var(--text-muted)] mb-2">
            Explore runs read-only SQL against your own ClickHouse or Tinybird. No analytics
            destination is configured yet, so there is nothing to query.
          </p>
          <p className="font-mono text-[10px] text-[var(--text-muted)] mb-4">{warehouse.message}</p>
          <Link
            to={paths.strategies}
            className="font-mono text-[11px] underline text-[var(--accent-green)]"
          >
            Configure an analytics destination in Strategies →
          </Link>
        </div>
      </div>
    );
  }

  if (!warehouse) {
    return (
      <div className="p-6">
        <div className="h-24 bg-[var(--bg-card)] animate-pulse" aria-label="Checking warehouse status" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium">Explore</div>
        <p className="font-sans text-[12px] text-[var(--text-muted)] mt-2 max-w-3xl">
          SELECT-only against your warehouse via the Worker query proxy (EXP.1). Allowlisted
          tables:{' '}
          <span className="text-[var(--text-label)]">
            {ATTESTRACK_EXPLORE_ALLOWED_TABLES.join(', ')}
          </span>
          . Server injects or clamps LIMIT (max {ATTESTRACK_EXPLORE_MAX_ROWS}). Saved queries live
          in your KV (INV-B-17).
        </p>
      </div>

      <div className="card-surface p-4">
        <div className="label mb-2">Saved queries</div>
        {saved.length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--text-muted)]">No saved queries yet.</div>
        ) : (
          <ul className="space-y-2 mb-4">
            {saved.map((q) => (
              <li key={q.id} className="flex items-center gap-2 flex-wrap font-mono text-[10px]">
                <button
                  type="button"
                  className="text-[var(--accent-green)] underline"
                  onClick={() => loadSaved(q)}
                >
                  {q.name}
                </button>
                {q.pinned && (
                  <span className="text-[var(--accent-amber)]" title="Pinned to Analytics">
                    ★ pinned
                  </span>
                )}
                <button type="button" className="text-[var(--text-muted)]" onClick={() => togglePin(q)}>
                  {q.pinned ? 'unpin' : 'pin to Analytics'}
                </button>
                <button type="button" className="text-[var(--text-muted)]" onClick={() => delSaved(q.id)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 flex-wrap items-center">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Label"
            className="bg-[rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.12)] px-2 py-1 font-mono text-[10px] text-[var(--text-active)] min-w-[140px]"
          />
          <button type="button" className="btn-secondary text-[10px]" onClick={save}>
            Save current SQL
          </button>
        </div>
      </div>

      <div className="card-surface p-4">
        <div className="label mb-2">SQL</div>
        <SqlEditor value={sql} onChange={setSql} onRun={run} ariaLabel="Explore SQL editor" />
        <div className="flex gap-3 mt-4 items-center flex-wrap">
          <button type="button" className="btn-primary text-[10px]" disabled={loading} onClick={run}>
            {loading ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            className="btn-secondary text-[10px]"
            onClick={() => downloadCsv('explore-results.csv', columns, rows)}
            disabled={!columns.length}
          >
            Export CSV
          </button>
          <span className="font-mono text-[9px] text-[var(--text-label)]">
            Mod+Enter runs the query · autocomplete: tables + event columns (EXP.6)
          </span>
        </div>
      </div>

      {truncated && (
        <div className="font-mono text-[10px] text-[var(--accent-amber)]" role="status">
          Result truncated at the {ATTESTRACK_EXPLORE_MAX_ROWS}-row server limit (EXP.5).
        </div>
      )}

      {hasResult && (
        <>
          <ExploreResultsTable columns={columns} rows={rows} />

          <div className="card-surface p-4">
            <div className="label mb-2">Visualise (optional — table is the default)</div>
            <div className="flex gap-3 flex-wrap items-center font-mono text-[10px] text-[var(--text-muted)]">
              <label className="flex items-center gap-2">
                Chart
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as ExploreChartType)}
                  className="bg-[rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.12)] p-1 text-[var(--text-active)]"
                >
                  {ATTESTRACK_EXPLORE_CHART_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {chartType !== 'table' && (
                <>
                  <ColumnSelect label="X" value={xColumn} onChange={setXColumn} columns={columns} />
                  <ColumnSelect label="Y" value={yColumn} onChange={setYColumn} columns={columns} />
                  {chartType === 'heatmap' && (
                    <ColumnSelect
                      label="Value"
                      value={valueColumn}
                      onChange={setValueColumn}
                      columns={columns}
                    />
                  )}
                </>
              )}
            </div>

            {chartBuild && !chartBuild.ok && (
              <p className="font-mono text-[10px] text-[var(--text-muted)] mt-3">{chartBuild.reason}</p>
            )}
            {chartBuild?.ok && (
              <div className="mt-4">
                <Suspense fallback={<div className="h-40 bg-[var(--bg-card)] animate-pulse" />}>
                  <ExploreChart option={chartBuild.option} />
                </Suspense>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  columns,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  columns: string[];
}) {
  return (
    <label className="flex items-center gap-2">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.12)] p-1 text-[var(--text-active)]"
      >
        <option value="">—</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
