/** Allowed physical table names for OSS Explore (INV-B-15); keep aligned with worker `explore-gate`.
 *  NOTE: bare TABLE names only — never a database. `default` was removed: it is a ClickHouse
 *  *database*, and allowlisting it let `SELECT * FROM default.<any_table>` slip past the gate. */
export const ATTESTRACK_EXPLORE_ALLOWED_TABLES = ['events', 'attestrack_events'] as const

export type AttestrackExploreAllowedTable = (typeof ATTESTRACK_EXPLORE_ALLOWED_TABLES)[number]

/** Server-enforced cap on rows returned from Explore (Worker injects or clamps LIMIT). */
export const ATTESTRACK_EXPLORE_MAX_ROWS = 500
