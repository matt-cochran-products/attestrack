import { validateAndNormalizeExploreSql } from '@attestrack/schema';
import { apiPost, apiGet, isLiveApi } from './http';
import { stubDelay } from './delay';
import { PORTAL_WORKER_PREFIX } from './constants';
import type { ExploreQueryResult, SavedQueryEntry } from './types';

const stubSavedQueries: SavedQueryEntry[] = [];

export function validateExploreSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const r = validateAndNormalizeExploreSql(sql);
  if (!r.ok) {
    return { ok: false, reason: r.reason };
  }
  return { ok: true };
}

async function stubRunExploreQuery(_sql: string): Promise<ExploreQueryResult> {
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
    return apiPost<ExploreQueryResult>(`${PORTAL_WORKER_PREFIX}/explore/query`, { sql });
  }
  return stubRunExploreQuery(sql);
}

async function stubListSavedQueries(): Promise<SavedQueryEntry[]> {
  await stubDelay();
  return [...stubSavedQueries];
}

export async function listSavedQueries(): Promise<SavedQueryEntry[]> {
  if (isLiveApi()) {
    return apiGet<SavedQueryEntry[]>(`${PORTAL_WORKER_PREFIX}/explore/saved-queries`);
  }
  return stubListSavedQueries();
}

export async function saveSavedQuery(name: string, sql: string): Promise<SavedQueryEntry> {
  const v = validateExploreSql(sql);
  if (!v.ok) {
    throw new Error(v.reason);
  }
  if (isLiveApi()) {
    const res = await apiPost<{ success: boolean; query: SavedQueryEntry }>(
      `${PORTAL_WORKER_PREFIX}/explore/saved-queries`,
      { name, sql },
    );
    return res.query;
  }
  await stubDelay();
  const entry: SavedQueryEntry = {
    id: `stub-${stubSavedQueries.length + 1}`,
    name,
    sql,
    updatedAt: new Date().toISOString(),
  };
  stubSavedQueries.push(entry);
  return entry;
}

export async function removeSavedQuery(id: string): Promise<void> {
  if (isLiveApi()) {
    await apiPost(`${PORTAL_WORKER_PREFIX}/explore/saved-queries/remove`, { id });
    return;
  }
  await stubDelay();
  const i = stubSavedQueries.findIndex((q) => q.id === id);
  if (i >= 0) stubSavedQueries.splice(i, 1);
}
