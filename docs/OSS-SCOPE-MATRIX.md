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
| **Part IV — Consent events UI** (CE.*) | Community consent **contracts** (KV, strategies, token) | Full event history / regulation presentation | Much of CE.* presentation | — | ADR-010 § Summary + Decisions | `sdk` / `strategies` consent tests | |
| **Part V — Evidence chain** (EC.*) | Unsigned / honest framing hooks only | Proof, witnessed records, D1 chain | Merkle / Proof (ADR-002) | — | ADR-010 + ADR-002 | — | Y (wording vs product) |
| **Part VI — Strategies** (STR.*) | Bundled strategies + portal list/toggle API | Credential gates, premium strategy packs | — | STR.2–4 depth | ADR-010 CDN bundles | `strategies`, worker composite tests | |
| **Part VII — Banner** (BAN.*) | `consent-js` + portal banner KV API | IOA/regulation-specific packs | — | Banner UX completeness | ADR-010 `consent-js` | `consent-js` tests | |
| **Part VIII — Policy** (POL.*) | `/privacy`, `/terms`, portal policy JSON | Hashing/legal workflow depth | — | POL.2–6 depth | ADR-010 | worker policy + portal policy API | |
| **Part IX — Site config** (CFG.*) | Site config in KV; mode + trusted domains API | — | — | Ceremony (CFG.1) | ADR-010 | worker portal POSTs | |
| **Part IX — Analytics** (ANA.*) | Curated JSON + warehouse status stub | — | — | Real ClickHouse/Tinybird proxy | ADR-010 | portal + worker | |
| **Part X — Explore** (EXP.*) | Worker gate + allowlist + LIMIT; optional CH/Tinybird execute; saved queries KV | — | — | Deeper charting / multi-warehouse UX | ADR-010 | [explore-proxy.contract.test.ts](../packages/worker-core/__tests__/contract/explore-proxy.contract.test.ts), [`explore-sql`](../packages/schema/src/explore-sql.ts) | |
| **Migration / Upgrade** (MIG, UPG) | Static upgrade CTA / deploy docs | Licensed checkout | — | — | USER-JOURNEY v1.3 | — | |
| **Behavioral invariants INV-B-01–17** | See table below | | | | ADR-010 | | |

---

## Tier 1 — INV-B-* (summary)

| ID | OSS (this repo) | Notes | ADR ref | Evidence |
|----|-----------------|-------|---------|----------|
| INV-B-01, INV-B-02 | Y (design intent) | No Attestrue calls in OSS code paths | ADR-010 | Code review + e2e smoke |
| INV-B-03 | Y (default) | Shadow default in portal site-config seed / Worker | — | deploy seed, worker defaults |
| INV-B-04 | Partial | Enforcement without policy versions — full gate is product; OSS has modes | — | — |
| INV-B-05 – INV-B-09 | Licensed / reference | Evidence chain, policy immutability UI | ADR-010 | — |
| INV-B-10 | Target | CLI must not echo secrets — verify as deploy matures | — | — |
| INV-B-11 | Y | Customer account resources | — | deploy templates |
| INV-B-12 | Y | Static upgrade route | — | portal static |
| INV-B-13 | Licensed | Community TIR disclaimer | ADR-010 | — |
| **INV-B-14** | Y | Worker enforces read-only gate + allowlist before warehouse | — | explore contract + schema tests |
| **INV-B-15** | Partial | Table allowlist (`events`, `attestrack_events`, `default`); not full schema introspection lockdown | — | schema `explore-sql` |
| **INV-B-16** | Y (intent) | Query stays on customer infra | ADR-010 | Worker fetch to customer secrets only |
| **INV-B-17** | Y | `KV_KEY_PORTAL_SAVED_QUERIES` + portal routes | — | explore contract tests |

---

## USER-JOURNEY stages (Tier 1)

| Stage | OSS | Licensed / reference |
|-------|-----|----------------------|
| 1–4, 5 (analytics shell), 5a, 8a | Core narrative + OSS portal + Worker | Consent/regulation stages as reference (v1.3) |
| 6–8 (consent-heavy) | Partial (community consent only) | Extension UX |
| 9 | Static upgrade / handoff | Commercial flows |

---

## Companion documents (out of repo)

Core ConOps, full Repo Spec, and Portal Community Spec referenced in BEHAVORIAL-SPEC footer are **not** mirrored here. Use [CONOPS-OSS-SNAPSHOT.md](CONOPS-OSS-SNAPSHOT.md) and [REPO-SPEC-OSS.md](REPO-SPEC-OSS.md) for OSS-observable behavior.
