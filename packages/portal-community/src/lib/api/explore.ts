import { apiPost, isLiveApi } from './http';
import { stubDelay } from './delay';
import type { ExploreQueryResult } from './types';

const SELECT_ONLY = /^\s*select\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i;

export function validateExploreSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Query is empty.' };
  }
  if (!SELECT_ONLY.test(trimmed)) {
    return { ok: false, reason: 'Only SELECT queries are allowed.' };
  }
  if (FORBIDDEN.test(trimmed)) {
    return { ok: false, reason: 'Statement contains forbidden keywords.' };
  }
  return { ok: true };
}

async function stubRunExploreQuery(sql: string): Promise<ExploreQueryResult> {
  await stubDelay();
  return {
    columns: ['event_name', 'count'],
    rows: [
      { event_name: 'page_view', count: 12040 },
      { event_name: 'purchase', count: 891 },
    ],
    rowCount: 2,
    truncated: false,
  };
}

export async function runExploreQuery(sql: string): Promise<ExploreQueryResult> {
  const v = validateExploreSql(sql);
  if (!v.ok) {
    throw new Error(v.reason);
  }
  if (isLiveApi()) {
    return apiPost<ExploreQueryResult>('/api/portal/explore/query', { sql });
  }
  return stubRunExploreQuery(sql);
}
