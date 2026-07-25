# Repository specification — OSS (v0)

**Binding for:** the public `attestrack` monorepo — `github.com/matt-cochran/attestrack` (`@attestrack/worker-core`, `@attestrack/portal-community`, `@attestrack/deploy`, etc.).  
**Not:** full Core ConOps, proprietary Repo Spec, or Portal Community Spec referenced from [BEHAVORIAL-SPEC.md](BEHAVORIAL-SPEC.md).

**Canonical machine list:** [oss-http-contract.json](oss-http-contract.json) — validated by `pnpm route-contract-check` against Worker source.

---

## HTTP routes (Worker)

### Top-level (outside portal prefix)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/health` | `200` plain `ok` |
| GET | `/privacy` | Plain text from KV `attestrack:policy:privacy` or default placeholder |
| GET | `/terms` | Plain text from KV `attestrack:policy:terms` or default placeholder |
| GET | `/consent.js` | Embedded `@attestrack/consent-js` IIFE bundle (built-in at Worker build time); `ETag` = content hash, `304` on `If-None-Match`, public cache headers |
| GET | `/__attestrack__/consent/context` | Resolved jurisdiction context for the banner: `{ siteId, mode, jurisdictionKey, row, policyRefs }`; credentialed CORS |
| POST | `/__attestrack__/consent/commit` | JSON body validated with `consentCommitRequestSchema` (incl. optional `ioaAccepted`); returns `{ token }` (token carries `expiresAt` from site config `state1TokenTTL`) **and** `Set-Cookie: at_consent=…; Domain=<site config cookieDomain ?? domain>; Path=/; Max-Age=<TTL>; Secure; SameSite=Lax` (Domain omitted when the Worker host is outside that domain) |
| POST | `/t/event` | `trackingEventV1Schema`; accepts immediately; pipeline runs in `scheduleBackground`; credentialed CORS |
| OPTIONS | commit / context / `/t/event` | CORS preflight; allowlist derived from site config `domain` + `trustedDomains` (https-only; loopback origins only when explicitly listed; no wildcard reflection) |
| GET | *other* | Runs mandatory + destination + analytics pipeline; JSON `{ ok, consentDecision }` |

Constants: `TRACKING_EVENT_PATH` in [packages/worker-core/src/constants.ts](../packages/worker-core/src/constants.ts), consent path literals in [create-fetch-handler.ts](../packages/worker-core/src/create-fetch-handler.ts).

**Consent pipeline semantics (P2.3):** site config `mode` is read once per request; `SHADOW` (and any unconfigured/unknown mode — INV-B-03) never blocks destinations but records the would-be ENFORCEMENT decision (`consentWouldAllow` on the tracking row); `ENFORCEMENT` applies the gate. Jurisdiction rows with `mechanism: 'opt-out'` allow destinations absent a declined/withdrawn token; GPC (`Sec-GPC: 1`) is honored per row (`gpc_honor`) as an opt-out signal. Tokens are `k<N>.<payload>.<sig>` HMAC envelopes with verify-time expiry + `siteId` binding; rotation via `CONSENT_TOKEN_SECRET_PREVIOUS` (values may carry a `k<N>.` key-id prefix).

### Portal API

**Prefix:** `/__attestrack__/portal/v1` (`PORTAL_API_PREFIX` in [packages/worker-core/src/portal.ts](../packages/worker-core/src/portal.ts)).

Subpaths are listed in `oss-http-contract.json` (`portalSubpaths`). Endpoints that return **`403` + `requires_attestrue`** are listed under `portalSubpathsRequiresAttestrue` — authoritative implementations live in **attestrue-premium** after upgrade (licensed repo, `docs/EXTENSION-PORTAL-API.md` — plain-text citation; not linkable from this repository). The community portal client **must** use the same prefix ([packages/portal-community/src/lib/api/constants.ts](../packages/portal-community/src/lib/api/constants.ts)).

### Portal observability data sources (P3)

Machine list: `oss-http-contract.json` → `portalDataSources` (enforced by `pnpm route-contract-check`: `/dashboard` must stay computed; a regression to seeded KV JSON fails CI). Launch rule: **no chart or figure backed by invented numbers** — every value below is recorded on real traffic or the view says so.

