# OSS scope matrix (Tier 1)

**Purpose:** Map behavioral specs ([BEHAVORIAL-SPEC.md](BEHAVORIAL-SPEC.md), [USER-JOURNEY.SPEC.md](USER-JOURNEY.SPEC.md)) and invariants to what this **public repository** is expected to ship vs what is **licensed / reference-only**.

**Normative precedence (resolve conflicts in this order):**

1. [ADR-010](../ADR/ADR-010-attestrack-core-extension-cache.md) — OSS vs extension boundary  
2. [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) — HTTP, KV keys, and JSON error shapes for **this** repo  
3. BEHAVORIAL-SPEC — product intent and UX outcomes (may span OSS + extensions)  
4. This matrix — index and traceability; it does not override (1)–(3)

**Columns**

| Column | Meaning |
|--------|---------|
| **OSS** | In scope for this repo; acceptance via tests + REPO-SPEC where applicable |
| **Licensed / extension** | Attestrue extensions or CDN artifacts; keep rows for traceability, not OSS implementation |
| **N/A (ADR-010)** | Explicitly out of OSS core per ADR-010 narrative |
| **Future OSS** | Planned public work; not a commitment date |
| **ADR ref** | Citation when the row is non-obvious |
| **Evidence** | Test or doc anchor when available (`—` if not yet linked) |
| **needs-review** | Product/legal should confirm classification |

---

## Tier 1 — coarse buckets (Part / journey)

