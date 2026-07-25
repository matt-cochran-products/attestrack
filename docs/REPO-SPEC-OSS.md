# Repository specification — OSS (v0)

**Binding for:** the public `attestrue` monorepo (`@attestrack/worker-core`, `@attestrack/portal-community`, `@attestrack/deploy`, etc.).  
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
| POST | `/__attestrack__/consent/commit` | JSON body validated with `consentCommitRequestSchema`; returns `{ token }` or JSON error |
| POST | `/t/event` | `trackingEventV1Schema`; accepts immediately; pipeline runs in `scheduleBackground` |
| GET | *other* | Runs mandatory + destination + analytics pipeline; JSON `{ ok, consentDecision }` |

Constants: `TRACKING_EVENT_PATH` in [packages/worker-core/src/constants.ts](../packages/worker-core/src/constants.ts), consent path literals in [create-fetch-handler.ts](../packages/worker-core/src/create-fetch-handler.ts).

### Portal API

**Prefix:** `/__attestrack__/portal/v1` (`PORTAL_API_PREFIX` in [packages/worker-core/src/portal.ts](../packages/worker-core/src/portal.ts)).

Subpaths are listed in `oss-http-contract.json` (`portalSubpaths`). Endpoints that return **`403` + `requires_attestrue`** are listed under `portalSubpathsRequiresAttestrue` — authoritative implementations live in **attestrue-premium** after upgrade ([`EXTENSION-PORTAL-API.md` in premium repo](../../attestrue-premium/docs/EXTENSION-PORTAL-API.md)). The community portal client **must** use the same prefix ([packages/portal-community/src/lib/api/constants.ts](../packages/portal-community/src/lib/api/constants.ts)).

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

---

## Portal operator UX — stub vs live

When `VITE_ATTESTRACK_API_BASE_URL` is unset, the portal **must** use local stubs (see [packages/portal-community/src/lib/api/http.ts](../packages/portal-community/src/lib/api/http.ts)). The shell shows **Local stub data** vs **Live worker** next to the mode chip ([`Layout.tsx`](../packages/portal-community/src/components/Layout.tsx)).

---

## Explore (INV-B-14 / INV-B-15 / INV-B-17)

- **Gate:** Shared SQL validation in [`@attestrack/schema`](../packages/schema/src/explore-sql.ts) — single `SELECT`, allowlisted tables (`events`, `attestrack_events`, `default`), no `UNION`, no `FROM (` subqueries, injected/clamped `LIMIT` (max `ATTESTRACK_EXPLORE_MAX_ROWS` in [`@attestrack/types`](../packages/types/src/explore.ts)).
- **Warehouse:** `POST …/explore/query` runs against **Tinybird** if `TINYBIRD_TOKEN` is set (optional `TINYBIRD_API_URL`, default `https://api.tinybird.co`), else **ClickHouse** if `CLICKHOUSE_QUERY_URL` or `CLICKHOUSE_HTTP_URL` (origin used as query base). Uses `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` when set. POST body: `FORMAT JSON` over HTTP.
- **Saved queries:** `GET` / `POST` `/explore/saved-queries`, `POST` `/explore/saved-queries/remove` — stored under `attestrack:portal:saved_queries` ([`kv-keys.ts`](../packages/types/src/kv-keys.ts)).

---

## Explicit non-goals (OSS)

- **Portal API** for **banner config**, **policy version publish**, **enforcement mode toggle** — OSS Worker returns **`requires_attestrue`**; licensed extension owns mutations ([ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md)).
- Full **D1 evidence chain**, **Proof** (CETS v1.1 **trust chain**: `record_id`, Ed25519 witness, dual **`proof-anchors`** — see licensed **Consent Evidence Trust Chain Specification**), attorney-maintained **regulation packs** (see [ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md), [ADR-002](../ADR/ADR-002-evidence-licensed-only.md), `pnpm boundary-check`).
- **Explore** parity with full enterprise SQL consoles (arbitrary joins, all schemas, saved-query sharing across sites) — community tier stays allowlisted and single-statement.
- Duplicating proprietary **Core ConOps** text — use [CONOPS-OSS-SNAPSHOT.md](CONOPS-OSS-SNAPSHOT.md) for observable pipeline behavior only.
