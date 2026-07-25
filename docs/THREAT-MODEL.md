# Attestrack Threat Model (STRIDE-lite)

**Scope:** the OSS monorepo as deployed by the community path — Cloudflare Worker (`@attestrack/worker-core` + bundled strategies), KV namespace, consent script (`consent-js`), community portal SPA, deploy CLI, and this repo's supply chain.
**Method:** STRIDE-lite per asset, grounded in the actual code (file references throughout). Every finding is either **fixed with a test** or **accepted with rationale** in the register below (Phase 7 exit criterion).
**Last reviewed:** 2026-07 (P7). Re-review when a new route, strategy, or secret is added.

---

## 1. Assets

| Asset | Where | Why it matters |
|---|---|---|
| Consent tokens + `CONSENT_TOKEN_SECRET` (`_PREVIOUS` rotation values) | minted in `worker-core/src/create-fetch-handler.ts`, verified in `strategies/src/mandatory/consent.ts`, crypto in `sdk/src/consent-token.ts` | Forgery = fabricated consent evidence; the legal-correctness core |
| KV namespace (site config, `ConsentConfig`, enabled strategies, consent-event records, observability counters/logs, saved queries) | `types/src/kv-keys.ts` registry | Config tampering redirects CORS/consent behavior; uncontrolled writes are billable cost |
| Warehouse credentials (`TINYBIRD_TOKEN`, `CLICKHOUSE_*`) + destination secrets (Meta/Google/TikTok/Microsoft/OTLP) | Worker secrets, read via `host.getSecret` | Exfiltration = direct access to the operator's analytics data / ad accounts |
| Portal API (`/__attestrack__/portal/v1/*`) | `worker-core/src/portal.ts` | Without Access it is a world-readable and world-writable operator config API |
| Supply chain (npm deps, GitHub Actions, publish pipeline) | `pnpm-lock.yaml`, `.github/workflows/*` | A compromised dep or action runs inside CI and in every deployment |

## 2. Trust boundaries & data flows

```
 visitor browser ──POST /t/event, /__attestrack__/consent/{commit,context},
        │          GET /consent.js /privacy /terms /health──────────────┐
        │  (anonymous, CORS allowlist from site config, consent cookie) │
        ▼                                                               ▼
 ┌─ Cloudflare Worker (operator account) ────────────────────────────────────┐
 │ pipeline: jurisdiction → consent gate → consent log → troll-shield →      │
 │           destinations (parallel) → analytics                             │
 │   ├── KV (same account): config reads; signal-gated consent-event writes; │
 │   │        bounded observability counters/log ring                        │
 │   ├── consent-gated destination egress (operator-configured secrets):     │
 │   │        graph.facebook.com · google-analytics.com/mp · TikTok ·        │
 │   │        Microsoft UET · operator ClickHouse URL · api.tinybird.co ·    │
 │   │        operator OTLP endpoint                                         │
 │   └── NOTHING else. Zero egress to Attestrue origins (INV-B-01/02).       │
 │       The one Attestrue string is a STATIC handoff URL constant in        │
 │       portal.ts (never fetched) — mechanically enforced by                │
 │       `pnpm egress-check` (INV-B-16). No telemetry/analytics SDKs         │
 │       (same gate).                                                        │
 └───────────────────────────────────────────────────────────────────────────┘
        ▲
 operator portal SPA / API clients ── /__attestrack__/portal/v1/*
   (Cloudflare Access assumed in front; optional PORTAL_API_SHARED_SECRET)
```

Consent-event records, counters, and logs never leave the operator's KV. Explore (`POST …/portal/v1/explore/query`) proxies gated SQL to the operator's own warehouse only (`worker-core/src/explore-warehouse.ts`).

## 3. Adversaries → STRIDE analysis

### 3.1 Malicious visitor (anonymous internet traffic)

**Spoofing — consent-token forgery.** Tokens are `k<N>.<payload-b64url>.<sig-b64url>` HMAC-SHA256 envelopes (`sdk/src/consent-token.ts`). See the crypto review (§4): construction is sound; P7.2 added a 128-bit minimum key floor and a verify-time input bound. Site binding (`expectedSiteId`) stops cross-site replay of tokens minted by other Attestrack deployments sharing a secret by accident; expiry is exclusive-boundary checked.