| Area | OSS | Licensed / extension | N/A (ADR-010) | Future OSS | ADR ref | Evidence | needs-review |
|------|-----|----------------------|---------------|------------|---------|----------|--------------|
| **Part I — CLI** (CLI.1–12) | Scaffold + guided flow | — | — | Full interactive hardening, credential masking audits | ADR-010 “analytics + … community consent” | `packages/deploy` tests, [REPO-SPEC-OSS](REPO-SPEC-OSS.md) | |
| **Part II — Portal general** (PORTAL.1–10) | Analytics-first shell; CF Access assumed external; stub vs live API visibility; drift banner driven by real Worker drift state (no hardcoded chrome) | Evidence labeling, upgrade copy beyond static CTA | — | Mode chrome, confirmations where spec exceeds stub | ADR-010 regulation-led UX / extensions | `portal-community` + worker portal API, [Layout.drift-alert.test.tsx](../packages/portal-community/src/components/Layout.drift-alert.test.tsx) | |
| **Part III — Dashboard** (DASH.*) | **Computed Worker metrics (P3.2)**: `eventsToday` from a sampled per-UTC-day KV counter, drift alert count/detail from `attestrack:drift:mismatch`, strategy status from recorded delivery stats. Seeded dashboard JSON removed and **ignored** (route-contract gate enforces it) | — | — | Warehouse-rollup cron for richer metrics (top pages, ranges) | ADR-010 | [portal-observability.contract.test.ts](../packages/worker-core/__tests__/contract/portal-observability.contract.test.ts), [observability.ts](../packages/worker-core/src/observability.ts), [oss-http-contract.json](oss-http-contract.json) `portalDataSources` | |
| **Part IV — Consent events UI** (CE.*) | Community consent **contracts** (KV, strategies, token) | Full event history / regulation presentation | Much of CE.* presentation | — | ADR-010 § Summary + Decisions | [consent-token-hardening.test.ts](../packages/sdk/__tests__/consent-token-hardening.test.ts) (expiry, siteId binding, `k<N>.` rotation), [consent-log.test.ts](../packages/strategies/__tests__/consent-log.test.ts) (real `ioaAttested`, mechanism+mode, operator TTL), [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts) | |
| **Part V — Evidence chain** (EC.*) | Unsigned / honest framing hooks only | Proof, witnessed records, D1 chain | **Trust chain / Proof** (ADR-002; CETS v1.1 licensed spec) | — | ADR-010 + ADR-002 | — | Y (wording vs product) |
| **Part VI — Strategies** (STR.*) | Bundled strategies + portal list/toggle API; **STR.4 error surface is real (P3.1)**: every sink/destination records delivery outcomes to KV (`attestrack:obs:delivery:*`) → `/destinations` status, success rate, last error; **troll-shield is real (P3.4)**: honest bot heuristics (UA class, missing UA, optional CF bot-score host port) — bots never fire ad destinations, warehouse rows kept labeled `userAgentClass:'bot'` | Credential gates, premium strategy packs, cross-customer bot intelligence | — | STR.2–3 depth (per-destination config UI) | ADR-010 CDN bundles | [delivery-recording.test.ts](../packages/strategies/__tests__/delivery-recording.test.ts), [troll-shield.test.ts](../packages/strategies/__tests__/troll-shield.test.ts), [delivery.test.ts](../packages/sdk/__tests__/delivery.test.ts), worker composite tests | |
| **Part VII — Banner** (BAN.*) | `consent-js` (first-party script): config-driven copy from `GET /__attestrack__/consent/context`, IOA checkboxes, co-equal Reject all, withdrawal (`AttestrackConsent.open()`), per-row GPC; served first-party at `GET /consent.js` | Portal **banner** GET/POST (`requires_attestrue`); IOA/regulation packs | — | a11y depth (focus trap), `<script type="text/plain">` gating | ADR-010 | [banner.test.ts](../packages/consent-js/__tests__/banner.test.ts) (INV-B-06/07 named tests), [cors-cookie-consentjs.contract.test.ts](../packages/worker-core/__tests__/contract/cors-cookie-consentjs.contract.test.ts) | |
| **Part VIII — Policy** (POL.*) | `/privacy`, `/terms` static text from KV | Portal **policy-versions** API (`requires_attestrue`); hashing/legal workflow | — | POL.2–6 depth | ADR-010 | worker top-level policy routes | |
| **Part IX — Site config** (CFG.*) | Site config **GET**; **trusted-domains** POST; **mode is read and enforced by the pipeline** (SHADOW = destinations run + would-be decision recorded; ENFORCEMENT = gate applies); CORS allowlist + consent cookie `Domain` derived from site config; **drift detection live end-to-end (P3.5)**: deploy seeds `attestrack:drift:expected_fingerprint`, the strategy writes `attestrack:drift:mismatch` on divergence, surfaced in dashboard/banner/alert-rules | **Enforcement / shadow mode** POST (`requires_attestrue`); ceremony (CFG.1) | — | — | ADR-010 | worker `portal.ts` + [config.ts](../packages/worker-core/src/config.ts), [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts), [drift-detection.test.ts](../packages/strategies/__tests__/drift-detection.test.ts), [worker-template.test.ts](../packages/deploy/__tests__/worker-template.test.ts) (seed fingerprint parity), [oss-http-contract.json](oss-http-contract.json) | |
| **Part IX — Analytics** (ANA.*) | **Curated views COMPUTED (P4.3)** — Recharts cards, one Worker request per chart (ANA.6), read-only (ANA.4), session-global date range (ANA.5), one-line framing on every card (ANA.7 discipline): `events-volume`, `consent-rate-by-jurisdiction` (from P2-recorded decisions), `bot-share` via **canned SQL through the gated Explore proxy**; `destination-success-rate` from recorded delivery stats (STR.4). Honest `empty`/`not_configured`/`error` states link to Strategies (ANA.3). Request-log view live from the Worker ingest ring (P3.1). **Signal recovery (ANA.2 blocker/ITP recovery + the >7-day-attribution question) stays DE-SCOPED in v1**: recovery needs a client beacon Attestrack does not ship (`/signal*` returns `measured:false, reason:'requires_beacon'`), and long-window attribution needs a conversion definition OSS v1 does not have — no chart is shown rather than an invented one (launch rule §3) | — | — | Signal-recovery beacon + blocked-detector in consent-js; attribution-window curated view once conversions are defined | ADR-010 | [curated-analytics.contract.test.ts](../packages/worker-core/__tests__/contract/curated-analytics.contract.test.ts), [analytics-page.test.tsx](../packages/portal-community/src/routes/analytics/analytics-page.test.tsx), [portal-observability.contract.test.ts](../packages/worker-core/__tests__/contract/portal-observability.contract.test.ts) (`/signal` de-scope + bot counter cases), [oss-http-contract.json](oss-http-contract.json) `portalDataSources.computed` | |
| **Part X — Explore** (EXP.*) | **Full P4 surface**: Worker gate + allowlist + LIMIT; optional CH/Tinybird execute; CodeMirror 6 editor with schema autocomplete from `@attestrack/types` (EXP.6); TanStack results table (EXP.7); user-directed ECharts viz — 7 spec chart types, `table` default (EXP.8); saved queries in customer KV with a **Zod-validated shape** + per-user pinning via CF Access identity (EXP.9/EXP.10); browser-side CSV (EXP.11); destination-gated empty state (EXP.13). Per-row accounting: **Tier 2 table below** | — | — | Multi-warehouse UX; cross-site saved-query sharing | ADR-010 | [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts), [saved-queries-pin.contract.test.ts](../packages/worker-core/__tests__/contract/saved-queries-pin.contract.test.ts), [`explore-sql`](../packages/schema/src/explore-sql.ts), Tier 2 EXP table | |
| **Migration / Upgrade** (MIG, UPG) | Upgrade / extensions **handoff** (`attestrue.com/upgrade?site_id=`); `/migration` static handoff only | Licensed checkout, CMP cutover wizard | — | — | [USER-JOURNEY.SPEC.md](USER-JOURNEY.SPEC.md) v2.0 | `portal-community` | |
| **Behavioral invariants INV-B-01–17** | See table below | | | | ADR-010 | | |

