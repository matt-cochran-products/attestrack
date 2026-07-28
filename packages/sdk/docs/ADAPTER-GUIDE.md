# Strategy adapter guide

## What you are extending

**Strategies** are worker-side units that implement `Strategy` from `@attestrack/sdk`: a stable `id`, a `stage` (`mandatory` | `destination` | `analytics`), optional `manifest` metadata, and an async `run` method that receives a `StrategyPipelineContext` (`host`, `request`, optional `tracking`, optional `consent`).

- **Mandatory** strategies run first, in list order (see `defaultCommunityStrategies` in `@attestrack/strategies`).
- **Destination** / **analytics** strategies run after; enable/disable semantics are configured via KV/portal later.

## Premium / marketplace replacement

If your adapter ships with `manifest.replaces` listing community strategy ids, `resolveStrategiesWithReplaces` (used inside `createAttestrackFetchHandler`) drops those bundled ids before the pipeline runs. Your extension is appended after the filtered list. KV keys and worker wiring stay the same; only the loaded strategy set changes.

## Contracts

- Types: `@attestrack/types` (tracking events, consent commit body, strategy manifests).
- Validation: `@attestrack/schema` (Zod).
- Do not introduce licensed **Proof / trust-chain** fields (witnessed `record_id`, proof blobs, anchor semantics) in OSS packages. Community consent uses **unsigned** operational records; CETS v1.1 is documented outside this repo (see root `CONSENT-EVIDENCE-TOKEN-STANDARD.md` pointer).

## Testing

Use `createMockHostRuntime` from `@attestrack/sdk` and drive `strategy.run` with a `Request` built in tests. Prefer asserting **observable behavior** (context mutations / HTTP) over internal helpers.