**Tampering — Explore SQL injection.** `POST /explore/query` passes attacker SQL only after `validateAndNormalizeExploreSql` (`schema/src/explore-sql.ts`, INV-B-14/15 gate; nightly Stryker mutation run in `mutation.yml` hunts gate bypasses). Defense in depth: the route sits behind the portal authn boundary (§3.4), and the canonical DDL (`schema/warehouse/clickhouse.sql`) documents least-privilege warehouse users (SELECT on `events` only for Explore). The gate's internals were rewritten/reviewed in P4, not re-audited here.

**Denial of service / cost — consent-event KV flooding (the P7.1 headline).**
*Confirmed pre-P7:* the mandatory `evidence-unsigned` strategy wrote one KV record per pipeline run, and the pipeline runs for every `/t/event` POST **and every unmatched route** (`create-fetch-handler.ts` fallback) — one KV write (billable, TTL 90 days) per anonymous request, no authentication required.
*Fixed* (`strategies/src/mandatory/consent-log.ts`): a record is written only when an actual consent signal exists — a verified token or an honored GPC header — and writes are deduplicated via deterministic keys with read-before-write: `tok:<token-sig>:<effective-decision>` (a GPC flip under the same token still gets its own record) and `gpc:<siteId>:<jurisdiction>:<utc-day>`. Anonymous no-signal floods now write **zero** records; a consented visitor writes **one** per decision. Contract-tested at strategy and worker level (`consent-log.test.ts`, `consent-event-mitigation.contract.test.ts`; the P2.6 consent-matrix suite now pins the record expectation per case).
*Residual:* `/consent/commit` is an unauthenticated mint oracle (the banner requires it), so an attacker can still buy 1 deduped KV write per 2 requests by minting+presenting fresh tokens — see F11; and per-ingest observability writes are bounded — see F9.

**Information disclosure / MITM.** All Worker traffic is Cloudflare-terminated TLS. The consent cookie is `Secure; SameSite=Lax` with a guarded `Domain` (`buildConsentCookie`). Credentialed CORS echoes only the site-config allowlist — non-loopback origins must be `https:` and match `domain`/`trustedDomains` (`worker-core/src/cors.ts`); no wildcard reflection. Tokens contain signed *statements* (decision, policyHash, jurisdiction hint), no secrets or PII.

### 3.2 Malicious operator input (poisoned KV / config)

