# Attestrack (Public Repository)

**Repository:** `github.com/matt-cochran/attestrack` (currently private, pre-launch)
**License:** MIT
**Purpose:** Attestrack — self-hosted analytics, server-side measurement, and **community consent** (`consent-js` + KV `ConsentConfig` + mandatory Worker strategies, per ADR-010); attorney-maintained regulation and Proof are licensed Attestrue extensions
**Last updated:** 2026-07-25

## Quick Start

```bash
pnpm install
pnpm build                  # Build all packages (Turborepo)
pnpm test                   # Run all tests
pnpm typecheck              # TypeScript checking across all packages
pnpm lint                   # ESLint (flat config, repo root)
pnpm size-check             # consent-js bundle budget (12 kB, size-limit)
pnpm boundary-check         # ADR-009: forbidden paths + licensed-sibling references
pnpm route-contract-check   # docs/oss-http-contract.json vs worker-core source
pnpm egress-check           # P7.5: no sibling-origin egress; zero telemetry SDKs
pnpm audit-gate             # P7.4: high/critical npm advisories (documented allowlist)
```

**Requirements:** Node >= 20, pnpm 9

## Toolchain

- **Package manager:** pnpm 9 (workspaces: `packages/*`, `tooling/*`, `e2e/`, `deploy/local`)
- **Build orchestration:** Turborepo — tasks `typecheck`, `lint`, `test`, `build`, `size-check`, `boundary-check`; `lint` runs at the repo root (`eslint .`)
- **Language:** TypeScript 5.5+ (strict mode, ES2022 target — `tooling/tsconfig/base.json`)
- **Test framework:** Vitest (unit + contract tests in `packages/*/__tests__` and co-located `*.test.ts`)
- **E2E:** Playwright smoke tests (`e2e/smoke.spec.ts`) against a **Node `http` dev server** (`e2e/scripts/dev-server.mjs`) that wraps `createAttestrackFetchHandler` with a mock host — **not** Miniflare/workerd yet (planned: Phase 6 of `ATTESTRACK-PRODUCTION-PLAN.md`)
- **Mutation testing:** Stryker, scoped to the Explore SQL gate (`packages/schema`, nightly `mutation.yml`)
- **Consent script:** `packages/consent-js` builds a Rollup IIFE (`dist/consent.js`); `packages/worker-core/scripts/embed-consent-bundle.mjs` embeds it so the Worker serves `GET /consent.js` first-party

## Code Conventions

- `@typescript-eslint/no-explicit-any` is an **error** (lint-enforced) — never use `any`
- Prevailing style: single quotes, no semicolons (not lint-enforced; match surrounding code)
- Portal: business logic in hooks (`src/hooks/`), components presentational
- Narrow imports; types flow downward through the dependency graph (no cycles)

## CI Pipelines

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PR + push to `main`/`dev` | audit-gate, typecheck, lint, test, route-contract-check, build, size-check, boundary-check, egress-check |
| `e2e.yml` | PR + push to `main` | Playwright smoke against the Node dev server |
| `mutation.yml` | nightly + manual | Stryker on `packages/schema` Explore SQL gate (INV-B-15) |
| `publish.yml` | tags `<component>-v*` + manual dispatch | Per-package npm publish with provenance (P5.4); needs maintainer `NPM_TOKEN` — see `docs/RELEASING.md` |
| `release-please.yml` | push to `main` | Release PRs; per-package manifest (8 publishable packages, `node-workspace` plugin) |

## npm Packages

All packages are version `0.0.0`; **nothing is published to npm yet** (first publish is a maintainer step — `docs/RELEASING.md`). Publish-ready (no `private` flag, `files`/`publishConfig.access: public` set, dry-run publish verified): `@attestrack/types`, `@attestrack/schema`, `@attestrack/sdk`, `@attestrack/host-contracts`, `@attestrack/host-cloudflare-worker`, `@attestrack/strategies`, `@attestrack/worker-core`, `@attestrack/deploy`. Marked `private: true`: `consent-js` (embedded into worker-core), `portal-community` (customer-side Pages deploy — INV-B-11), `e2e`, `local-dev`.

## Package Dependency Graph

