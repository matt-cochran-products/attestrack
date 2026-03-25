# Host (runtime) integration guide

## Separation from strategies

**Hosting** is not a strategy. It is the volatility of *where* code runs (Cloudflare Workers today; other edge runtimes or Node later).

- **`@attestrue/host-contracts`** defines `HostRuntime`: KV-like storage, geo hints, background scheduling, and named secrets — without Cloudflare types.
- **`@attestrue/host-cloudflare-worker`** adapts `KVNamespace`, `ExecutionContext`, and `cf-ipcountry` into `HostRuntime`.
- **`@attestrue/worker-core`** consumes only `HostRuntime` and builds `createAttestrackFetchHandler`.

## Composing a Worker entry

1. Create `HostRuntime` with `createCloudflareHostRuntime({ bindings: { kv }, executionCtx, secretValues })`.
2. Pass it to `createAttestrackFetchHandler` together with `bundledStrategies` (typically `defaultCommunityStrategies()`), `strategyLoader` (often `noopStrategyLoader`), and `consentSecretName` (wrangler secret name for HMAC).
3. Export `{ fetch: handler }` as the Worker default.

Third-party hosts implement the same `HostRuntime` surface in their own npm package; keep Cloudflare types out of `@attestrue/worker-core`.

## Consent vertical slice

- Browser: `@attestrue/consent-js` → `commitPrivacyConsent(workerOrigin, body)` posts to `/__attestrack__/consent/commit`.
- Worker: same path mints a signed opaque token via `@attestrue/sdk` (`createPrivacyConsentToken`).
- Mandatory stage: `createConsentCookieStrategy(secretEnvName)` reads `at_consent` and verifies with `verifyPrivacyConsentToken`.

## Default stack

`@attestrue/deploy` remains Cloudflare-specific (wrangler, KV, R2, D1). “Bring your own host” means supplying your own entry file plus a `HostRuntime` adapter package.