All KV JSON is parsed defensively with schema validation or safe fallbacks (`readSiteConfig`, `parseConsentConfigJson`, `parseEnabledStrategiesKv`, portal readers) — malformed config degrades to defaults instead of throwing. The dangerous field is `trustedDomains` (it feeds the credentialed-CORS allowlist and can be set via the portal API): whoever can write it can authorize a hostile origin to make credentialed requests. That is precisely why the portal API must not be world-writable (§3.4). Config drift is surfaced by the drift-detection strategy (fingerprint mismatch → TTL'd KV alert → portal banner).

### 3.3 Compromised npm dependency / CI (supply chain — P7.4)

- **`pnpm audit` gate** (`scripts/audit-gate.mjs`, in `ci.yml`): fails on any high/critical advisory in prod dependency paths unless allowlisted with a written rationale (see F6). Failure path verified.
- **Lockfile integrity:** every workflow installs with `--frozen-lockfile`; pnpm verifies package integrity hashes from `pnpm-lock.yaml`.
- **GitHub Actions pinned to commit SHAs** (not floating tags) across all workflows; Dependabot's `github-actions` ecosystem keeps pins fresh.
- **Dependabot** (`.github/dependabot.yml`): weekly npm (grouped minor/patch) + actions.
- **Publish provenance (P5.4):** `publish.yml` already carries `id-token: write`; publishing MUST use `--provenance` when P5 lands.
- **No install scripts run in the Worker:** the runtime bundle is built from workspace sources; `wrangler`/tooling deps never ship to the edge.

### 3.4 Malicious portal caller (operator API without Access — P7.3)

Every route under `/__attestrack__/portal/v1` is **unauthenticated by design**; Cloudflare Access is the assumed front door (PORTAL.1). Verified: the OSS mutations — `strategies/toggle`, `site-config/trusted-domains`, saved-query create/remove — and the warehouse-touching `explore/query` all sit behind only that assumption (policy/banner/mode mutations return `403 requires_attestrue` regardless). **Without Access this is a world-writable config API.**
*Mitigation:* (a) loud documentation (REPO-SPEC-OSS portal section, BEHAVORIAL-SPEC PORTAL.1 amendment, PILOT-OSS deploy guide); (b) optional defense-in-depth shared secret: configure Worker secret `PORTAL_API_SHARED_SECRET` and every portal-prefix request must present `x-attestrack-portal-secret` (constant-time compare) or receive `401 portal_unauthorized`; no-op when unset. Contract-tested in both modes (`portal-auth.contract.test.ts`). The secret is for API clients / header-injecting proxies — never embed it in the public SPA bundle.

### 3.5 Attestrue (the licensed sibling) — boundary abuse

INV-B-01/02/16: the OSS product must never phone home. Enforced mechanically by two CI gates: `boundary-check` (forbidden paths + sibling-name references outside boundary docs) and the P7.5 `egress-check` (sibling *origins* only in an explicit allowlist; exactly one static handoff constant inside `worker-core/src`, whose file must contain no network tokens; zero telemetry-SDK deps/imports). The P7.5 sweep found and fixed sibling branding baked into `deploy/local` (ClickHouse database named after the sibling).

## 4. Consent-token crypto review (P7.2)

**Verdict: sound.** Reviewed `sdk/src/consent-token.ts` in full:

- **HMAC construction** — HMAC-SHA256 via WebCrypto over `k<N>.<payload-b64url>`; the key id participates in the MAC, so re-labeling a token to another keyring entry fails (`bad_signature`, tested).
- **Canonicalization** — payload JSON is serialized with sorted top-level keys (all fields are scalars or order-significant string arrays; no nesting) and verification re-serializes the parsed payload and requires exact string equality (`non_canonical` otherwise), so a signature covers exactly one JSON form. Both base64url segments must additionally be *canonical* encodings (trailing-bit malleability rejected — `isCanonicalBase64Url`).
- **Verification order** — signature is checked (constant-time, fixed 32-byte length) *before* the payload is JSON-parsed; unauthenticated input only undergoes bounded base64 work.
- **Timing-safe compare** — XOR-accumulate loop; the early length mismatch return leaks only length, which is public (fixed-size MAC).
- **Rotation** — versioned keyring (`k<N>.` secret prefixes, `keyringFromSecretValues` with `CONSENT_TOKEN_SECRET_PREVIOUS`); unknown key ids rejected; current key signs.
- **Expiry / TTL** — `expiresAt` is set from site config `state1TokenTTL` on the Worker mint path; verify-time check is exclusive-boundary and `Number.isFinite`-guarded.
- **P2.2 property suites** already pin all of the above (round-trip table, every single-character mutation, every truncation, non-canonical forgery, rotation, site binding).

Two genuine gaps were found and **fixed** (with tests): no minimum key length (F2) and unbounded verify-time input (F3). One SDK-level behavior is **accepted** (F8).

## 5. Findings register (P7 exit: every row fixed-with-test or accepted-with-rationale)

| # | Finding | Status | Where |
|---|---|---|---|
| F1 | Consent-event KV write amplification: 1 KV write per anonymous request (incl. unmatched routes) | **Fixed + tested** — signal-gated writes, deterministic dedup keys | `consent-log.ts`; strategy + worker contract tests; ADR-011 amendment |
| F2 | No minimum HMAC key length — a 1-char `CONSENT_TOKEN_SECRET` minted brute-forceable "evidence" | **Fixed + tested** — 16-byte (128-bit, NIST SP 800-107) mint-time floor; commit route returns `503 consent_secret_too_weak` | `consent-token.ts`, `create-fetch-handler.ts` |
| F3 | Verify accepted unbounded token input (attacker-controlled HMAC/base64 CPU) | **Fixed + tested** — 4096-char bound before any crypto work | `consent-token.ts` |
| F4 | Portal API world-writable without Cloudflare Access | **Mitigated + tested / residual accepted** — loud docs + optional `PORTAL_API_SHARED_SECRET`; Access remains the primary control, and an operator who deploys with neither has been warned in three places | §3.4 |
| F5 | Sibling branding/DB name (`attestrue`) in `deploy/local` dev harness | **Fixed** — renamed; now gated by `egress-check` | `deploy/local/*` |
| F6 | 6 HIGH npm advisories in prod paths (undici ×3, defu, ws, sharp) | **Accepted w/ rationale** — all transitive via `wrangler` (`packages/deploy`): operator-machine deploy CLI tooling, never Worker-runtime code; allowlisted individually in `audit-gate.mjs`, removal flagged automatically, upgrades tracked by Dependabot | `scripts/audit-gate.mjs` |
| F7 | GitHub Actions used floating major tags | **Fixed** — commit-SHA pins + Dependabot actions ecosystem | `.github/workflows/*` |
| F8 | SDK tokens minted without `ttlSeconds` never expire | **Accepted** — the Worker mint path always sets TTL from `state1TokenTTL`; the no-expiry form exists for SDK consumers/tests and is covered by an explicit test documenting the behavior | `consent-token.ts` |
| F9 | Per-ingest observability KV writes (`/t/event` log ring + counters) | **Accepted** — bounded by design: 60-entry hourly ring with 48 h TTL, per-day counters with 1-in-10 sampling above 5 000 events, all best-effort and per-key rate-limited by KV itself; this is the product's own telemetry surface, not an unbounded store | `worker-core/src/observability.ts`, `sdk/src/delivery.ts` |
| F10 | Unmatched routes still run the full pipeline (CPU, not KV, after F1) | **Accepted** — destination/analytics strategies no-op without `ctx.tracking`; post-F1 no KV writes occur without a consent signal; residual CPU cost is bounded by Cloudflare request pricing and is WAF-rate-limitable; tightening routing is a behavior change deferred to the P6 workerd contract work | `create-fetch-handler.ts` |
| F11 | `/consent/commit` is an unauthenticated token-mint oracle | **Accepted** — required by the consent banner (anonymous visitors must be able to commit a decision); tokens contain no secrets, dedup caps the KV amplification at 1 write per 2 requests, and operators should add a Cloudflare WAF rate limit on `/__attestrack__/consent/commit` and `/t/event` (maintainer/operator action below) | §3.1 |

## 6. Maintainer actions (not enforceable from this repo)

- [ ] **npm scope hygiene** before P5 publish: require 2FA for all `@attestrack` org members, restrict publish to CI via provenance/granular tokens, enable "publishing requires 2FA or automation token", publish with `--provenance` only.
- [ ] **Cloudflare Access**: create Access applications covering the portal hostname **and** the Worker's `/__attestrack__/portal/v1/*` paths on every real deployment (deploy CLI banner reminds; PILOT-OSS documents).
- [ ] **WAF rate limits** on `/t/event` and `/__attestrack__/consent/commit` for public properties (F11).
- [ ] **Pre-launch history scan** (P8.6): gitleaks over full history + `git log -S` for sibling references; curate history if hits.
- [ ] Keep the `audit-gate` allowlist honest: entries are re-justified on every wrangler bump; the gate prints stale entries.

## 7. Mechanical gates guarding this model

| Gate | Enforces | Where |
|---|---|---|
| `pnpm egress-check` | INV-B-01/02/16: no sibling-origin egress, single static handoff constant, zero telemetry SDKs | `scripts/egress-check.mjs`, ci.yml |
| `pnpm boundary-check` | ADR-009: forbidden paths, sibling-name references | `scripts/boundary-check.mjs`, ci.yml |
| `pnpm audit-gate` | High/critical advisories in prod paths (documented allowlist) | `scripts/audit-gate.mjs`, ci.yml |
| `pnpm route-contract-check` | HTTP surface matches `docs/oss-http-contract.json`; portal data stays computed | `scripts/check-oss-routes.mjs`, ci.yml |
| Consent matrix + mitigation contract tests | Gate semantics, record-write policy (F1) | `worker-core/__tests__/contract/` |
| Token property suites | Crypto review invariants (§4) | `sdk/__tests__/consent-token*.test.ts` |
