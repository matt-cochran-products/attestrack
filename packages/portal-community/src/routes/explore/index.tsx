import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  listSavedQueries,
  removeSavedQuery,
  runExploreQuery,
  saveSavedQuery,
  validateExploreSql,
} from '../../lib/api/explore';
import { ApiError, isLiveApi } from '../../lib/api/http';
import type { SavedQueryEntry } from '../../lib/api/types';

function formatExploreError(e: unknown): string {
  if (e instanceof ApiError && e.details && typeof e.details === 'object') {
    const body = e.details as { details?: { reason?: string }; reason?: string };
    return body.details?.reason ?? body.reason ?? e.message;
  }
  return e instanceof Error ? e.message : 'Query failed';
}

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const head = columns.map(esc).join(',');
  const body = rows.map((row) => columns.map((c) => esc(row[c])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export default function ExplorePage() {
  const [sql, setSql] = useState('SELECT event_name, count() AS count FROM events GROUP BY event_name LIMIT 100');
  const [saveName, setSaveName] = useState('');
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [saved, setSaved] = useState<SavedQueryEntry[]>([]);

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

  const run = async () => {
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
      toast.success('Query completed');
    } catch (e) {
      toast.error(formatExploreError(e));
    } finally {
      setLoading(false);
    }
  };

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

  const downloadCsv = () => {
    if (!columns.length) {
      return;
    }
    const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'explore-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="font-mono text-[13px] text-[var(--text-active)] font-medium">Explore</div>
        <p className="font-sans text-[12px] text-[var(--text-muted)] mt-2 max-w-3xl">
          SELECT-only against your warehouse via the Worker query proxy (EXP.1). Allowlisted tables:{' '}
          <span className="text-[var(--text-label)]">events, attestrack_events, default</span>. Server injects or clamps
          LIMIT (max 500). Saved queries live in your KV (INV-B-17).
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
                <button type="button" className="text-[var(--accent-green)] underline" onClick={() => loadSaved(q)}>
                  {q.name}
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
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={10}
          className="w-full bg-[rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.12)] p-3 font-mono text-[12px] text-[var(--text-active)]"
          spellCheck={false}
        />
        <div className="flex gap-3 mt-4">
          <button type="button" className="btn-primary text-[10px]" disabled={loading} onClick={run}>
            {loading ? 'Running…' : 'Run'}
          </button>
          <button type="button" className="btn-secondary text-[10px]" onClick={downloadCsv} disabled={!columns.length}>
            Export CSV
          </button>
        </div>
      </div>

      {truncated && (
        <div className="font-mono text-[10px] text-[var(--accent-amber)]">
          Results may be capped at the Worker row limit ({isLiveApi() ? 'live' : 'stub'}).
        </div>
      )}

      {columns.length > 0 && (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.07)]">
                {columns.map((c) => (
                  <th key={c} className="label text-left p-2">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
                  {columns.map((c) => (
                    <td key={c} className="p-2 font-mono text-[10px] text-[var(--text-muted)]">
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
