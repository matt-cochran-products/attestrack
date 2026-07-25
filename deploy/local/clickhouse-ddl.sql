-- attestrue tracking warehouse — local dev / self-host DDL.
--
-- The Worker's ClickHouse strategy (packages/strategies/src/analytics/clickhouse.ts)
-- POSTs one JSON row per tracking event to CLICKHOUSE_HTTP_URL using
-- `INSERT INTO attestrue.tracking_events FORMAT JSONEachRow`. Column names match
-- the row keys EXACTLY (camelCase for the event fields, snake_case for the two
-- derived fields the strategy adds), so JSONEachRow maps them by name.
--
-- Canonical spine = the minimal trackingEventV1 (v, eventName, siteId, occurredAt)
-- + consent/jurisdiction. The remaining columns carry tflo's HIGH-LEVEL SEMANTIC
-- signals (one rich record per real event, not reverse-engineered from noise) —
-- populated once the schema extension (trackingEventV1Schema) ships them.

CREATE DATABASE IF NOT EXISTS attestrue;

CREATE TABLE IF NOT EXISTS attestrue.tracking_events
(
    -- canonical spine
    v                 UInt8,
    eventName         String,
    siteId            String,
    occurredAt        DateTime64(3),           -- ISO-8601 in; needs date_time_input_format=best_effort on insert
    consent_decision  Nullable(String),        -- derived by the strategy (consent gate / event field)
    jurisdiction      Nullable(String),        -- derived by the strategy (resolved / event field)

    -- tflo semantic-signal extension (behavioral, high-level)
    signal            Nullable(String),        -- semantic signal: page_view | cta_click | scroll_depth | section_dwell | web_vital | ...
    sessionId         Nullable(String),
    pagePath          Nullable(String),
    ctaType           Nullable(String),
    scrollDepthPct    Nullable(UInt8),
    section           Nullable(String),
    dwellMs           Nullable(UInt32),
    webVitalName      Nullable(String),
    webVitalValue     Nullable(Float64),
    params            Nullable(String),        -- JSON blob for anything not promoted to a column

    _inserted_at      DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurredAt)
ORDER BY (siteId, occurredAt);
