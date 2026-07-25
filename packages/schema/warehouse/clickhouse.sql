-- Attestrack canonical analytics warehouse — ClickHouse DDL.
--
-- The Worker's ClickHouse analytics strategy
-- (packages/strategies/src/analytics/clickhouse.ts) writes one row per tracking
-- event with `INSERT INTO events FORMAT JSONEachRow`, so the column names below
-- match the `TrackingEventV1` JSON keys EXACTLY (JSONEachRow maps by name). The
-- resolved consent fields (consentDecision/jurisdiction) and the pipeline
-- recording fields (consentMode/consentMechanism) are added by the strategy.
--
-- occurredAt is an ISO-8601 string on the wire → the strategy inserts with
-- `date_time_input_format=best_effort` so it parses into DateTime64.
--
-- LEAST PRIVILEGE (recommended): create TWO ClickHouse users —
--   * an INSERT-only user for the Worker (CLICKHOUSE_USER/PASSWORD secret) with
--     grants: INSERT ON <db>.events;
--   * a read-only user for Explore (CLICKHOUSE_EXPLORE_USER) with SELECT ON
--     <db>.events only — never SELECT on system.* or other databases (the
--     Explore SQL gate enforces bare allowlisted tables, but DB grants are the
--     real backstop).

CREATE TABLE IF NOT EXISTS events
(
    v                 UInt8,
    eventName         String,
    siteId            String,
    occurredAt        DateTime64(3),

    -- consent (resolved by the pipeline)
    consentDecision   Nullable(String),
    jurisdiction      Nullable(String),
    consentMode       Nullable(String),   -- shadow | enforcement (recorded, P2)
    consentMechanism  Nullable(String),   -- opt-in | opt-out (recorded, P2)

    -- identity / attribution (first-party only; no raw UA/IP)
    visitorId         Nullable(String),
    sessionId         Nullable(String),
    eventId           Nullable(String),   -- client idempotency key
    pagePath          Nullable(String),
    referrer          Nullable(String),
    utmSource         Nullable(String),
    utmMedium         Nullable(String),
    utmCampaign       Nullable(String),
    utmTerm           Nullable(String),
    utmContent        Nullable(String),
    userAgentClass    Nullable(String),   -- desktop | mobile | tablet | bot | other

    -- behavioral / semantic signals
    ctaType           Nullable(String),
    scrollDepthPct    Nullable(UInt8),
    section           Nullable(String),
    dwellMs           Nullable(UInt32),
    webVitalName      Nullable(String),
    webVitalValue     Nullable(Float64),
    params            Nullable(String),   -- bounded JSON blob

    receivedAt        DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurredAt)
ORDER BY (siteId, occurredAt);