---

## Tier 2 — Explore behaviours EXP.1–13 (P4 exit accounting)

Phase 4 exit rule: every EXP row **passes a contract/component test** or is **explicitly de-scoped here with rationale**. No `—` on shipped behavior.

| ID | Status | Evidence |
|----|--------|----------|
| EXP.1 SQL editor → proxy → results | **Shipped** | [explore-page.test.tsx](../packages/portal-community/src/routes/explore/explore-page.test.tsx) (run flow), [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts) |
| EXP.2 Connection pre-configured (no client setup) | **Shipped** | Proxy resolves the warehouse from Worker secrets only — [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts) ("executes ClickHouse when CLICKHOUSE_QUERY_URL is set"); the portal has no connection UI |
| EXP.3 Read-only, enforced server-side | **Shipped** | [`explore-sql`](../packages/schema/src/explore-sql.ts) forbidden-keyword/statement checks + adversarial/hardening suites; Worker-side enforcement in [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts) |
| EXP.4 Scoped to the Attestrack schema (allowlist) | **Shipped** | Same gate suites (INV-B-15: bare-table allowlist, qualified names rejected) |
| EXP.5 500-row limit, user informed on truncation | **Shipped** | LIMIT clamp in gate tests; truncation notice: [explore-page.test.tsx](../packages/portal-community/src/routes/explore/explore-page.test.tsx) |
| EXP.6 Schema autocomplete (tables + columns) | **Shipped (P4.2)** | [autocomplete.test.ts](../packages/portal-community/src/lib/explore/autocomplete.test.ts) — tables from `ATTESTRACK_EXPLORE_ALLOWED_TABLES`, columns from `ATTESTRACK_EVENT_COLUMNS` (compile-time lockstep with `TrackingEventV1`) |
| EXP.7 Results table first: sort, filter, pagination | **Shipped (P4.2)** | [ExploreResultsTable.test.tsx](../packages/portal-community/src/components/ExploreResultsTable.test.tsx) |
| EXP.8 User-directed viz; line/bar/scatter/pie/area/heatmap/table | **Shipped (P4.2)** | [echarts-option.test.ts](../packages/portal-community/src/lib/charts/echarts-option.test.ts) (all 7 types, table never auto-charted), [explore-page.test.tsx](../packages/portal-community/src/routes/explore/explore-page.test.tsx) (`table` default) |
| EXP.9 Saved queries in the customer's CF KV | **Shipped** | [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts) (KV list/save/remove), [portal-saved-queries.test.ts](../packages/schema/__tests__/portal-saved-queries.test.ts) (Zod KV shape, P4.4) |
| EXP.10 Pinned to Analytics, personal per user | **Shipped (P4.4)** | [saved-queries-pin.contract.test.ts](../packages/worker-core/__tests__/contract/saved-queries-pin.contract.test.ts) (pin/unpin keyed on `Cf-Access-Authenticated-User-Email`; other users never see the pin), [analytics-page.test.tsx](../packages/portal-community/src/routes/analytics/analytics-page.test.tsx) (pinned tiles through the gated proxy). **Caveat (documented, REPO-SPEC):** without CF Access the identity header is absent → one shared anonymous pin identity |
| EXP.11 CSV export generated in the browser | **Shipped** | [csv.test.ts](../packages/portal-community/src/lib/explore/csv.test.ts); no server round-trip |
| EXP.12 No query content transmitted to Attestrack | **Shipped (design-verified)** | Single warehouse path: [curated-analytics.contract.test.ts](../packages/worker-core/__tests__/contract/curated-analytics.contract.test.ts) asserts exactly one fetch to the operator's warehouse; `route-contract-check` forbids direct `fetch` outside `executeExploreSql` for curated SQL; INV-B-01/16 egress grep-gate lands in P6 |
| EXP.13 Unavailable without an analytics destination | **Shipped** | [explore-page.test.tsx](../packages/portal-community/src/routes/explore/explore-page.test.tsx) — editor absent, empty state links to Strategies; Worker `analytics/warehouse-status` |