```
@attestrack/host-contracts   (no deps)
       |
       |---> @attestrack/host-cloudflare-worker   (host-contracts + CF types)
       |
@attestrack/types            (no deps)
       |
       |---> @attestrack/schema     (types + zod)
       |           |
       |           '---> @attestrack/sdk        (types + schema + host-contracts)
       |                       |
       |           .-----------'
       |           |
       |---> consent-js             (types)
       |---> worker-core            (host-contracts + types + schema + sdk; consent-js + strategies as devDeps)
       |---> strategies             (types + schema + sdk)
       |---> portal-community       (types + schema)
       '---> deploy                 (types)
```

No circular dependencies. Types flow downward. Nothing flows up.

## Repository Structure

```
attestrack/
|
|-- .github/
|   |-- workflows/                    # ci, e2e, mutation, publish (stub), release-please
|   |-- ISSUE_TEMPLATE/               # bug report, feature request, security -> advisories
|   |-- CODEOWNERS
|   '-- pull_request_template.md
|
|-- packages/
|   |
|   |-- types/                        # @attestrack/types — public contracts (zero deps)
|   |   '-- src/: tracking.ts, strategy.ts, consent.ts, consent-gate.ts,
|   |             consent-event-record.ts, jurisdiction.ts (ConsentConfig,
|   |             COMMUNITY_DEFAULT_CONSENT_CONFIG), regulation.ts, explore.ts,
|   |             kv-keys.ts (KV key registry), index.ts
|   |
|   |-- schema/                       # @attestrack/schema — Zod runtime validation
|   |   |-- src/: tracking.schema.ts, strategy.schema.ts, consent.schema.ts,
|   |   |         consent-event-record.schema.ts, jurisdiction.schema.ts,
|   |   |         explore-sql.ts (INV-B-14/15 SQL gate + adversarial/hardening tests)
|   |   '-- warehouse/clickhouse.sql  # Canonical `events` DDL (ADR-013)
|   |
|   |-- sdk/                          # @attestrack/sdk — strategy author kit
|   |   |-- src/: interfaces.ts, consent-token.ts (HMAC token: TTL, siteId
|   |   |         binding, k<N>. rotation), consent-gate.ts (mode/mechanism
|   |   |         semantics), strategy-resolution.ts (resolveStrategiesWithReplaces),
|   |   |         testing.ts (mock host runtime), helpers.ts
|   |   |-- examples/: minimal-adapter/, analytics-adapter/
|   |   '-- docs/: ADAPTER-GUIDE.md, HOST-GUIDE.md, TESTING.md, PUBLISHING.md
|   |
|   |-- consent-js/                   # @attestrack/consent-js — first-party banner IIFE
|   |   |-- src/: init.ts, banner.ts (IOA checkboxes, co-equal Reject all),
|   |   |         commit.ts (credentialed fetch; Worker sets the cross-subdomain
|   |   |         cookie via Set-Cookie), gpc.ts, paths.ts
|   |   '-- templates/community-default-consent-config.json
|   |
|   |-- host-contracts/               # @attestrack/host-contracts — host port types
|   |-- host-cloudflare-worker/       # @attestrack/host-cloudflare-worker — CF adapter
|   |
|   |-- worker-core/                  # @attestrack/worker-core — Worker runtime
|   |   |-- src/: create-fetch-handler.ts (routes: /health, /privacy, /terms,
|   |   |         /consent.js, /__attestrack__/consent/{commit,context}, /t/event,
|   |   |         CORS preflight, Set-Cookie consent cookie), cors.ts, config.ts
|   |   |         (site config KV reader), composite.ts, enabled-strategies.ts,
|   |   |         portal.ts (portal API + requires_attestrue 403s),
|   |   |         explore-warehouse.ts (Tinybird/ClickHouse proxy),
|   |   |         policy-server.ts, loader.ts (extension slot), degraded.ts,
|   |   |         registry.ts, constants.ts
|   |   |-- __tests__/contract/       # route/CORS/consent-matrix/explore contract tests
|   |   '-- scripts/embed-consent-bundle.mjs
|   |
|   |-- strategies/                   # @attestrack/strategies — bundled strategies
|   |   '-- src/: mandatory/ (jurisdiction.ts, consent.ts, consent-log.ts,
|   |             troll-shield.ts — currently a no-op placeholder, plan P3.4),
|   |             ad-networks/ (meta.ts, google.ts, tiktok.ts, microsoft.ts),
|   |             analytics/ (clickhouse.ts, tinybird.ts, otel.ts),
|   |             drift/detection.ts, index.ts (allBundledStrategies)
|   |
|   |-- portal-community/             # @attestrack/portal-community — React SPA (CF Pages)
|   |   '-- src/: routes/ (dashboard, signal, destinations, logs, analytics,
|   |             explore, strategies, configuration, migration, extensions,
|   |             upgrade), hooks/, components/, lib/api/ (stub-vs-live switch
|   |             per VITE_ATTESTRACK_API_BASE_URL)
|   |
|   '-- deploy/                       # @attestrack/deploy — guided CF deploy CLI
|       '-- src/: index.ts (CLI flow), apply-cloudflare.ts (wrangler: KV create,
|                 seed, secrets, deploy, Pages), kv-schema.ts (KV seed shape),
|                 worker-template.ts, dns-guide.ts, r2-setup.ts (doc-only,
|                 optional R2 note), cli.ts, run-command.ts, parse-wrangler-*.ts
|                 # No D1/R2 resources are created — v1 is KV-only (ADR-011)
|
|-- e2e/                              # Playwright smoke (Node dev server, mock host)
|-- deploy/local/                     # local dev harness (dev-worker.mjs + ClickHouse DDL copy)
|-- scripts/
|   |-- boundary-check.mjs            # ADR-009 gate (forbidden paths + sibling refs)
|   |-- check-oss-routes.mjs          # HTTP route contract gate
|   |-- egress-check.mjs              # P7.5 gate: no sibling-origin egress / telemetry SDKs (INV-B-01/02/16)
|   '-- audit-gate.mjs                # P7.4 gate: pnpm audit high/critical w/ documented allowlist
|-- tooling/                          # shared eslint / tsconfig / vitest setup
|-- docs/                             # specs, scope matrix, REPO-SPEC-OSS, pilot guide
|-- ADR/                              # ADR-001..013 (see ADR/README.md index)
|-- ATTESTRACK-PRODUCTION-PLAN.md     # phased plan to public launch (P0-P8)
|-- CONSENT-EVIDENCE-TOKEN-STANDARD.md  # pointer to licensed normative standard
|-- ADAPTER-DEVELOPMENT-GUIDE.md
|-- CONTRIBUTING.md
|-- SECURITY.md
|-- CODE_OF_CONDUCT.md
|-- LICENSE                           # MIT
|-- package.json                      # workspace root ("attestrack")
|-- pnpm-workspace.yaml
'-- turbo.json
```

