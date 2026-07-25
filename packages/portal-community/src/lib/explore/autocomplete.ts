import {
  ATTESTRACK_EVENT_COLUMNS,
  ATTESTRACK_EXPLORE_ALLOWED_TABLES,
} from '@attestrack/types';

/**
 * EXP.6 — schema autocomplete source for the Explore SQL editor.
 *
 * Tables come from the Explore allowlist (INV-B-15) and columns from the
 * `@attestrack/types` event schema (compile-time lockstep with
 * `TrackingEventV1` + the warehouse DDL), so autocomplete can never suggest a
 * table the server-side gate would reject.
 */
export function buildSqlAutocompleteSchema(): Record<string, string[]> {
  const columns = [...ATTESTRACK_EVENT_COLUMNS];
  return Object.fromEntries(
    ATTESTRACK_EXPLORE_ALLOWED_TABLES.map((table) => [table, columns]),
  );
}

/** Default table offered by the editor (`FROM ` completion + bare-column scope). */
export const SQL_DEFAULT_TABLE: string = ATTESTRACK_EXPLORE_ALLOWED_TABLES[0];
