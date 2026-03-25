import { useState } from 'react';
import { toast } from 'sonner';
import { runExploreQuery, validateExploreSql } from '../../lib/api/explore';

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
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [truncated, setTruncated] = useState(false);

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
      toast.error(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setLoading(false);
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
          SELECT-only against your warehouse via the Worker query proxy (EXP.1). Client-side validation is not a
          substitute for server allowlists and row caps. Query text and results are not sent to Attestrue when the proxy
          is correctly deployed (INV-B-14–INV-B-17).
        </p>
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
        <div className="font-mono text-[10px] text-[var(--accent-amber)]">Results truncated to row cap (stub).</div>
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
