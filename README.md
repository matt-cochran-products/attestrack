# Attestrack

[![CI](https://github.com/matt-cochran/attestrue/actions/workflows/ci.yml/badge.svg)](https://github.com/matt-cochran/attestrue/actions/workflows/ci.yml)
[![E2E](https://github.com/matt-cochran/attestrue/actions/workflows/e2e.yml/badge.svg)](https://github.com/matt-cochran/attestrue/actions/workflows/e2e.yml)
[![Release Please](https://github.com/matt-cochran/attestrue/actions/workflows/release-please.yml/badge.svg)](https://github.com/matt-cochran/attestrue/actions/workflows/release-please.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**First-party, server-side analytics and measurement on your Cloudflare account — MIT licensed.**  
This repository is the open-source **Attestrack** implementation, including **community consent** you configure in your own KV. **[Attestrue](https://attestrue.com)** sells optional **licensed extensions** (attorney-maintained regulation configuration, enhanced consent runtime packs, independently witnessed records, counsel portals). Core analytics and event delivery run in **your** infrastructure; there are no Attestrack-hosted servers in that path.

---

## Why Attestrack

- **Your Cloudflare account, your credentials.** Workers, KV, D1, R2, and Pages run under your control. Warehouse and destination secrets stay in your environment.
- **First-party endpoint.** Events hit your subdomain; the Worker fans out server-side to Meta, Google, TikTok, Microsoft, and other strategies you enable.
- **Canonical event schema** for ClickHouse (and Tinybird) so analytics stay **queryable and yours**.

> **Product boundary (ADR-010):** Attestrack ships **analytics + server-side measurement + community consent** (`ConsentConfig` in your KV, mandatory Worker strategies, `@attestrack/consent-js`). **Attorney-maintained regulation rows, canonical witnessed evidence, and Proof** are **Attestrue extensions** (CDN artifacts on your Worker). See [`docs/COMMUNITY-CONSENT.md`](docs/COMMUNITY-CONSENT.md).

### Self-hosted analytics layer

The community **operator portal** ([`packages/portal-community`](packages/portal-community)) focuses on **signal recovery, destinations, request logs, analytics dashboards, and Explore** — backed only by **your** warehouse via a read-only query proxy ([`docs/BEHAVORIAL-SPEC.md`](docs/BEHAVORIAL-SPEC.md)). Use **Extensions** in the portal for the handoff to licensed Attestrue capabilities.

### Attestrack vs Attestrue extensions

| | **Attestrack (this repo)** | **Attestrue extensions (paid)** |
|---|---------------------------|----------------------------------|
| **Purpose** | Analytics, server-side events, ad/warehouse strategies, **community consent** (KV + strategies + `consent-js`) | Attorney-maintained regulation config, enhanced runtime packs, Proof, counsel workflows |
| **Upgrade** | N/A | License key + CDN artifacts on your Worker — same KV schema; `replaces: ['jurisdiction']` swaps jurisdiction sourcing — see [attestrue.com](https://attestrue.com) |

---

## Quick start (from source)

**Prerequisites:** [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/) 9+, and a [Cloudflare](https://www.cloudflare.com/) account when you deploy for real.

```bash
git clone https://github.com/attestrue/attestrue.git
cd attestrue
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm boundary-check
```

**Run locally**

- Marketing site (separate repo): clone [attestrue-site](https://github.com/attestrue/attestrue-site), then `npm install` and `npm run dev` (or `pnpm` equivalents).
- Community portal: `pnpm --filter @attestrack/portal-community dev`

---

## Documentation

| Location | Purpose |
|----------|---------|
| [`docs/PILOT-OSS.md`](docs/PILOT-OSS.md) | Self-hosted Cloudflare pilot: one-command deploy, Access, verification |
| [`docs/BEHAVORIAL-SPEC.md`](docs/BEHAVORIAL-SPEC.md) | Behavioural spec (CLI, portal, worker observability, analytics + Explore) |
| [`docs/OSS-SCOPE-MATRIX.md`](docs/OSS-SCOPE-MATRIX.md) | OSS vs licensed traceability (Tier 1) + ADR-010 precedence |
| [`docs/REPO-SPEC-OSS.md`](docs/REPO-SPEC-OSS.md) | Binding OSS Worker HTTP, KV, and JSON error contract |
| [`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md) | Test layers, contract tests, scaffolding exit criteria |
| [`docs/CONOPS-OSS-SNAPSHOT.md`](docs/CONOPS-OSS-SNAPSHOT.md) | Observable Worker pipeline (no proprietary ConOps) |
| [`docs/COMMUNITY-CONSENT.md`](docs/COMMUNITY-CONSENT.md) | Community consent vs Privacy Consent extension (`replaces`, KV contract) |
| [`docs/USER-JOURNEY.SPEC.md`](docs/USER-JOURNEY.SPEC.md) | User journey |
| [`packages/portal-community/docs/`](packages/portal-community/docs/) | Portal-scoped notes |
| [`ADR/`](ADR/) | Architecture decision records |
| [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](CONSENT-EVIDENCE-TOKEN-STANDARD.md) | Pointer to licensed normative standard (ADR-010) |

---

## Repository layout

```
attestrue/
├── docs/
├── packages/
│   ├── deploy/
│   ├── portal-community/   # Operator UI — analytics-first (extensions handoff)
│   ├── consent-js/         # First-party banner / GPC / token UX (stub → implementation)
│   ├── schema/             # Public Zod — tracking, strategy, consent KV + events
│   ├── sdk/
│   ├── strategies/         # Ad-network + analytics + mandatory (incl. community consent)
│   ├── types/              # Public types — tracking, strategy, consent contracts
│   └── worker-core/
├── scripts/
│   └── boundary-check.mjs  # ADR-009 — forbid packages/merkle only
├── tooling/
├── ADR/
├── pnpm-workspace.yaml
└── package.json
```

---

## Deploy to Cloudflare

From the repository root, use the guided `@attestrack/deploy` CLI (Worker, KV seed, secrets, optional Pages portal). See [docs/PILOT-OSS.md](docs/PILOT-OSS.md).

---

## Packages (quick reference)

| Package | Role |
|---------|------|
| [`attestrue-site`](https://github.com/attestrue/attestrue-site) (separate repo) | Attestrack marketing site (attestrack.dev) |
| `@attestrack/deploy` | Deployment tooling |
| `@attestrack/worker-core` | Worker fetch handler + strategy pipeline (uses `HostRuntime` only) |
| `@attestrack/host-contracts` | Portable host port types |
| `@attestrack/host-cloudflare-worker` | Default Cloudflare `HostRuntime` adapter |
| `@attestrack/consent-js` | Browser consent commit + cookie helpers |
| `@attestrack/strategies` | Bundled strategies (analytics + ads + community consent) |
| `@attestrack/portal-community` | Operator UI |
| `@attestrack/schema` / `@attestrack/types` | Shared public contracts |
| `@attestrack/sdk` | Strategy author SDK + consent token + `resolveStrategiesWithReplaces` |

---

## License

[MIT](LICENSE) © Matthew Cochran

Attestrack is open-source software, provided as-is. Measurement and privacy obligations depend on your deployment and counsel; this README is not legal advice.
