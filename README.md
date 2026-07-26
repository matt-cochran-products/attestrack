# Attestrack

[![CI](https://github.com/matt-cochran/attestrack/actions/workflows/ci.yml/badge.svg)](https://github.com/matt-cochran/attestrack/actions/workflows/ci.yml)
[![E2E](https://github.com/matt-cochran/attestrack/actions/workflows/e2e.yml/badge.svg)](https://github.com/matt-cochran/attestrack/actions/workflows/e2e.yml)
[![Release Please](https://github.com/matt-cochran/attestrack/actions/workflows/release-please.yml/badge.svg)](https://github.com/matt-cochran/attestrack/actions/workflows/release-please.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**First-party, server-side analytics and measurement on your Cloudflare account — MIT licensed.**  
This repository is the open-source **Attestrack** implementation, including **community consent** you configure in your own KV. **[Attestrue](https://attestrue.com)** sells optional **licensed extensions** (attorney-maintained regulation configuration, enhanced consent runtime packs, independently witnessed records, counsel portals). Core analytics and event delivery run in **your** infrastructure; there are no Attestrack-hosted servers in that path.

---

## Why Attestrack

- **Your Cloudflare account, your credentials.** The Worker, KV, and Pages resources run under your control ([ADR-011](ADR/ADR-011-kv-only-consent-event-storage.md): v1 is KV-only — no D1/R2 required). Warehouse and destination secrets stay in your environment.
- **First-party endpoint.** Events hit your subdomain; the Worker fans out server-side to Meta, Google, TikTok, Microsoft, and other strategies you enable.
- **Canonical event schema** for ClickHouse ([`packages/schema/warehouse/clickhouse.sql`](packages/schema/warehouse/clickhouse.sql), [ADR-013](ADR/ADR-013-warehouse-contract.md)) so analytics stay **queryable and yours**; Tinybird is supported via its Events API.

> **Product boundary (ADR-010):** Attestrack ships **analytics + server-side measurement + community consent** (`ConsentConfig` in your KV, mandatory Worker strategies, `@attestrack/consent-js`). **Attorney-maintained regulation rows, canonical witnessed evidence, and Proof** are **Attestrue extensions** (CDN artifacts on your Worker). See [`docs/COMMUNITY-CONSENT.md`](docs/COMMUNITY-CONSENT.md).

### Self-hosted analytics layer

The community **operator portal** ([`packages/portal-community`](packages/portal-community)) focuses on **signal recovery, destinations, request logs, analytics dashboards, and Explore** — backed only by **your** warehouse via a read-only query proxy ([`docs/BEHAVORIAL-SPEC.md`](docs/BEHAVORIAL-SPEC.md)). Use **Extensions** in the portal for the handoff to licensed Attestrue capabilities.

### Attestrack vs Attestrue extensions

| | **Attestrack (this repo)** | **Attestrue extensions (paid)** |
|---|---------------------------|----------------------------------|
| **Purpose** | Analytics, server-side events, ad/warehouse strategies, **community consent** (KV + strategies + `consent-js`) | Attorney-maintained regulation config, enhanced runtime packs, Proof, counsel workflows |
| **Upgrade** | N/A | License key + CDN artifacts on your Worker — same KV schema; `replaces: ['jurisdiction']` swaps jurisdiction sourcing — see [attestrue.com](https://attestrue.com) |

---

## Demo

<!-- DEMO-PLACEHOLDER: after recording per docs/DEMO-SCRIPT.md, embed the gif here:
     ![Attestrack demo — deploy, consent, event, Explore](docs/assets/demo.gif)
     followed by a link to the full screencast. -->

A 5-minute **deploy → consent → event → Explore** screencast is being recorded for launch
— storyboard and exact commands in [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md).

---

## Quick start (from source)

**Prerequisites:** [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/) 9+, and a [Cloudflare](https://www.cloudflare.com/) account when you deploy for real.

```bash
git clone https://github.com/matt-cochran/attestrack.git
cd attestrack
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm boundary-check
```

**Run locally**

- Community portal: `pnpm --filter @attestrack/portal-community dev`

**Then go end-to-end** — deploy to your Cloudflare account ([below](#deploy-to-cloudflare)),
put `<script src="https://<your-worker-domain>/consent.js" defer></script>` on a page,
`POST /t/event`, and query your warehouse in the portal's Explore. The full path with
expected outputs: [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) and
[`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md).

> Verification status: every command above is verified against this tree in CI
> (build/test/typecheck) or by parsing the deploy CLI; the live deploy → consent → event →
> Explore loop requires Cloudflare (and, for standalone `npx`, npm) credentials and is a
> maintainer-executed step pre-launch — tracked in
> [`docs/GO-PUBLIC-CHECKLIST.md`](docs/GO-PUBLIC-CHECKLIST.md).

---

## Documentation

| Location | Purpose |
|----------|---------|
| [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) | Production self-host guide: warehouse DDL, secrets, CORS/cookies, Access, troubleshooting |
| [`docs/API-REFERENCE.md`](docs/API-REFERENCE.md) | Worker HTTP routes, KV key registry, consent token format |
| [`docs/PILOT-OSS.md`](docs/PILOT-OSS.md) | Self-hosted Cloudflare pilot: one-command deploy, Access, verification, rollback |
| [`ADAPTER-DEVELOPMENT-GUIDE.md`](ADAPTER-DEVELOPMENT-GUIDE.md) | Write, test, and submit strategies (community strategy PRs — STR.5) |
| [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) | 5-minute demo storyboard (maintainer-recorded at launch) |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Versioning, per-package release-please, npm publish with provenance |
| [`docs/BEHAVORIAL-SPEC.md`](docs/BEHAVORIAL-SPEC.md) | Behavioural spec (CLI, portal, worker observability, analytics + Explore) |
| [`docs/OSS-SCOPE-MATRIX.md`](docs/OSS-SCOPE-MATRIX.md) | OSS vs licensed traceability (Tier 1) + ADR-010 precedence |
| [`docs/REPO-SPEC-OSS.md`](docs/REPO-SPEC-OSS.md) | Binding OSS Worker HTTP, KV, and JSON error contract |
| [`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md) | Test layers, contract tests, scaffolding exit criteria |
| [`docs/CONOPS-OSS-SNAPSHOT.md`](docs/CONOPS-OSS-SNAPSHOT.md) | Observable Worker pipeline (no proprietary ConOps) |
| [`docs/COMMUNITY-CONSENT.md`](docs/COMMUNITY-CONSENT.md) | Community consent vs Privacy Consent extension (`replaces`, KV contract) |
| [`docs/USER-JOURNEY.SPEC.md`](docs/USER-JOURNEY.SPEC.md) | User journey |
| [`packages/portal-community/docs/`](packages/portal-community/docs/) | Portal-scoped notes |
| [`ADR/`](ADR/) | Architecture decision records |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting (GitHub Security Advisories) |
| [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](CONSENT-EVIDENCE-TOKEN-STANDARD.md) | Pointer to licensed normative standard (ADR-010) |

---

## Repository layout

```
attestrack/
├── docs/
├── packages/
│   ├── consent-js/             # First-party consent banner / GPC / token UX (served at GET /consent.js)
│   ├── deploy/                 # Guided Cloudflare deploy CLI (Worker, KV seed, secrets, Pages)
│   ├── host-contracts/         # Portable host port types (KV, geo, secrets, waitUntil)
│   ├── host-cloudflare-worker/ # Default Cloudflare HostRuntime adapter
│   ├── portal-community/       # Operator UI — analytics-first (extensions handoff)
│   ├── schema/                 # Public Zod schemas + warehouse DDL (warehouse/clickhouse.sql)
│   ├── sdk/                    # Strategy author SDK, consent token, test harness
│   ├── strategies/             # Ad-network + analytics + mandatory (incl. community consent)
│   ├── types/                  # Public types — tracking, strategy, consent contracts
│   └── worker-core/            # Worker fetch handler, consent/CORS/portal/Explore routes
├── scripts/
│   ├── boundary-check.mjs      # ADR-009 — forbid packages/merkle + licensed-sibling references
│   └── check-oss-routes.mjs    # docs/oss-http-contract.json vs worker-core source
├── e2e/                        # Playwright smoke tests (Node dev server wrapping the Worker handler)
├── tooling/
├── ADR/
├── pnpm-workspace.yaml
└── package.json
```

---

## Deploy to Cloudflare

Guided CLI — Worker, KV namespace + seed, secrets, optional Pages portal, all in **your** Cloudflare account:

```bash
# Standalone (published packages) — from any empty directory:
npx @attestrack/deploy          # add --dry-run to rehearse without touching Cloudflare
npx @attestrack/deploy verify   # post-deploy checks: /health, DNS route, portal Access, consent commit

# Dev mode — from this repository (uses local file: deps):
pnpm --filter @attestrack/deploy exec attestrack-deploy
```

> Pre-launch: standalone mode requires the `@attestrack/*` packages on npm (first publish is a maintainer step — [docs/RELEASING.md](docs/RELEASING.md)); until then use dev mode.

See [docs/PILOT-OSS.md](docs/PILOT-OSS.md) for the full checklist (flags, re-run diffs, Cloudflare Access, rollback).

---

## Packages (quick reference)

| Package | Role |
|---------|------|
| `@attestrack/deploy` | Deployment tooling |
| `@attestrack/worker-core` | Worker fetch handler + strategy pipeline (uses `HostRuntime` only) |
| `@attestrack/host-contracts` | Portable host port types |
| `@attestrack/host-cloudflare-worker` | Default Cloudflare `HostRuntime` adapter |
| `@attestrack/consent-js` | Browser consent banner, commit + cookie helpers |
| `@attestrack/strategies` | Bundled strategies (analytics + ads + community consent) |
| `@attestrack/portal-community` | Operator UI |
| `@attestrack/schema` / `@attestrack/types` | Shared public contracts + warehouse DDL |
| `@attestrack/sdk` | Strategy author SDK + consent token + `resolveStrategiesWithReplaces` |

---

## License

[MIT](LICENSE) © Matthew Cochran

Attestrack is open-source software, provided as-is. Measurement and privacy obligations depend on your deployment and counsel; this README is not legal advice.