## Key Architecture Notes

- **OSS consent scope (ADR-010):** community consent is **in this repo** — `ConsentConfig` in the operator's KV, mandatory strategies (`jurisdiction`, `consent`, `evidence-unsigned` consent log), HMAC consent tokens, and the `consent-js` banner. Attorney-maintained regulation rows, witnessed evidence, and Proof are licensed Attestrue extensions.
- **Extension slot:** `worker-core/src/loader.ts` exports `StrategyLoader` + noop loader; licensed CDN loaders are injected at licensed deploy time. The repo builds and runs green with zero premium packages.
- **Consent pipeline (P2, PR #8):** site config `mode` is read per request — SHADOW never blocks destinations (would-be decision recorded), ENFORCEMENT applies the gate; `mechanism: 'opt-out'` rows allow destinations absent a declined token; GPC honored per row. Consent cookie is set by the **Worker** (`Set-Cookie`, `Domain` from site config — ADR-012).
- **Consent event records:** KV-only with operator-configurable TTL (default 90 days) — **no D1/R2 in v1** (ADR-011).
- **Warehouse contract:** `packages/schema/warehouse/clickhouse.sql` is the canonical `events` DDL; the ClickHouse strategy inserts `FORMAT JSONEachRow` (ADR-013).
- **Portal API boundary:** banner config, policy publish, and mode toggle mutations return `403` + `requires_attestrue` (ADR-010 §4); see `docs/REPO-SPEC-OSS.md` + `docs/oss-http-contract.json` (gated by `route-contract-check`).
- **Community strategies are bundled** into the Worker at build time; `attestrack:enabled_strategies` KV gates destination/analytics stages only (mandatory always runs).

## Placement Rule

Every package must satisfy all three tests:
1. Runs on customer infrastructure
2. Contains no secrets or proprietary logic
3. Provides genuine standalone value
