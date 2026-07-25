# Adapter development guide (Attestrack)

This guide is the entry point for authors of **worker-side strategies** and host integrations. Deep-dive detail lives next to the SDK.

## Read first

- [`packages/sdk/docs/ADAPTER-GUIDE.md`](packages/sdk/docs/ADAPTER-GUIDE.md) — `Strategy` contract, stages, `replaces` / extension loading.
- [`packages/sdk/docs/TESTING.md`](packages/sdk/docs/TESTING.md) — Vitest patterns and `createMockHostRuntime`.
- [`docs/COMMUNITY-CONSENT.md`](docs/COMMUNITY-CONSENT.md) — community `ConsentConfig`, mandatory strategies, upgrade path to licensed extensions.
- [`ADR/ADR-010-attestrack-core-extension-cache.md`](ADR/ADR-010-attestrack-core-extension-cache.md) — product boundary: analytics + community consent in OSS; Proof / attorney-maintained packs as extensions.

## OSS scope

- Published contracts: **`@attestrack/types`**, **`@attestrack/schema`**, **`@attestrack/sdk`**. Community consent types and KV/event shapes are part of the public graph for Attestrack.
- Do **not** add **trust-chain / Proof** constructs (per-event witness trees, signing DLQ, proof-blob fields) to the **public** packages. The open-source **consent log** is an **unsigned** operational record (`ConsentEventRecordV1`). Normative wording for licensed evidence stays outside this repo; see [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](CONSENT-EVIDENCE-TOKEN-STANDARD.md) (pointer to CETS v1.1 / Trust Chain Spec).

## Packages

| Package | Role |
|--------|------|
| `@attestrack/sdk` | `Strategy`, `StrategyLoader`, consent token helpers, test doubles |
| `@attestrack/strategies` | Bundled community strategies (mandatory + opt-in destinations/analytics) |
| `@attestrack/worker-core` | `createAttestrackFetchHandler`, pipeline orchestration |
| `@attestrack/host-contracts` | `HostRuntime` port |
| `@attestrack/host-cloudflare-worker` | Cloudflare `HostRuntime` adapter |

## Premium / marketplace strategies

Ship a strategy bundle with `manifest.replaces` listing community ids (e.g. `jurisdiction`) so the CDN loader can swap implementations without changing KV keys or customer Worker wiring. Resolution is handled by `resolveStrategiesWithReplaces` in `@attestrack/sdk`.