| Subpath | Source | Notes |
|---------|--------|-------|
| GET `/dashboard` | **Computed** ([observability.ts](../packages/worker-core/src/observability.ts) `computeDashboardMetrics`) | `eventsToday` from the sampled per-UTC-day counter `attestrack:obs:events:<day>` (1-in-10 sampling above 5 000/day → approximate at high volume); `driftAlertCount`/`driftAlert` from `attestrack:drift:mismatch`; `strategyStatus`/`strategySummary` from per-strategy delivery stats |
| GET `/destinations` | **Computed** (`buildDestinationRows`) | Per-strategy delivery stats `attestrack:obs:delivery:<id>` (ok/error totals + same-UTC-day window, `lastOkAt`/`lastErrorAt`/`lastError`) recorded by every bundled sink and ad destination; `auth` from Worker secret presence; configured-but-quiet endpoints report `no_data`, never fake health |
| GET `/logs`, `/logs/incoming` | **Computed** (`readRecentLogs`) | Bounded per-hour KV log ring `attestrack:obs:log:<YYYY-MM-DDTHH>` (60 entries/hour, 48 h TTL, best-effort writer that never throws) appended on each `/t/event` ingest; consent/status columns derive from the real consent gate (`GRANTED`/`DECLINED`/`GPC_DECLINED`/`SHADOW_NONE`; `PROCESSED`/`BLOCKED_ENFORCEMENT`/`BOT_FILTERED`) |
| GET `/signal`, `/signal-recovery` | **De-scoped v1 (P3.3)** | Returns `{ measured: false, reason: 'requires_beacon', message, botRequestsFiltered }`. Recovery comparisons need a client beacon Attestrack does not ship yet; the bot counter `attestrack:obs:bots:<day>` (troll-shield) is the only real figure |
| GET `/signal-recovery/timeline` | **De-scoped v1** | Always `[]` — never invented points |
| GET `/alert-rules` | KV (`attestrack:portal:alert_rules`, operator config) | A synthetic `consent-config` row is prepended while `attestrack:drift:mismatch` is active (P3.5) |

Counters/logs are best-effort KV read-modify-write: values are **approximate lower bounds** under concurrency and must not be treated as billing-grade.

---

## JSON error contract (fail fast, triage-friendly)

Worker JSON responses use stable `error` string codes and optional structured `details` (e.g. Zod `flatten()`).

| Code | Typical status | Meaning |
|------|----------------|---------|
| `consent_secret_not_configured` | 503 | Secret binding missing |
| `invalid_json` | 400 | Body not JSON |
| `invalid_body` | 400 | Schema validation failed; `details` present |
| `invalid_sql` | 400 | Explore proxy rejected SQL; top-level `reason` + `details.code` / `details.reason` (triage) |
| `explore_warehouse_not_configured` | 503 | No `TINYBIRD_TOKEN` or ClickHouse query base |
| `explore_warehouse_http_error` | 4xx/502 | Upstream warehouse error; `details.reason` truncated |
| `explore_warehouse_fetch_failed` | 502 | Network failure calling warehouse |
| `explore_warehouse_rejected` | 400 | ClickHouse returned `exception` in JSON body |
| `explore_warehouse_bad_response` | 502 | Non-JSON warehouse response |
| `invalid_mode` | 400 | Site mode enum (reserved; OSS does not accept mode POST — see `requires_attestrue`) |
| `invalid_domains` | 400 | Trusted domains payload |
| `requires_attestrue` | 403 | Banner, policy, enforcement mode, and related portal mutations are **Attestrue**; response includes `handoff` URL |
| `not_found` | 404 | Unknown portal subpath |
| `method_not_allowed` | 405 | Wrong method for portal |

Do not replace these with generic messages without updating REPO-SPEC-OSS and contract tests.

---

## KV registry

Authoritative key names: [packages/types/src/kv-keys.ts](../packages/types/src/kv-keys.ts).  
Deploy seed shape: [packages/deploy/src/kv-schema.ts](../packages/deploy/src/kv-schema.ts).

