# Adapter development guide (Attestrack)

This guide is the entry point for authors of **worker-side strategies** and host integrations. Deep-dive detail lives next to the SDK.

## Read first

- [`packages/sdk/docs/ADAPTER-GUIDE.md`](packages/sdk/docs/ADAPTER-GUIDE.md) — `Strategy` contract, stages, `replaces` / extension loading.
- [`packages/sdk/docs/TESTING.md`](packages/sdk/docs/TESTING.md) — Vitest patterns and `createMockHostRuntime`.
- [`docs/COMMUNITY-CONSENT.md`](docs/COMMUNITY-CONSENT.md) — community `ConsentConfig`, mandatory strategies, upgrade path to licensed extensions.
- [`ADR/ADR-010-attestrack-core-extension-cache.md`](ADR/ADR-010-attestrack-core-extension-cache.md) — product boundary: analytics + community consent in OSS; Proof / attorney-maintained packs as extensions.

## OSS scope

- Published contracts: **`@attestrue/types`**, **`@attestrue/schema`**, **`@attestrue/sdk`**. Community consent types and KV/event shapes are part of the public graph for Attestrack.
- Do **not** add Merkle trees, signing DLQ, or Proof-specific fields to the **public** packages. The open-source **consent log** is an **unsigned** operational record (`ConsentEventRecordV1`). Normative wording for licensed evidence tokens stays outside this repo; see [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](CONSENT-EVIDENCE-TOKEN-STANDARD.md) (pointer only).

## Packages

| Package | Role |
|--------|------|
| `@attestrue/sdk` | `Strategy`, `StrategyLoader`, consent token helpers, test doubles |
| `@attestrue/strategies` | Bundled community strategies (mandatory + opt-in destinations/analytics) |
| `@attestrue/worker-core` | `createAttestrackFetchHandler`, pipeline orchestration |
| `@attestrue/host-contracts` | `HostRuntime` port |
| `@attestrue/host-cloudflare-worker` | Cloudflare `HostRuntime` adapter |

## Premium / marketplace strategies

Ship a strategy bundle with `manifest.replaces` listing community ids (e.g. `jurisdiction`) so the CDN loader can swap implementations without changing KV keys or customer Worker wiring. Resolution is handled by `resolveStrategiesWithReplaces` in `@attestrue/sdk`.
