# ConOps — OSS snapshot (observable Worker)

**Purpose:** Describe what you can **observe** in the open-source Worker pipeline without copying proprietary Core ConOps.

**Scope:** Single Worker `fetch` entry built around `createAttestrackFetchHandler` ([packages/worker-core/src/create-fetch-handler.ts](../packages/worker-core/src/create-fetch-handler.ts)).

---

## Request ingress

1. **Portal branch** — If the path starts with `PORTAL_API_PREFIX`, [handlePortalRequest](../packages/worker-core/src/portal.ts) serves JSON from KV or small in-handler logic (Explore validation, site-config writes). No strategy pipeline on these paths unless explicitly added later.
2. **Consent commit** — Validated POST; mints HMAC privacy consent token via SDK.
3. **Policy** — `/privacy`, `/terms` read plain text from KV.
4. **Tracking** — `POST /t/event` validates payload, returns `202`-like immediate acceptance (`{ ok, accepted }`), schedules pipeline work.
5. **Default GET** — Runs full pipeline for page views / generic GETs.

---

## Strategy pipeline (stages)

Implemented in [composite.ts](../packages/worker-core/src/composite.ts) and invoked from `runPipeline`:

1. **Load extensions** — `StrategyLoader.loadForRequest` (community: `NoopLoader`; licensed deploy may inject CDN loader per ADR-010).
2. **Merge** — `resolveStrategiesWithReplaces` applies `replaces` on bundled + extension strategies.
3. **Mandatory** — Sequential mandatory stage (jurisdiction, consent, consent-log, troll-shield, etc., per bundle).
4. **Destination** — Parallel fan-out with per-strategy error isolation.
5. **Analytics** — Analytics stage strategies after destinations.

Context is `StrategyPipelineContext` from `@attestrack/sdk`.

---

## Background work

`HostRuntime.scheduleBackground` queues async work. On Cloudflare, this maps to `waitUntil`-style continuation so the client response can return before destinations finish. Tests use `flushMockBackgroundTasks` from `@attestrack/sdk` to assert ordering.

---

## Extension slot

Premium strategies and consent-runtime enhancements load through **`StrategyLoader`** without forking the Worker’s public HTTP contract. KV document shapes stay compatible with community defaults ([ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md)).

---

## Intentional deltas vs premium ConOps

- No in-tree documentation for operator counsel workflows, demand-letter packs, or witnessed record UI.
- Explore proxy executes against the operator's Tinybird or ClickHouse when the corresponding secrets are configured ([explore-warehouse.ts](../packages/worker-core/src/explore-warehouse.ts)); the SQL gate enforces single-`SELECT`, a table allowlist (qualified-name aware), and a clamped `LIMIT` ([explore-sql.ts](../packages/schema/src/explore-sql.ts), INV-B-14/15 — see [OSS-SCOPE-MATRIX.md](OSS-SCOPE-MATRIX.md)). Unconfigured warehouses return `explore_warehouse_not_configured`, not empty results.
