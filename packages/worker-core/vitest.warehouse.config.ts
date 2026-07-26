import { defineConfig } from 'vitest/config'

/**
 * P1.5 warehouse integration project: the ingest → warehouse round-trip
 * against a REAL ClickHouse over HTTP (repo-shipped DDL, strategy insert,
 * Explore gate → executor read-back). Deliberately NOT part of the default
 * `pnpm test` — there is no ClickHouse there. Run via `pnpm test:warehouse`
 * with CLICKHOUSE_TEST_HTTP_URL pointing at an ephemeral container (default
 * http://localhost:8123); CI runs it in the `warehouse` job of ci.yml against
 * a clickhouse/clickhouse-server service container. The suite FAILS when no
 * ClickHouse answers — it never fakes green by skipping.
 */
export default defineConfig({
  test: {
    include: ['__tests__/warehouse/**/*.integration.test.ts'],
    // beforeAll waits for ClickHouse readiness (up to 60s) + applies the DDL.
    hookTimeout: 120_000,
    testTimeout: 30_000
  }
})
