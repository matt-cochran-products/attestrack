/**
 * EXP.11 — CSV export is generated in the browser from the result data only;
 * nothing is routed through any Attestrack/Attestrue server.
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
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

/** Trigger a client-side download of the CSV blob. */
export function downloadCsv(filename: string, columns: string[], rows: Record<string, unknown>[]): void {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