---

## Tier 1 — INV-B-* (summary)

| ID | OSS (this repo) | Notes | ADR ref | Evidence |
|----|-----------------|-------|---------|----------|
| INV-B-01, INV-B-02 | Y (design intent) | No Attestrue calls in OSS code paths | ADR-010 | Code review + e2e smoke |
| INV-B-03 | Y (enforced) | Shadow default in seed AND pipeline: missing/`NOT_CONFIGURED` mode collapses to SHADOW; SHADOW never blocks destinations, would-be decision recorded | — | [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts) (INV-B-03-named cases), [consent-gate.test.ts](../packages/sdk/__tests__/consent-gate.test.ts) |
| INV-B-04 | Partial | Enforcement without policy versions — full gate is product; OSS has modes (SHADOW/ENFORCEMENT shipped + tested; policy-version gating licensed) | — | [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts) (mode semantics; licensed remainder has no OSS evidence by design) |
| INV-B-05 – INV-B-09 | Licensed / reference (INV-B-06/07 banner surface is OSS) | Evidence chain, policy immutability UI licensed; community banner enforces required IOA checkboxes (06) and a co-equal Reject all (07) | ADR-010 | [banner.test.ts](../packages/consent-js/__tests__/banner.test.ts) INV-B-06/07 tests |
| INV-B-10 | Y (P5) | CLI never echoes secrets: masked prompt + `maskSecrets` on all CLI output/diffs | — | [secret-masking.test.ts](../packages/deploy/__tests__/secret-masking.test.ts), [`mask.ts`](../packages/deploy/src/mask.ts) |
| INV-B-11 | Y | Customer account resources | — | deploy templates |
| INV-B-12 | Y | Static upgrade route | — | portal static |
| INV-B-13 | Licensed | Community TIR disclaimer | ADR-010 | — |
| **INV-B-14** | Y | Worker enforces read-only gate + allowlist before warehouse | — | explore contract + schema tests |
| **INV-B-15** | Y (gate) | Table allowlist (`events`, `attestrack_events`); qualified `db.table` names rejected (`default` removed from the allowlist — it is a ClickHouse database); DB grants remain the recommended backstop (ADR-013) | — | schema `explore-sql` (+ adversarial/hardening tests, nightly Stryker mutation run) |
| **INV-B-16** | Y (intent) | Query stays on customer infra | ADR-010 | Worker fetch to customer secrets only |
| **INV-B-17** | Y | `KV_KEY_PORTAL_SAVED_QUERIES` + portal routes; Zod-validated KV shape + per-user pins (P4.4) | — | explore contract tests, [saved-queries-pin.contract.test.ts](../packages/worker-core/__tests__/contract/saved-queries-pin.contract.test.ts), [portal-saved-queries.test.ts](../packages/schema/__tests__/portal-saved-queries.test.ts) |

---

## USER-JOURNEY stages (Tier 1)

| Stage | OSS ([USER-JOURNEY.SPEC.md](USER-JOURNEY.SPEC.md) v2.0) | Licensed / extension |
|-------|-----|----------------------|
| 1–5a, 6 (tracking), 7, 7a | Core narrative + analytics-first portal + Worker (measurement path) | — |
| Commercial narrative (banner, policy publish, jurisdiction, enforcement, upgrade) | **Handoff only** in OSS UI | attestrue-premium `docs/USER-JOURNEY-SPEC.md` Part VI (licensed repo — plain-text citation; not linkable from this repository) |

---

## Companion documents (out of repo)

Core ConOps, full Repo Spec, and Portal Community Spec referenced in BEHAVORIAL-SPEC footer are **not** mirrored here. Use [CONOPS-OSS-SNAPSHOT.md](CONOPS-OSS-SNAPSHOT.md) and [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) for OSS-observable behavior.
