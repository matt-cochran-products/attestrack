# ADR-013: Warehouse Contract — Repo-Shipped Canonical `events` DDL

**Status:** Accepted (implemented in Phase 1, merged to `dev` as `b359064`)
**Date:** 2026-07-25

## Context

Attestrack's headline claim is that analytics stay **queryable and yours**: `/t/event` → the operator's own ClickHouse (or Tinybird). That claim is empty unless somebody owns the table schema. Before Phase 1, the repo shipped no DDL, and the ClickHouse strategy POSTed a raw JSON row with no `INSERT` statement — broken against a vanilla ClickHouse HTTP endpoint (production plan §1.4 #2). The Explore proxy (INV-B-14/15) also needs a known table surface to allowlist.

## Decision

**This repository owns and ships the canonical warehouse contract.**

1. **Canonical DDL:** `packages/schema/warehouse/clickhouse.sql` — `CREATE TABLE IF NOT EXISTS events (...) ENGINE = MergeTree PARTITION BY toYYYYMM(occurredAt) ORDER BY (siteId, occurredAt)`. Column names match `TrackingEventV1` JSON keys exactly (JSONEachRow maps by name), including the consent-honesty fields recorded by the pipeline (`consentDecision`, `jurisdiction`, `consentMode`, `consentMechanism`, `consentWouldAllow`) and first-party attribution fields (`visitorId`, `sessionId`, `eventId`, `pagePath`, `referrer`, `utm*`, `userAgentClass`, behavioral signals, bounded `params`).
2. **Write path:** `packages/strategies/src/analytics/clickhouse.ts` builds `INSERT INTO events FORMAT JSONEachRow` as an HTTP query parameter (with `date_time_input_format=best_effort` so ISO-8601 `occurredAt` parses into `DateTime64`), and projects the event through an **explicit column map** (`toClickHouseRow` — no blind spread; unknown fields never reach the warehouse). Operators may embed their own `query=` in `CLICKHOUSE_HTTP_URL` to target a self-managed table. Non-2xx/network failures are recorded to a KV delivery-error counter (feeds STR.4 surfacing, Phase 3).
3. **Least-privilege grants (documented in the DDL header):** two ClickHouse users —
   - an **INSERT-only** user for the Worker (`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD` secrets): `GRANT INSERT ON <db>.events`;
   - a **read-only** user for Explore: `GRANT SELECT ON <db>.events` only — never `system.*` or other databases. The Explore SQL gate (single `SELECT`, bare allowlisted tables `events`/`attestrack_events`, qualified `db.table` names rejected, clamped `LIMIT`) is defense-in-depth; **database grants are the real backstop**.
4. **Explore alignment:** the gate's table allowlist (`ATTESTRACK_EXPLORE_ALLOWED_TABLES`, `packages/types/src/explore.ts`) is defined against this DDL's table name.
5. **Tinybird:** supported as an alternative sink via its Events API (`packages/strategies/src/analytics/tinybird.ts`, `TINYBIRD_TOKEN`/`TINYBIRD_DATASOURCE`); a repo-shipped Tinybird datasource definition file is **not yet included** — operators map the same JSON keys. (Open item; tracked under plan P1.2.)

## Consequences

### Positive
- Clean deploy → `CREATE TABLE` from the repo DDL → curl an event → `SELECT count() FROM events` in Explore works; the schema is a public, versionable contract.
- Explicit projection means schema evolution is a deliberate edit to `toClickHouseRow` + DDL together, not an accidental spread.
- Grants guidance makes the read-only Explore invariant (INV-B-14) enforceable at the database, not just the gate.

### Negative
- The DDL is a long-lived public contract: column changes now require additive migration discipline (new columns `Nullable`/defaulted; never repurpose names).
- Two sinks (ClickHouse, Tinybird) must be kept column-compatible by hand until a shared datasource definition ships.

### Neutral
- `deploy/local/clickhouse-ddl.sql` exists as a local-dev convenience copy; `packages/schema/warehouse/clickhouse.sql` is canonical.

## Structural Assertions

1. `packages/schema/warehouse/clickhouse.sql` SHALL be the canonical `events` schema; the ClickHouse strategy's column map SHALL match it exactly.
2. The write path SHALL use an explicit event → column projection (no object spread into the warehouse row).
3. Documentation SHALL recommend separate insert-only and read-only warehouse users (least privilege) for Worker vs Explore.

## FMECA Cross-References

No direct FMECA failure mode. Closes the production plan §1.4 #2 analytics-value gap (schema ownership + broken ClickHouse insert) and underpins INV-B-14/15 enforcement.