**Enabled strategies:** `attestrack:enabled_strategies` (`KV_KEY_ENABLED_STRATEGIES`) — JSON array of strategy **ids**. The Worker applies this to **`destination` and `analytics` stages only**; **mandatory** strategies always run. If the key is missing or invalid JSON, all bundled optional strategies remain eligible. The deploy seed defaults to analytics + drift only (`clickhouse`, `tinybird`, `drift-detection`); add destination ids (e.g. `meta-capi`) when you configure ad-network secrets.

**Observability keys (P3, written by the Worker — never seed these by hand):** `attestrack:obs:log:<hour>` (bounded request-log ring), `attestrack:obs:events:<day>` (sampled ingest counter), `attestrack:obs:delivery:<strategyId>` (per-strategy delivery stats), `attestrack:obs:bots:<day>` (troll-shield counter). The pre-P3 seeded portal keys for dashboard/destinations/logs/signal were **removed** — those endpoints are computed (see Portal observability data sources above).

**Drift keys (P3.5):** the deploy seed writes `attestrack:drift:expected_fingerprint` = SHA-256 of the consent-config JSON exactly as seeded; the drift-detection strategy recomputes `attestrack:drift:current_fingerprint` on traffic and writes a TTL'd `attestrack:drift:mismatch` `{ at, expected, current }` on divergence, which drives the portal drift banner, dashboard count, and the synthetic alert-rule row.

---

## Portal operator UX — stub vs live

When `VITE_ATTESTRACK_API_BASE_URL` is unset, the portal **must** use local stubs (see [packages/portal-community/src/lib/api/http.ts](../packages/portal-community/src/lib/api/http.ts)). The shell shows **Local stub data** vs **Live worker** next to the mode chip ([`Layout.tsx`](../packages/portal-community/src/components/Layout.tsx)).

---

## Explore (INV-B-14 / INV-B-15 / INV-B-17)

- **Gate:** Shared SQL validation in [`@attestrack/schema`](../packages/schema/src/explore-sql.ts) — single `SELECT`, allowlisted **bare** tables (`events`, `attestrack_events`; qualified `db.table` names rejected, `default` removed from the allowlist), no `UNION`, no `FROM (` subqueries, injected/clamped `LIMIT` (max `ATTESTRACK_EXPLORE_MAX_ROWS` = 500 in [`@attestrack/types`](../packages/types/src/explore.ts)).
- **Warehouse:** `POST …/explore/query` runs against **Tinybird** if `TINYBIRD_TOKEN` is set (optional `TINYBIRD_API_URL`, default `https://api.tinybird.co`), else **ClickHouse** if `CLICKHOUSE_QUERY_URL` or `CLICKHOUSE_HTTP_URL` (origin used as query base). Uses `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` when set. POST body: `FORMAT JSON` over HTTP.
- **Saved queries:** `GET` / `POST` `/explore/saved-queries`, `POST` `/explore/saved-queries/remove` — stored under `attestrack:portal:saved_queries` ([`kv-keys.ts`](../packages/types/src/kv-keys.ts)).

---

## Explicit non-goals (OSS)

- **Portal API** for **banner config**, **policy version publish**, **enforcement mode toggle** — OSS Worker returns **`requires_attestrue`**; licensed extension owns mutations ([ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md)).
- Full **D1 evidence chain**, **Proof** (CETS v1.1 **trust chain**: `record_id`, Ed25519 witness, dual **`proof-anchors`** — see licensed **Consent Evidence Trust Chain Specification**), attorney-maintained **regulation packs** (see [ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md), [ADR-002](../ADR/ADR-002-evidence-licensed-only.md), `pnpm boundary-check`).
- **Explore** parity with full enterprise SQL consoles (arbitrary joins, all schemas, saved-query sharing across sites) — community tier stays allowlisted and single-statement.
- Duplicating proprietary **Core ConOps** text — use [CONOPS-OSS-SNAPSHOT.md](CONOPS-OSS-SNAPSHOT.md) for observable pipeline behavior only.
