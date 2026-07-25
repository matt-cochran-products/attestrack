# Self-hosting Attestrack

The single guide for running Attestrack in production on **your own Cloudflare account**:
what gets deployed, the warehouse, every secret, CORS/cookie topology, locking down the
portal, and troubleshooting. The step-by-step deploy-CLI walkthrough lives in
[PILOT-OSS.md](PILOT-OSS.md) — this guide cross-links it rather than repeating it.

## What you deploy

Everything runs under **your** credentials — there are no Attestrack-hosted servers in the
event path, and no egress except to the destinations you configure (`pnpm egress-check`
enforces this; see [THREAT-MODEL.md](THREAT-MODEL.md)).

| Piece | Where | What it does |
|---|---|---|
| Worker (`@attestrack/worker-core` + bundled strategies) | Your Cloudflare account | First-party endpoint: `/t/event` ingest, consent routes, `/consent.js`, portal API, Explore proxy |
| KV namespace | Your Cloudflare account | Config, consent-event records, observability counters — see the [KV registry](API-REFERENCE.md#kv-key-registry) |
| Operator portal (`@attestrack/portal-community`) | Cloudflare Pages (optional, `--skip-portal` to omit) | Dashboards, destinations, logs, Explore |
| Warehouse | Your ClickHouse or Tinybird | Canonical `events` table — analytics stay queryable and yours |

## 1. Deploy

Follow [PILOT-OSS.md](PILOT-OSS.md) — one guided command:

```bash
npx @attestrack/deploy          # standalone, once packages are on npm (pre-launch: use dev mode)
npx @attestrack/deploy verify   # post-deploy checks
```

or from a repo clone (dev mode): `pnpm --filter @attestrack/deploy exec attestrack-deploy`.
The CLI creates/reuses the KV namespace, writes the scaffold (`attestrack-deploy/`), seeds
KV, prompts for `CONSENT_TOKEN_SECRET`, deploys the Worker, and optionally builds and
deploys the portal. Flags, re-run diffs, upgrades, and rollback:
[PILOT-OSS.md](PILOT-OSS.md).

## 2. Warehouse

The repo ships the canonical `events` DDL:
[`packages/schema/warehouse/clickhouse.sql`](../packages/schema/warehouse/clickhouse.sql)
([ADR-013](../ADR/ADR-013-warehouse-contract.md)). Column names match `TrackingEventV1`
JSON keys exactly — the ClickHouse strategy inserts `FORMAT JSONEachRow`, mapping by name.

**ClickHouse**

1. Apply the DDL: `clickhouse-client < packages/schema/warehouse/clickhouse.sql`
2. Create **two** users (least privilege, per the DDL header):
   - an INSERT-only user for the Worker (`CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD`) with
     `GRANT INSERT ON <db>.events`
   - a read-only user for Explore with `GRANT SELECT ON <db>.events` only — never
     `system.*` or other databases. The Explore SQL gate enforces bare allowlisted tables
     (`events`, `attestrack_events`), but **DB grants are the real backstop**.
3. Set the Worker secrets (§3): `CLICKHOUSE_HTTP_URL` (insert path) and
   `CLICKHOUSE_QUERY_URL` (Explore query base).

**Tinybird** — create a datasource matching the same columns and set `TINYBIRD_TOKEN`
(plus `TINYBIRD_DATASOURCE`, optional `TINYBIRD_API_URL`, default `https://api.tinybird.co`).
The Worker uses the Tinybird Events API for inserts and `/v0/sql` for Explore. When both
warehouses are configured, Explore prefers Tinybird.

## 3. Worker secrets

Set with `wrangler secret put <NAME>` from `attestrack-deploy/` (the scaffold README
carries the same list). The deploy CLI prompts for the required one and never echoes
values.

| Secret | Required | Used for |
|---|---|---|
| `CONSENT_TOKEN_SECRET` | **Yes** | HMAC signing of consent tokens. 32+ characters recommended; hard floor 16 bytes (`503 consent_secret_too_weak` below it) |
| `CONSENT_TOKEN_SECRET_PREVIOUS` | Rotation only | Previous signing secret(s) so older tokens stay valid until TTL; values may carry a `k<N>.` key-id prefix — see [token rotation](API-REFERENCE.md#consent-token-format-community-tier) |
| `PORTAL_API_SHARED_SECRET` | Recommended | Defense-in-depth auth for the portal API (§5) |
| `CLICKHOUSE_HTTP_URL` | ClickHouse sink | Insert endpoint for the `clickhouse` strategy |
| `CLICKHOUSE_QUERY_URL` | ClickHouse Explore | Query base for the Explore proxy (falls back to `CLICKHOUSE_HTTP_URL`'s origin) |
| `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` | If your ClickHouse requires auth | Basic auth on both paths |
| `TINYBIRD_TOKEN` | Tinybird sink/Explore | Events API + SQL API |
| `TINYBIRD_DATASOURCE` | Tinybird sink | Target datasource name (default `events`) |
| `TINYBIRD_API_URL` | Optional | Region override for the Explore query path (default `https://api.tinybird.co`) |
| `GOOGLE_MP_API_SECRET`, `GOOGLE_MEASUREMENT_ID` | `google-mp` strategy | Google Analytics Measurement Protocol |
| `META_ACCESS_TOKEN`, `META_PIXEL_ID` | `meta-capi` strategy | Meta Conversions API |
| `TIKTOK_ACCESS_TOKEN`, `TIKTOK_PIXEL_ID` | `tiktok-events` strategy | TikTok Events API |
| `MICROSOFT_UET_ACCESS_TOKEN`, `MICROSOFT_UET_TAG_ID` | `microsoft-uet` strategy | Microsoft UET |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `otel` strategy | OTLP/HTTP endpoint (optional `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`) |

In a seeded deployment, destination strategies run only when both their secrets **and**
their id in KV `attestrack:enabled_strategies` are present — the seed enables analytics
only (`clickhouse`, `tinybird`, `drift-detection`); add ids like `meta-capi` when you set
the matching secrets. (If that KV key is missing or invalid, all bundled optional
strategies are eligible but still no-op without their secrets.)

## 4. CORS and the consent cookie (cross-subdomain topology)

Typical setup: pages on `www.example.com`, Worker on `t.example.com`. Two site-config
fields (KV `attestrack:portal:site_config`, [ADR-012](../ADR/ADR-012-consent-cookie-topology.md))
make that work:

- **CORS allowlist** — derived from `domain` + `trustedDomains`. Browser routes
  (`/t/event`, consent commit/context) are credentialed CORS with this allowlist —
  https-only, loopback origins only when explicitly listed, no wildcard reflection. Add
  every page origin that calls the Worker: portal → Configuration, or
  `POST /__attestrack__/portal/v1/site-config/trusted-domains`.
- **Cookie domain** — the Worker (not the browser script) sets the `at_consent` cookie:
  `Domain=<cookieDomain ?? domain>; Path=/; Max-Age=<state1TokenTTL>; Secure; SameSite=Lax`,
  so one consent covers all subdomains. `cookieDomain` defaults to `domain`; the `Domain`
  attribute is omitted (host-only cookie) when the Worker host is outside that domain.

`/consent.js` itself is public (wildcard origin, no credentials) — embed it first-party:

```html
<script src="https://t.example.com/consent.js" defer></script>
```

## 5. Lock down the portal and portal API

Two distinct surfaces need protection (full detail:
[PILOT-OSS.md → Cloudflare Access](PILOT-OSS.md#cloudflare-access-on-the-portal-production),
[THREAT-MODEL.md](THREAT-MODEL.md)):

1. **The Pages portal URL** — public until you put **Cloudflare Access** in front of it.
   `npx @attestrack/deploy verify` fails loudly ("portal is PUBLIC") until it 302s to
   Access.
2. **The Worker portal API** (`/__attestrack__/portal/v1/*`) — unauthenticated by design
   (PORTAL.1): put Access in front of those Worker paths, and/or set
   `PORTAL_API_SHARED_SECRET` so every portal request must send the
   `x-attestrack-portal-secret` header (`401 portal_unauthorized` otherwise). Never embed
   that secret in the public SPA bundle.

Public consent/tracking routes are unaffected by both.

## 6. Verify end-to-end

`npx @attestrack/deploy verify` covers health, DNS route, portal Access, and consent
commit. Manual spot checks and the portal walkthrough:
[PILOT-OSS.md](PILOT-OSS.md#verify-the-worker-manual-spot-checks). A scripted 5-minute
demo path: [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

## Troubleshooting

Canonical error codes: [REPO-SPEC-OSS.md → JSON error contract](REPO-SPEC-OSS.md#json-error-contract-fail-fast-triage-friendly).
Symptom-first:

| Symptom | Error code / signal | Fix |
|---|---|---|
| Consent commit returns 503 | `consent_secret_not_configured` | `wrangler secret put CONSENT_TOKEN_SECRET` from `attestrack-deploy/`, then redeploy |
| Consent commit returns 503 | `consent_secret_too_weak` | Secret under 16 bytes — set a 32+ character value |
| Browser blocks `/t/event` or commit (CORS) | Preflight fails / no `Access-Control-Allow-Origin` | Add the page origin's domain to `trustedDomains` (or fix `domain`) in site config; origins must be https |
| Consent cookie not sent on subdomains | Host-only cookie | Set `cookieDomain` in site config to the registrable domain (e.g. `example.com`); the Worker host must be inside it |
| 400 on ingest | `invalid_body` (+ Zod `details`) | Body must match `trackingEventV1Schema` — `v: 1`, `eventName`, `siteId`, ISO `occurredAt`; unknown fields are stripped |
| Explore returns 400 | `invalid_sql` (+ `details.code`) | Single `SELECT`, bare allowlisted tables (`events`, `attestrack_events`), no `UNION`/subquery-`FROM`; `LIMIT` clamped to 500 |
| Explore returns 503 | `explore_warehouse_not_configured` | Set `TINYBIRD_TOKEN` or `CLICKHOUSE_QUERY_URL`/`CLICKHOUSE_HTTP_URL` |
| Explore 4xx/502 | `explore_warehouse_http_error`, `_fetch_failed`, `_rejected`, `_bad_response` | Upstream warehouse problem — check credentials, URL, and that the DDL was applied; `details.reason` carries the upstream message |
| Saving a query returns 400 | `saved_queries_limit` | 100-entry cap — remove one first |
| Portal API returns 401 | `portal_unauthorized` | `PORTAL_API_SHARED_SECRET` is set — send the `x-attestrack-portal-secret` header |
| Portal API returns 403 | `requires_attestrue` | That surface (banner/policy/mode mutations) is a licensed extension — expected in OSS ([ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md)) |
| Portal shows "Local stub data" | `VITE_ATTESTRACK_API_BASE_URL` unset at build | Rebuild/redeploy the portal with the Worker URL (the deploy CLI does this) |
| Dashboard/destinations empty on fresh deploy | No traffic yet | Views are computed from real traffic — send events; quiet-but-configured destinations honestly show `no_data` |
| Drift banner in portal | `attestrack:drift:mismatch` set | Consent config changed vs the seeded fingerprint — re-seed or update the expected fingerprint after an intentional change |
| Custom domain 404s after deploy | DNS propagation | Can take up to 24 h; `verify` reports it as **pending**, not failure |

## Further reading

- [PILOT-OSS.md](PILOT-OSS.md) — deploy CLI walkthrough, upgrades, migrations, rollback
- [API-REFERENCE.md](API-REFERENCE.md) — routes, KV registry, consent token
- [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) — binding HTTP/KV/error contract
- [THREAT-MODEL.md](THREAT-MODEL.md) — what protects what, and from whom
- [RELEASING.md](RELEASING.md) — maintainers: versioning and npm publish
