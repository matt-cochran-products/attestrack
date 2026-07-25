# Attestrack — Production-Readiness Completion Plan

**Repo:** `/home/mc/working/attestrue` (Attestrack OSS, MIT — GitHub `matt-cochran/attestrack`)
**Status of this document:** Working plan from stub-heavy "contracts first" state → production-ready public OSS launch.
**Date:** 2026-07-25
**Ground rule:** The repo MUST NOT go public until the checklist in §8 is 100% green. Going public half-built is a reputational risk for a *privacy* product.

---

## 1. Current-state assessment (what is actually in the repo)

The whole codebase is ~5,400 lines of TypeScript across 10 packages. The build pipeline is real and green today (`pnpm typecheck && test && build && route-contract-check && boundary-check && size-check` all pass; 56 unit/contract tests + 2 Playwright smoke tests). That is a good scaffold — but test volume is thin, several core behaviors are placeholders, and at least two **correctness-breaking defects** exist on the primary consent path (§1.2).

### 1.1 Per-package honesty table

| Package | Verdict | Evidence |
|---|---|---|
| `packages/types` | **Implemented (contract spine)** — but `TrackingEventV1` is only `{v, eventName, siteId, occurredAt, consentDecision?, jurisdiction?}` (`src/tracking.ts`). Nowhere near what ANA.2's signal-recovery/attribution/bot questions require. `ATTESTRACK_EXPLORE_MAX_ROWS = 500` (`src/explore.ts`) contradicts BEHAVORIAL-SPEC EXP.5 (10,000). | `src/tracking.ts`, `src/jurisdiction.ts` (good: `ConsentConfig`, `COMMUNITY_DEFAULT_CONSENT_CONFIG`, US-state codes), `src/kv-keys.ts` |
| `packages/schema` | **Implemented** — Zod for consent config/commit, tracking, strategy, consent-event record; `explore-sql.ts` gate is real but regex-based and **bypassable** (§1.2 #3). | `src/explore-sql.ts`, `__tests__/` (6 tests) |
| `packages/sdk` | **Implemented (core)** — HMAC-SHA256 consent token with timing-safe compare and canonical-JSON check (`src/consent-token.ts`), `resolveStrategiesWithReplaces`, mock-host test harness. **Missing:** token expiry/TTL validation (tokens are valid forever), no site/audience binding check at verify time, no key-rotation story. | `src/consent-token.ts`, `src/testing.ts` |
| `packages/worker-core` | **Partial** — `create-fetch-handler.ts` routes are real (`/health`, `/privacy`, `/terms`, `/t/event`, consent commit, portal API). `portal.ts` GET endpoints mostly **echo operator-seeded KV JSON** (dashboard/signal/logs/destinations = stubs unless someone writes KV by hand — acknowledged in `docs/PILOT-OSS.md`). Explore proxy (`explore-warehouse.ts`) genuinely executes against Tinybird/ClickHouse. `config.ts` ("to be implemented") and `degraded.ts` are **explicit placeholders**. **Site mode (SHADOW/ENFORCEMENT) is stored in KV but never read by the pipeline.** No CORS/OPTIONS handling anywhere. | `src/portal.ts`, `src/config.ts`, `src/degraded.ts`, `__tests__/contract/*` (17 tests) |
| `packages/strategies` | **Partial / skeletal** — jurisdiction resolution (EU set + KV rows) and consent-cookie gate are real-but-thin; `troll-shield.ts` is a **literal no-op**; ad-network strategies (meta/google/tiktok/microsoft) are minimal single-event fire-and-forget posts — no retries, no batching, no `event_id` dedup, no PII hashing (Meta CAPI `user_data` is UA-only), errors swallowed so **STR.4 error surfacing is impossible**; `clickhouse.ts` POSTs a raw JSON row with **no INSERT statement** — broken against a vanilla ClickHouse HTTP endpoint unless the operator embeds `?query=INSERT…FORMAT JSONEachRow` in the secret URL (undocumented); `otel.ts` promotes fields (`sessionId`, `pagePath`, `scrollDepthPct`…) that **don't exist on `TrackingEventV1`**; consent-log writes `ConsentEventRecordV1` to KV with a hardcoded 90-day TTL. | `src/mandatory/*`, `src/ad-networks/*`, `src/analytics/*`, `__tests__/` (9 tests) |
| `packages/consent-js` | **Stub → early implementation** — 1.39 kB IIFE bundle builds with size-limit gate (12 kB). Banner is Accept/Decline only: **no IOA checkbox (BAN.3), no config-driven text (BAN.5), no jurisdiction awareness, no withdrawal path**, hardcoded inline styles; GPC auto-declines unconditionally (ignores per-row `gpc_honor`); "script gating" is a `fetch` monkey-patch only (no `<script type="text/plain">` gating). | `src/banner.ts`, `src/init.ts`, `src/commit.ts` |
| `packages/host-contracts` / `host-cloudflare-worker` | **Implemented** for current scope (KV + geo + waitUntil + secrets). No D1/R2 ports despite spec references (CLI.6, CE.1). | `host-contracts/src/index.ts` |
| `packages/deploy` | **Partial, more real than expected** — guided wrangler flow (auth check, KV namespace create/reuse, seed, masked secret put, worker deploy, Pages portal deploy) with contract tests via injected `RunCommandFn`. **But:** requires the monorepo checkout (`file:` deps) so `npx @attestrack/deploy` standalone — the CLI.1 promise — does not work; `d1-schema.sql` is literally `-- TODO: define schema`; no re-run diff (CLI.11 partial); its scaffold README instructs a `<script src="https://{domain}/consent.js">` tag **that the Worker does not serve** (no such route in `create-fetch-handler.ts`). | `src/index.ts`, `src/apply-cloudflare.ts`, `src/d1-schema.sql` |
| `packages/portal-community` | **Shell implemented, data stubbed** — full route set (dashboard, signal, destinations, logs, analytics, explore, strategies, configuration, migration, upgrade, extensions), stub-vs-live API switch per REPO-SPEC (`lib/api/http.ts`), Explore page actually runs queries + CSV export. **Missing:** the entire Appendix-A chart stack (no Recharts/ECharts/CodeMirror/TanStack in `package.json` — no charts at all), autocomplete (EXP.6), pinned queries (EXP.10), confirmations depth (PORTAL.5/6), a11y untested; `Layout.tsx` has `const isDriftAlertActive = true` hardcoded and a hardcoded amber mode chip. | `src/routes/*`, `src/lib/api/*`, `package.json` |
| `e2e/` | **Smoke only** — 2 tests (health, ingest accept) against a **Node `http` dev server wrapping a mock host** (`e2e/scripts/dev-server.mjs`) — **not Miniflare/workerd**, despite `CLAUDE.md`/README claiming "Playwright against Miniflare". No consent journey, no portal e2e. | `e2e/smoke.spec.ts` |
| CI / release | **CI real** (`ci.yml`: typecheck→lint→test→route-contract-check→build→size-check→boundary-check). `publish.yml` is a **stub** (`# TODO: configure per-package npm publish`). `release-please-config.json` is single-root, but the repo intends per-package `@attestrack/*` npm publishing; every package is `0.0.0` and `consent-js`/`worker-core` are `private: true` while `CLAUDE.md` lists consent-js as published. No `SECURITY.md`. | `.github/workflows/*`, `release-please-config.json` |

### 1.2 Launch-blocking defects found (fix before anything else ships)

1. **The consent cookie never reaches the Worker in the documented topology.** `consent-js/src/commit.ts#persistConsentCookie` sets `at_consent` via `document.cookie` **without a `Domain` attribute** → host-only cookie on the *page* origin (e.g. `www.example.com`). The Worker lives on a tracking subdomain (`t.example.com`, per `deploy/src/index.ts` DNS flow), so the cookie is **never sent** to `/t/event` or generic requests, and `strategies/src/mandatory/consent.ts` will always see `consent: null`. Additionally `sendTrackingEvent`/`commitPrivacyConsent` don't set `credentials: 'include'`, and the Worker has **no CORS/OPTIONS handling** at all — cross-origin JSON POSTs with cookies from the customer's site will fail preflight. The consent gate → destination pipeline is architecturally broken end-to-end for the primary deployment model. Fix candidates: Worker sets the cookie via `Set-Cookie` on the commit response (with `Domain=.example.com`, `HttpOnly` optional), plus explicit CORS allowlist derived from site config.
2. **Enforcement/shadow mode is decorative.** `KV_KEY_PORTAL_SITE_CONFIG.mode` is seeded (`deploy/src/kv-schema.ts`) and displayed, but no code path reads it. Today the pipeline *always* enforces (destinations require `decision === 'granted'`), regardless of mode and regardless of the jurisdiction row's `mechanism: 'opt-out'`. That inverts INV-B-03's intent (shadow first) and makes the DEFAULT opt-out row meaningless: opt-out jurisdictions silently lose all destination traffic until users click Accept. Consent semantics (opt-in vs opt-out vs shadow) must be implemented in the composite pipeline.
3. **INV-B-15 table allowlist is bypassable.** `schema/src/explore-sql.ts#extractTableIdentifiers` matches only the first identifier after `FROM`/`JOIN`, and the allowlist includes the literal `default` (`types/src/explore.ts`) — which is a ClickHouse *database* name. `SELECT * FROM default.any_other_table` passes the gate (regex captures `default`, ignores `.any_other_table`). Qualified names (`db.table`) must be parsed and rejected/resolved; `default` should not be an allowlisted "table".
4. **Quickstart is broken as documented.** The scaffold tells users to embed `/consent.js` (never served); `README.md` clone URL (`github.com/attestrue/attestrue`) and badges (`matt-cochran/attestrue`) disagree with the actual repo (`matt-cochran/attestrack`); `CLAUDE.md`'s package layout describes a pre-ADR-010 world (consent/jurisdiction "licensed", `routes/consent-log/`, `lib/cf-kv.ts` — none exist).

### 1.3 Spec-vs-code coherence gaps (doc debt)

- `docs/USER-JOURNEY.SPEC.md` v2.0 flatly states "Attestrack does not include consent enforcement"; ADR-010 / ADR-002 (amended, later precedence per `docs/OSS-SCOPE-MATRIX.md`) say Attestrack ships a *complete community consent path*. Resolve in writing before public launch — contributors will be confused otherwise.
- `docs/REPO-SPEC-OSS.md` and `OSS-SCOPE-MATRIX.md` contain relative links into `../../attestrue-premium/…` — broken (and boundary-leaking) for every public cloner. `scripts/boundary-check.mjs` allowlists these files; the *links* should still be converted to plain-text references.
- BEHAVORIAL-SPEC Parts IV–VIII (CE/EC/BAN/POL) are explicitly historical/licensed — fine — but the OSS reader has no single "what this repo actually does" doc besides REPO-SPEC. CONOPS-OSS-SNAPSHOT helps; keep it current as behavior lands.

### 1.4 Top production risks (ranked)

1. **Consent correctness** (§1.2 #1–2): a privacy product whose consent gate silently never fires, or that mis-handles opt-out jurisdictions, is the reputational kill-shot.
2. **Analytics value gap:** `TrackingEventV1` spine + no warehouse DDL + broken ClickHouse insert + no client beacon means the headline "signal recovery / GA alternative" claims are currently unfulfillable. README promises must match shipped behavior at launch.
3. **Explore proxy security** (§1.2 #3) — INV-B-14/15 are advertised invariants; a bypass published in an OSS repo would be found within days.
4. **Ops/DX cliff:** `npx @attestrack/deploy` doesn't work standalone; publish pipeline is a TODO; portal shows stub data by default. First-hour experience decides OSS credibility.
5. **Boundary/trust optics:** premium-repo links, stale CLAUDE.md, "Miniflare" claims that aren't true, `d1-schema.sql` TODO — small things that read as "half-built" the moment the repo is public.

---

## 2. Phased roadmap

Milestone rule: each milestone leaves `main` green (all §5 gates), is independently shippable, and updates REPO-SPEC/OSS-SCOPE-MATRIX/contract JSON in the same PR (per `docs/TEST-STRATEGY.md` exit criteria).

### Phase 0 — Truth & identity baseline (prerequisite for everything) — **S**

*Goal: the repo tells the truth about itself; decisions that shape later phases are locked.*

- **P0.1** Fix repo identity: README clone URL/badges → `matt-cochran/attestrack`; rewrite `CLAUDE.md` to match actual `packages/` layout (post-ADR-010: consent/jurisdiction/consent-js are OSS; no `routes/consent-log`); align `.cursorrules`.
- **P0.2** Doc coherence pass: amend `docs/USER-JOURNEY.SPEC.md` (or add a v2.1 note) to match ADR-010 community-consent scope; de-link `attestrue-premium` relative paths (plain-text citations); reconcile EXP.5 row limit (pick 10,000 per spec or amend spec to 500 — recommend amending spec, 500 is fine for KV-era, revisit later).
- **P0.3** Decision log (mini-ADRs, one page each):
  - D1/R2 in OSS scope? (Today: unused; `d1-schema.sql` is TODO; consent events sit in KV with 90-day TTL.) Recommend: **cut D1/R2 from v1**, keep KV-only, delete the TODO SQL file, and amend CLI.6 scope note — or commit to D1 for consent-event log (removes the KV TTL/records-listing limitation). Decide now; Phases 2–3 depend on it.
  - Consent cookie topology (Worker-set `Set-Cookie` + `Domain` vs first-party proxy path) — feeds Phase 2.
  - Warehouse contract: canonical `events` table DDL ownership (repo ships DDL + migration doc) — feeds Phase 1.
- **P0.4** Add `SECURITY.md` (private reporting via GitHub advisories), `CODE_OF_CONDUCT.md`, issue templates.
- **Exit:** no false statement in any top-level doc; decisions D1–D3 merged as ADR-011..013.

### Phase 1 — Canonical event schema + warehouse write path — **M**

*Goal: `/t/event` → warehouse actually works against a fresh ClickHouse/Tinybird with schema this repo ships.*

- **P1.1** Extend `TrackingEventV1` (or add v2 with Zod migration) in `types`/`schema`: `sessionId`, `visitorId` (first-party, salted-hash policy per `ipHandling`), `pagePath`, `referrer`, `utm*`, `userAgent` class, `props` (bounded), `eventId` (dedup), delivery metadata. Keep the closed-cardinality discipline `otel.ts` already documents — and make `otel.ts`'s ATTR_KEYS real fields.
- **P1.2** Ship warehouse DDL: `packages/schema/warehouse/clickhouse.sql` (CREATE TABLE `events` …) + Tinybird datasource definition; document required grants (read-only Explore user vs insert user — least privilege, see §6).
- **P1.3** Fix `strategies/src/analytics/clickhouse.ts`: build a real `INSERT INTO events FORMAT JSONEachRow` HTTP call (URL = origin + query param), map event → columns explicitly (no `...ctx.tracking` spread), handle non-2xx by recording a delivery-error counter in KV (feeds STR.4/Phase 3). Same error-recording for `tinybird.ts`.
- **P1.4** Ingest hardening on `/t/event`: payload size cap, `eventId` idempotency note, per-IP rate limit hook (host port), explicit CORS for the commit + event routes (allowlist from site config `trustedDomains`/domain).
- **P1.5** Integration tests: dockerized ClickHouse in CI (service container) exercising insert + Explore round-trip; contract tests for the new schema.
- **Exit:** clean clone → deploy → curl an event → `SELECT count() FROM events` in Explore returns 1. This is the demo spine.

### Phase 2 — Consent path correctness (the reputational core) — **L**

*Goal: every INV-B consent invariant that is OSS-scoped is mechanically true; the four §1.2 defects are dead.*

- **P2.1** Cookie/topology fix (per P0.3 decision): consent commit response issues `Set-Cookie` with configurable `Domain` (from site config), `Secure; SameSite=Lax`; `consent-js` stops writing document.cookie for cross-subdomain deployments (keep as fallback for same-origin); clients send `credentials: 'include'`; Worker CORS allowlist + OPTIONS handling with contract tests. Serve **`GET /consent.js`** from the Worker (bundle embedded at build; content-hashed cache headers) so the scaffold script tag works; add route to `docs/oss-http-contract.json` + `check-oss-routes.mjs`.
- **P2.2** Token hardening in `sdk/src/consent-token.ts`: `expiresAt`/TTL from site config `state1TokenTTL` (verify-time check), verify-time `siteId` binding, versioned-key rotation (`k1.` prefix), property-based tests (fast-check: round-trip, tamper, non-canonical, truncation).
- **P2.3** Mode + mechanism semantics in the pipeline (`worker-core`): read site-config mode once per request (cached); **SHADOW** = destinations run, would-be-decision recorded; **ENFORCEMENT** = gate applies; `mechanism: 'opt-out'` rows allow destinations absent a declined token; GPC honored per row (`gpc_honor`) server-side (already partially in `consent.ts`) *and* client-side (consent-js must fetch the resolved row — add `GET /__attestrack__/consent/context` returning jurisdiction key + row + policy refs; add to route contract). Record decision + mode + mechanism in the tracking row for analytics honesty (DASH.3's "would be the enforced rate").
- **P2.4** `consent-js` to community-banner spec: config-driven copy from `/consent/context` (IOA assertion lines rendered as required checkboxes — INV-B-06; Reject All visually co-equal — INV-B-07), withdrawal/re-open API (`AttestrackConsent.open()`), `withdrawn` decision path, script gating helper (`<script type="text/plain" data-attestrack-category>` activation) in addition to the fetch guard, a11y (focus trap, ARIA, keyboard), stay under the 12 kB size-limit budget (raise deliberately if needed — it's a gate).
- **P2.5** Consent event record correctness: TTL becomes operator-configurable (or D1 per P0.3); `ioaAttested` must reflect actual IOA acceptance, not `consent != null`; record `mechanism` and `mode`.
- **P2.6** Consent property/scenario test suite: matrix of {jurisdiction row, GPC, mode, mechanism, token state (none/valid/expired/tampered/withdrawn)} × expected destination behavior — table-driven contract tests named for invariants (per TEST-STRATEGY). This suite is the trust artifact for the launch announcement.
- **Exit:** the consent matrix suite passes under workerd (see Phase 6), and a manual two-subdomain demo (page on `www.`, worker on `t.`) shows grant → Meta stub receives, decline → nothing received, GPC → declined, opt-out row → flows until declined.

### Phase 3 — Worker observability & live portal data — **M/L**

*Goal: the portal shows real data from the operator's own infra; PILOT-OSS's "stub or operator-seeded values" caveat is deleted.*

- **P3.1** Request/delivery logging: ring-buffer log writer in worker-core (KV or Durable-Object-free: bounded KV list per hour) feeding `GET /logs*`; strategy delivery results (status, error text) recorded per destination → `GET /destinations` and STR.4 error surfacing; kill the hardcoded `isDriftAlertActive = true` in `Layout.tsx`.
- **P3.2** Dashboard metrics: compute `eventsToday`, per-destination health, drift alert count in the Worker (KV counters incremented on the hot path with sampling, or scheduled-cron rollup via warehouse query when configured) — replacing operator-seeded `attestrack:portal:dashboard` JSON.
- **P3.3** Signal recovery (ANA.2 honest subset): define what OSS can honestly measure v1 — server-side events received vs client-beacon-blocked comparison requires a client ping; implement minimal beacon in consent-js/sdk (`sendTrackingEvent` already exists) + blocked-detector, or **de-scope signal-recovery claims from v1 dashboard and label the view "requires beacon"**. Do not ship a chart backed by invented numbers. Amend ANA copy accordingly.
- **P3.4** Troll-shield: implement minimal honest bot heuristics (UA class, missing headers, optional CF bot-score passthrough via host port) or rename/remove the strategy. A named no-op "shield" in a public repo is a credibility bug.
- **P3.5** Drift detection: wire `attestrack:drift:mismatch` into `/alert-rules`/dashboard; deploy writes `KV_KEY_DRIFT_EXPECTED` at seed time (today nothing ever sets it).
- **Exit:** fresh deploy + traffic ⇒ dashboard/destinations/logs populate with no manual KV seeding; PILOT-OSS caveat removed.

### Phase 4 — Explore hardening + analytics UI — **M**

- **P4.1** Rewrite the SQL gate (fix §1.2 #3): tokenize identifiers incl. qualified `db.table`; drop `default` from the table allowlist (or treat it as database prefix resolving to allowlisted tables only); handle comments (`--`, `/* */`) before keyword scan; add `SETTINGS`/`FORMAT` clause policy; fuzz/property tests (adversarial corpus: qualified names, comment-hiding, unicode homoglyphs, nested parens). Keep "when in doubt, reject" (Appendix A).
- **P4.2** Charting per Appendix A: Recharts for curated views, ECharts for Explore viz, CodeMirror 6 SQL editor with schema autocomplete (EXP.6 — schema from `types`), TanStack Table for results (EXP.7). All MIT/Apache; verify licenses in the supply-chain pass (§6).
- **P4.3** Curated analytics views (ANA.*) backed by canned SQL through the same proxy: consent rate by jurisdiction over time (from Phase 2 recorded decisions), destination success rate, events volume; empty-state → strategies link (EXP.13/ANA.3 already partially in portal).
- **P4.4** Saved queries: Zod-validate KV shape, per-user pinning (EXP.10) or explicitly de-scope pinning to post-v1 (CF Access user identity isn't plumbed; pinning "personal to the user" needs the `Cf-Access-Authenticated-User-Email` header — small worker addition).
- **Exit:** EXP.1–13 either pass a contract test or are explicitly de-scoped in OSS-SCOPE-MATRIX with rationale.

### Phase 5 — Deploy & ops productization — **M**

- **P5.1** Standalone `npx @attestrack/deploy` (CLI.1/CLI.12): publish `worker-core`, `host-cloudflare-worker`, `strategies` to npm (flip `private: true` off; they're MIT anyway) so the scaffold uses versioned deps, not monorepo `file:` paths; keep monorepo path as dev mode. This unblocks the README quickstart for real users.
- **P5.2** CLI.2–CLI.11 completion: step numbering/progress, retry-on-recoverable-error prompts, re-run diff display (CLI.11 — show KV seed/wrangler.toml diff before apply), credential-masking audit + a test asserting secrets never hit stdout/log (INV-B-10 gate), DNS instructions already good (`dns-guide.ts`) — add route verification poll ("wait up to 24h" per CLI.8).
- **P5.3** Cloudflare Access: offer optional automated Access-app creation via API token (or keep manual with a verified checklist); the completion banner warning exists — add a post-deploy `--verify` command that checks `/health`, portal 302-to-Access, and consent commit.
- **P5.4** Versioning/release: convert `release-please-config.json` to per-package manifests (`@attestrack/*`), implement `publish.yml` (npm provenance/`id-token: write` is already set — use `npm publish --provenance`), tag-driven, changelog per package; portal Pages deploy stays customer-side (do **not** auto-deploy a hosted portal — INV-B-11).
- **P5.5** Migrations/rollback doc: KV key versioning policy (additive keys, `v` fields), Worker rollback = `wrangler rollback` + KV seed compatibility statement; document in self-host guide.
- **Exit:** `npx @attestrack/deploy` from an empty directory on a clean machine reaches a working worker+portal; publish workflow proven against a dry-run registry (or npm dist-tag `next`).

### Phase 6 — Testing & quality gates (runs alongside phases 1–5, closes after) — **M**

- **P6.1** **Real Worker runtime tests:** replace/augment the Node mock server (`e2e/scripts/dev-server.mjs`) with `wrangler dev`/workerd or `@cloudflare/vitest-pool-workers` so KV semantics, `waitUntil`, `cf-ipcountry`, and Set-Cookie behavior are tested in the actual runtime. The "Playwright against Miniflare" claim becomes true instead of aspirational.
- **P6.2** E2E journeys: consent banner grant/decline/GPC via Playwright browser context (page origin ≠ worker origin — validates P2.1), Explore query round-trip, portal live-mode smoke against workerd.
- **P6.3** Property tests: consent token (P2.2), SQL gate fuzz (P4.1), `resolveStrategiesWithReplaces` (replaces/ordering laws).
- **P6.4** Coverage targets as CI gates: `sdk`/`schema`/`strategies`/`worker-core` ≥ 85% line on consent+explore paths; portal component tests for confirmation dialogs and empty states (PORTAL.5/8); do not chase % on presentational code.
- **P6.5** A11y: `vitest-axe`/Playwright-axe on portal routes and the consent banner; keyboard-only run for banner (part of P2.4 exit).
- **P6.6** Promote existing checks to branch-protection-required: `route-contract-check`, `boundary-check`, `size-check` (extend size-limit to the worker bundle — CF has a 1 MB gzip limit), plus new: INV-B grep-gates (no `attestrue.com` fetches outside the documented handoff constant — INV-B-01/02 mechanical check), secret-echo test (INV-B-10).
- **Exit:** CI matrix green incl. workerd + ClickHouse containers; TEST-STRATEGY.md updated to describe reality.

### Phase 7 — Security & privacy review — **M**

- **P7.1** Threat model (STRIDE-lite, one doc in `docs/`): assets = consent tokens, KV config, warehouse creds, portal API; adversaries = malicious visitor (token forgery, SQL injection via Explore, consent-event KV flooding), malicious operator input, compromised npm dep, MITM. Explicitly model **consent-event KV write amplification** (every anonymous request writes a KV record via `evidence-unsigned` — cost/DoS vector; add sampling/dedup or write only on decision events).
- **P7.2** Crypto review of the token (external eyes or high-capability model pass): HMAC construction, canonicalization, timing-safe compare (present), rotation, TTL (from P2.2).
- **P7.3** Portal API authn statement: portal worker routes are **unauthenticated by design** (Cloudflare Access assumed in front — PORTAL.1). Verify that's loudly documented, that `strategies/toggle`, `trusted-domains`, saved-queries writes are behind the same assumption, and add an optional shared-secret header check for defense-in-depth (operators without Access shouldn't have a world-writable config API — today they do).
- **P7.4** Supply chain: `pnpm audit` gate, dependabot/renovate, pin GitHub Actions by SHA, `pnpm-lock.yaml` integrity, license scan of new chart deps, npm provenance on publish (P5.4), 2FA/org hygiene for the npm scope `@attestrack`.
- **P7.5** First-party-data audit: grep-verified zero egress to Attestrue origins except the static `handoff` URL constant in `portal.ts` (INV-B-01/02/16) — automate as the Phase 6 grep-gate; document data flows (event → KV/warehouse/destinations; nothing else).
- **Exit:** threat-model doc merged; all P7 findings fixed or accepted-with-rationale in the doc; security review sign-off recorded.

### Phase 8 — Docs, DX & go-public — **M**

- **P8.1** Quickstart that works from clean clone (re-verify every command on a fresh machine/container; the current README quickstart references the wrong clone URL and a marketing-site repo).
- **P8.2** Self-host guide: consolidated from PILOT-OSS + new material (warehouse DDL, Access, CORS/cookie domain config, secret list — the scaffold README's secret table is a good seed), troubleshooting (error-code table from REPO-SPEC).
- **P8.3** API/contract docs: publish `oss-http-contract.json`-derived route reference; KV key registry; consent token format (public, community tier — the CETS pointer stays a pointer).
- **P8.4** Adapter-authoring guide: flesh out `ADAPTER-DEVELOPMENT-GUIDE.md` (29 lines today) + `sdk/examples/` (verify they exist and compile — CLAUDE.md lists them; confirm), STR.5 GitHub submission process (PR template for community strategies).
- **P8.5** Demo: a public demo property (operator's own CF account) + a 5-minute "deploy → consent → event → Explore" screencast/gif for the README. This is the go-public proof artifact.
- **P8.6** Launch mechanics: squash/curate git history if premium references exist in history (`git log -S attestrue-premium`), verify no secrets ever committed (gitleaks over full history), enable branch protection, then flip public.

---

## 3. Correctness & trust (cross-cutting requirements)

- **Consent/legal correctness first-class:** Phase 2 exit criteria are the bar; no launch with §1.2 #1/#2 open. Community defaults (`COMMUNITY_DEFAULT_CONSENT_CONFIG`) must keep the "not legal advice" framing (already present in TSDoc — surface it in the portal Site Config view and docs). Note GB/UK: not in the EU set (`jurisdiction.ts`) and no UK row in defaults → falls to opt-out DEFAULT; either add a UK row to defaults or document the gap explicitly (attorney-maintained rows are the paid product; the *default* must still not be obviously wrong for a major market).
- **Honest-null boundary (ADR-010):** the repo already builds/runs with zero premium packages (verified: full pipeline green with `noopStrategyLoader`). Keep it that way with a CI job that builds the deploy scaffold worker as-is. `requires_attestrue` 403 surface is implemented and contract-tested — preserve via `check-oss-routes.mjs` (already a gate).
- **No telemetry-to-vendor:** no analytics/telemetry SDKs exist in the repo today (verified by dependency review); enshrine with the INV-B-01 grep-gate (Phase 6) so it can't regress.
- **Honest labeling:** every place the portal or docs could over-claim (signal recovery stubs, unsigned records, "Miniflare" testing, dashboard stub data) is either implemented or relabeled by Phase 3/8. "Do not ship a chart backed by invented numbers" is a launch rule.

## 4. Testing & quality — summary of gates (detail in Phase 6)

| Gate | Exists today | Target |
|---|---|---|
| typecheck/lint/test/build | ✅ green | keep; add coverage thresholds |
| `route-contract-check` | ✅ | keep; extend for new routes (`/consent.js`, `/consent/context`, CORS) |
| `boundary-check` (ADR-009) | ✅ | keep; add history scan pre-launch |
| `size-check` | ✅ consent-js only (12 kB budget, 1.39 kB actual) | add worker bundle budget |
| workerd runtime tests | ❌ (Node mock) | required |
| Consent matrix property suite | ❌ | required (Phase 2) |
| Warehouse integration (ClickHouse container) | ❌ | required (Phase 1) |
| SQL-gate fuzz corpus | ❌ | required (Phase 4) |
| a11y (banner + portal) | ❌ | required (Phases 2/4) |
| INV-B grep-gates (egress, secret-echo) | ❌ | required (Phase 6) |

## 5. Security & privacy — summary (detail in Phase 7)

Threat model doc; token crypto review; Explore gate rewrite; portal-API authn statement + optional shared secret; KV write-amplification mitigation; supply-chain (audit gate, pinned actions, provenance publish); `SECURITY.md`; full-history secret scan before flipping public.

## 6. Deployment & ops — summary (detail in Phase 5)

Customer-account-only provisioning (INV-B-11 — already true in `apply-cloudflare.ts`); D1/R2 scope decision (P0.3); standalone npx via published packages; per-package release-please + real `publish.yml` with provenance; KV/versioning migration policy; `deploy --verify` post-checks; rollback doc.

## 7. Docs & DX — summary (detail in Phase 8)

Working quickstart, self-host guide, route/KV/token reference, adapter guide, contributing (exists, decent), security policy, demo property + screencast.

---

## 8. Go-public readiness bar (all boxes checked before the repo is public)

**Core paths — no stubs:**
- [ ] §1.2 defects 1–4 fixed with regression tests (cookie/CORS topology, mode/mechanism semantics, SQL-gate qualified-name bypass, quickstart/`/consent.js`)
- [ ] `worker-core/src/config.ts` and `degraded.ts` implemented or deleted (no "to be implemented" files anywhere: `grep -ri "to be implemented\|TODO" packages/` clean, incl. `d1-schema.sql`, `publish.yml`)
- [ ] `troll-shield` is real or removed
- [ ] Ingest → warehouse works against repo-shipped DDL (ClickHouse and Tinybird), verified in CI
- [ ] Consent journey (grant/decline/GPC/withdraw/opt-out row/shadow vs enforcement) passes the matrix suite **under workerd** and a cross-subdomain browser e2e
- [ ] Portal shows live data on a fresh deploy without manual KV seeding; every stub-only view is either live or explicitly labeled + de-scoped in OSS-SCOPE-MATRIX

**Gates green:**
- [ ] CI (typecheck/lint/test/build) + route-contract + boundary + size + coverage + a11y + INV-B grep-gates + secret-echo test, all required on branch protection
- [ ] E2E (workerd + Playwright browser) green in CI
- [ ] `npx @attestrack/deploy` works standalone from published packages; `publish.yml` proven (dist-tag `next` dry run)

**Trust & docs:**
- [ ] Threat model merged; token crypto reviewed; portal-API authn stance documented; `SECURITY.md` present
- [ ] Full-history secret + boundary scan clean (gitleaks; `git log -S` for premium references); history curated if needed
- [ ] README/CLAUDE.md/docs contain zero false claims (repo URLs, Miniflare, consent scope, dashboard data); premium links de-linked
- [ ] Quickstart re-executed on a clean machine by someone other than the author
- [ ] Live demo deployment + screencast linked from README
- [ ] LICENSE/notices verified for all new deps (charts stack); CONTRIBUTING + strategy-PR template in place
- [ ] OSS-SCOPE-MATRIX "Evidence" column filled for every OSS row (no `—` on shipped behavior)

---

## 9. Sequencing, parallelism, sizing, and model tiering

```
P0 ──► P1 ──► P3 ──► P4 ─┐
  └──► P2 ───────────────┼──► P6 close ──► P7 ──► P8 ──► PUBLIC
  └──► P5 (after P1) ────┘         (P6 runs continuously from P1)
```

- **P0** first, one week of honest cleanup and three decisions.
- **P1 and P2 can run in parallel** (different packages; P2.1 CORS touches worker-core routing — coordinate on `create-fetch-handler.ts`).
- **P3 depends on P1** (metrics need the schema) and P2.3 (decision recording). **P4** depends on P1 (warehouse) and pairs UI work that can parallelize with P3. **P5** can start after P1 (publish needs stable package surfaces) and runs largely parallel.
- **P6** is continuous (each phase lands its tests) with a closing hardening sprint. **P7** after feature freeze. **P8** last, plus P8.1/P8.4 drafting can start anytime.

| Phase | Size | Model tier recommendation |
|---|---|---|
| P0 Truth baseline | **S** | Commodity execution; decisions D1–D3 need the maintainer + a high-capability model for the ADR analysis |
| P1 Schema + warehouse | **M** | High-capability for schema/DDL design (long-lived public contract); commodity for strategy plumbing/tests |
| P2 Consent correctness | **L** | **High-capability throughout** — cookie/CORS topology, token crypto, mode/mechanism semantics are the product's reputation; review by a second high-capability pass |
| P3 Observability/live portal | **M/L** | Commodity with high-capability design of the KV counter/log approach (hot-path cost) |
| P4 Explore + charts | **M** | High-capability for the SQL-gate rewrite + fuzz corpus (security-sensitive); commodity for the chart UI |
| P5 Deploy/ops | **M** | Commodity; high-capability only for the publish/versioning strategy |
| P6 Testing gates | **M** | Commodity, guided by the test matrices defined in P2/P4 |
| P7 Security review | **M** | **High-capability / human security review** — non-delegable to commodity |
| P8 Docs/launch | **M** | Commodity writing; maintainer does the clean-machine quickstart run and the final go-public checklist personally |

Rough critical path: P0 → P2 → P6-close → P7 → P8. The single largest schedule risk is P2 (consent semantics touch types→schema→sdk→strategies→worker-core→consent-js→portal); start it immediately after P0 decisions.

---

*Sources examined: `README.md`, `CLAUDE.md`, `docs/BEHAVORIAL-SPEC.md` (INV-B-01..17), `docs/USER-JOURNEY.SPEC.md`, `docs/REPO-SPEC-OSS.md`, `docs/OSS-SCOPE-MATRIX.md`, `docs/TEST-STRATEGY.md`, `docs/PILOT-OSS.md`, `ADR/ADR-002/-007/-008/-009/-010`, all `packages/*/src` and `__tests__`, `e2e/`, `.github/workflows/*`, `scripts/*.mjs`, `turbo.json`, `release-please-config.json`; full pipeline executed 2026-07-25 (green: 11 turbo tasks, 56 unit/contract tests, 2 e2e).*
