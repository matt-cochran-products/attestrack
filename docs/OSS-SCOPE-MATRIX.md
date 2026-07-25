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
| **Part II — Portal general** (PORTAL.1–10) | Analytics-first shell; CF Access assumed external; stub vs live API visibility | Evidence labeling, upgrade copy beyond static CTA | — | Mode chrome, confirmations where spec exceeds stub | ADR-010 regulation-led UX / extensions | `portal-community` + worker portal API | |
| **Part III — Dashboard** (DASH.*) | Stub + KV-backed JSON via Worker | — | — | Real metrics wiring | ADR-010 | worker `portal` `/dashboard` | |
| **Part IV — Consent events UI** (CE.*) | Community consent **contracts** (KV, strategies, token) | Full event history / regulation presentation | Much of CE.* presentation | — | ADR-010 § Summary + Decisions | [consent-token-hardening.test.ts](../packages/sdk/__tests__/consent-token-hardening.test.ts) (expiry, siteId binding, `k<N>.` rotation), [consent-log.test.ts](../packages/strategies/__tests__/consent-log.test.ts) (real `ioaAttested`, mechanism+mode, operator TTL), [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts) | |
| **Part V — Evidence chain** (EC.*) | Unsigned / honest framing hooks only | Proof, witnessed records, D1 chain | **Trust chain / Proof** (ADR-002; CETS v1.1 licensed spec) | — | ADR-010 + ADR-002 | — | Y (wording vs product) |
| **Part VI — Strategies** (STR.*) | Bundled strategies + portal list/toggle API | Credential gates, premium strategy packs | — | STR.2–4 depth | ADR-010 CDN bundles | `strategies`, worker composite tests | |
| **Part VII — Banner** (BAN.*) | `consent-js` (first-party script): config-driven copy from `GET /__attestrack__/consent/context`, IOA checkboxes, co-equal Reject all, withdrawal (`AttestrackConsent.open()`), per-row GPC; served first-party at `GET /consent.js` | Portal **banner** GET/POST (`requires_attestrue`); IOA/regulation packs | — | a11y depth (focus trap), `<script type="text/plain">` gating | ADR-010 | [banner.test.ts](../packages/consent-js/__tests__/banner.test.ts) (INV-B-06/07 named tests), [cors-cookie-consentjs.contract.test.ts](../packages/worker-core/__tests__/contract/cors-cookie-consentjs.contract.test.ts) | |
| **Part VIII — Policy** (POL.*) | `/privacy`, `/terms` static text from KV | Portal **policy-versions** API (`requires_attestrue`); hashing/legal workflow | — | POL.2–6 depth | ADR-010 | worker top-level policy routes | |
| **Part IX — Site config** (CFG.*) | Site config **GET**; **trusted-domains** POST; **mode is read and enforced by the pipeline** (SHADOW = destinations run + would-be decision recorded; ENFORCEMENT = gate applies); CORS allowlist + consent cookie `Domain` derived from site config | **Enforcement / shadow mode** POST (`requires_attestrue`); ceremony (CFG.1) | — | — | ADR-010 | worker `portal.ts` + [config.ts](../packages/worker-core/src/config.ts), [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts), [oss-http-contract.json](oss-http-contract.json) | |
| **Part IX — Analytics** (ANA.*) | Curated JSON + warehouse status stub | — | — | Real ClickHouse/Tinybird proxy | ADR-010 | portal + worker | |
| **Part X — Explore** (EXP.*) | Worker gate + allowlist + LIMIT; optional CH/Tinybird execute; saved queries KV | — | — | Deeper charting / multi-warehouse UX | ADR-010 | [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts), [`explore-sql`](../packages/schema/src/explore-sql.ts) | |
| **Migration / Upgrade** (MIG, UPG) | Upgrade / extensions **handoff** (`attestrue.com/upgrade?site_id=`); `/migration` static handoff only | Licensed checkout, CMP cutover wizard | — | — | [USER-JOURNEY.SPEC.md](USER-JOURNEY.SPEC.md) v2.0 | `portal-community` | |
| **Behavioral invariants INV-B-01–17** | See table below | | | | ADR-010 | | |

---

## Tier 1 — INV-B-* (summary)

| ID | OSS (this repo) | Notes | ADR ref | Evidence |
|----|-----------------|-------|---------|----------|
| INV-B-01, INV-B-02 | Y (design intent) | No Attestrue calls in OSS code paths | ADR-010 | Code review + e2e smoke |
| INV-B-03 | Y (enforced) | Shadow default in seed AND pipeline: missing/`NOT_CONFIGURED` mode collapses to SHADOW; SHADOW never blocks destinations, would-be decision recorded | — | [consent-matrix.contract.test.ts](../packages/worker-core/__tests__/contract/consent-matrix.contract.test.ts) (INV-B-03-named cases), [consent-gate.test.ts](../packages/sdk/__tests__/consent-gate.test.ts) |
| INV-B-04 | Partial | Enforcement without policy versions — full gate is product; OSS has modes | — | — |
| INV-B-05 – INV-B-09 | Licensed / reference (INV-B-06/07 banner surface is OSS) | Evidence chain, policy immutability UI licensed; community banner enforces required IOA checkboxes (06) and a co-equal Reject all (07) | ADR-010 | [banner.test.ts](../packages/consent-js/__tests__/banner.test.ts) INV-B-06/07 tests |
| INV-B-10 | Target | CLI must not echo secrets — verify as deploy matures | — | — |
| INV-B-11 | Y | Customer account resources | — | deploy templates |
| INV-B-12 | Y | Static upgrade route | — | portal static |
| INV-B-13 | Licensed | Community TIR disclaimer | ADR-010 | — |
| **INV-B-14** | Y | Worker enforces read-only gate + allowlist before warehouse | — | explore contract + schema tests |
| **INV-B-15** | Y (gate) | Table allowlist (`events`, `attestrack_events`); qualified `db.table` names rejected (`default` removed from the allowlist — it is a ClickHouse database); DB grants remain the recommended backstop (ADR-013) | — | schema `explore-sql` (+ adversarial/hardening tests, nightly Stryker mutation run) |
| **INV-B-16** | Y (intent) | Query stays on customer infra | ADR-010 | Worker fetch to customer secrets only |
| **INV-B-17** | Y | `KV_KEY_PORTAL_SAVED_QUERIES` + portal routes | — | explore contract tests |

---

## USER-JOURNEY stages (Tier 1)

| Stage | OSS ([USER-JOURNEY.SPEC.md](USER-JOURNEY.SPEC.md) v2.0) | Licensed / extension |
|-------|-----|----------------------|
| 1–5a, 6 (tracking), 7, 7a | Core narrative + analytics-first portal + Worker (measurement path) | — |
| Commercial narrative (banner, policy publish, jurisdiction, enforcement, upgrade) | **Handoff only** in OSS UI | attestrue-premium `docs/USER-JOURNEY-SPEC.md` Part VI (licensed repo — plain-text citation; not linkable from this repository) |

---

## Companion documents (out of repo)

Core ConOps, full Repo Spec, and Portal Community Spec referenced in BEHAVORIAL-SPEC footer are **not** mirrored here. Use [CONOPS-OSS-SNAPSHOT.md](CONOPS-OSS-SNAPSHOT.md) and [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) for OSS-observable behavior.
