# Adapter development guide (Attestrack)

How to write, test, and submit **worker-side strategies** (destinations, analytics sinks,
mandatory pipeline steps) and **host adapters** for Attestrack. Everything here is grounded
in the real types in [`packages/sdk/src/interfaces.ts`](packages/sdk/src/interfaces.ts) and
[`packages/types/src/strategy.ts`](packages/types/src/strategy.ts).

## The Strategy contract

A strategy is a plain object implementing `Strategy` from `@attestrack/sdk`:

```ts
export interface Strategy {
  readonly id: string                    // stable, unique (e.g. 'meta-capi')
  readonly stage: StrategyStage          // 'mandatory' | 'destination' | 'analytics'
  readonly manifest?: StrategyManifest   // metadata: displayName, defaultEnabled, replaces
  run(ctx: StrategyPipelineContext): Promise<StrategyResult>
}
```

`StrategyResult` is `{ continuePipeline: boolean, tracking?, consent? }` — return
`{ continuePipeline: true }` unless you intend to halt the pipeline or replace the
tracking/consent context for later stages.

### Pipeline stages and ordering

`createAttestrackFetchHandler` (`@attestrack/worker-core`) runs strategies per request:

1. **`mandatory`** — always run, in list order. The bundled community set
   (`defaultCommunityStrategies` in `@attestrack/strategies`) is
   `jurisdiction` → `consent` → `evidence-unsigned` (consent log) → `troll-shield`,
   and it populates the context every later stage relies on.
2. **`destination`** — ad-network fan-out (bundled: `meta-capi`, `google-mp`,
   `tiktok-events`, `microsoft-uet`), run in **parallel** with per-strategy error
   isolation. Each destination checks `destinationsAllowed(ctx)` before firing (consent
   gate + bot flag — see below).
3. **`analytics`** — warehouse/telemetry sinks (bundled: `clickhouse`, `tinybird`,
   `otel`, plus `drift-detection`). These still run for bot traffic — rows stay labeled
   (`userAgentClass: 'bot'`) instead of being silently dropped.

Destination and analytics stages are gated by the KV list
`attestrack:enabled_strategies` (mandatory strategies always run). On `/t/event` the
pipeline runs in the background (`host.scheduleBackground`) after the request is accepted.

### The pipeline context

`StrategyPipelineContext` fields your `run` receives (set by earlier stages):

| Field | Set by | Meaning |
|---|---|---|
| `host` | worker-core | `HostRuntime` ports (below) — KV, secrets, geo, background |
| `request` | worker-core | The incoming `Request` |
| `tracking` | worker-core (on `/t/event`) | Validated `TrackingEventV1` |
| `consent` | consent strategy | Verified consent token (or `null`) |
| `jurisdictionKey`, `jurisdictionRow` | jurisdiction strategy | Resolved from `ConsentConfig` + geo |
| `site` | worker-core | Site-config snapshot resolved once per request (mode, TTLs) |
| `consentGate` | consent strategy | **The gate destinations must consult** (below) |
| `botDetection` | troll-shield | `{ isBot, reasons }` |

### Consent gating — what your adapter must respect

The mandatory consent strategy computes `ctx.consentGate` (`ConsentGateResult`) from the
site mode, jurisdiction row mechanism (`opt-in`/`opt-out`), token decision, and GPC. In
SHADOW mode the gate never blocks — destinations run and the would-be ENFORCEMENT
decision is recorded on the tracking row (`consentWouldAllow`); in ENFORCEMENT mode
`allowDestinations` is real. Your responsibilities:

- **Destination adapters MUST start `run` with the gate check** — the pipeline does not
  skip you; every bundled destination does this:

  ```ts
  import { destinationsAllowed } from '@attestrack/sdk'
  if (!ctx.tracking) return { continuePipeline: true }
  if (!destinationsAllowed(ctx)) return { continuePipeline: true }
  ```

  `destinationsAllowed` returns `false` for bot-flagged requests and consults
  `ctx.consentGate.allowDestinations` (falling back to an explicit `granted` token when
  no gate ran). Never inspect raw cookies yourself, and never fire outbound destination
  HTTP from `mandatory` or `analytics` stages to dodge the gate — PRs that do are
  rejected.
- **Analytics adapters:** you receive bot and SHADOW traffic by design; forward the
  honesty fields (`consentDecision`, `consentMode`, `consentMechanism`,
  `consentWouldAllow`, `userAgentClass`) so downstream analytics stay truthful.
- Never write licensed **Proof / trust-chain** constructs (witnessed `record_id`, proof
  blobs, anchors) into OSS packages — the OSS consent log is the **unsigned**
  `ConsentEventRecordV1` (see [`CONSENT-EVIDENCE-TOKEN-STANDARD.md`](CONSENT-EVIDENCE-TOKEN-STANDARD.md), a pointer only).

### Host ports (`HostRuntime`)

Strategies never import Cloudflare types — they use the portable ports in
`@attestrack/host-contracts`:

| Port | Signature | Notes |
|---|---|---|
| `kv` | `get/put/delete` (+ `expirationTtl`) | The operator's KV namespace |
| `geoCountry(request)` | `string \| null` | ISO 3166-1 alpha-2 (CF-IPCountry on Cloudflare) |
| `scheduleBackground(task)` | fire-and-forget | `waitUntil` on Cloudflare |
| `getSecret(name)` | `string \| undefined` | Named secrets — **never log values** |
| `botScore?(request)` | `number \| null` | Optional host bot score (1–29 automated, 30+ human) |

`@attestrack/host-cloudflare-worker` is the default adapter. To run Attestrack on another
runtime, implement `HostRuntime` in your own package and wire it per
[`packages/sdk/docs/HOST-GUIDE.md`](packages/sdk/docs/HOST-GUIDE.md).

### Delivery recording (STR.4)

Destination/sink adapters should record each attempt with `recordDeliveryResult` from
`@attestrack/sdk` (best-effort, never throws) so the portal `/destinations` view and error
surface show real outcomes:

```ts
import { recordDeliveryResult } from '@attestrack/sdk'
await recordDeliveryResult(ctx.host.kv, 'my-destination', ok
  ? { ok: true }
  : { ok: false, detail: `HTTP ${res.status}` })
```

## Worked example

Two compiling examples live in [`packages/sdk/examples/`](packages/sdk/examples/):

- [`minimal-adapter/index.ts`](packages/sdk/examples/minimal-adapter/index.ts) — a
  `destination` no-op pass-through with a manifest; replace `run` with your outbound HTTP.
- [`analytics-adapter/index.ts`](packages/sdk/examples/analytics-adapter/index.ts) — an
  `analytics` sink skeleton (`defaultEnabled: false`).

They are typechecked in CI as part of `pnpm --filter @attestrack/sdk typecheck`
(`packages/sdk/tsconfig.examples.json`), so they cannot silently rot.

To run one in a real Worker, append it to the bundled list in your scaffold's `worker.ts`:

```ts
bundledStrategies: [...allBundledStrategies('CONSENT_TOKEN_SECRET'), minimalDestinationStrategy]
```

and (for `destination`/`analytics` stages) add its `id` to the KV
`attestrack:enabled_strategies` array.

## Testing

Use Vitest + `createMockHostRuntime` from `@attestrack/sdk`:

```ts
import { createMockHostRuntime, flushMockBackgroundTasks } from '@attestrack/sdk'

const host = createMockHostRuntime({ secrets: { MY_TOKEN: 'test' }, geoCountry: 'DE' })
const result = await myStrategy.run({ host, request: new Request('https://t.example.com/t/event') })
await flushMockBackgroundTasks(host) // runs anything you scheduled
```

Prefer asserting observable behavior (context mutations, outbound HTTP via a mocked
`fetch`, KV writes) over internals. Patterns:
[`packages/sdk/docs/TESTING.md`](packages/sdk/docs/TESTING.md) and the bundled strategies'
suites in [`packages/strategies/__tests__/`](packages/strategies/__tests__/).

## Submitting a community strategy (STR.5)

Community strategies are contributed as **pull requests to this repository** — there is no
in-portal submission flow (the portal's Strategies view links here).

1. **Fork and branch**; add your strategy under
   `packages/strategies/src/<ad-networks|analytics>/<name>.ts` with a manifest
   (`defaultEnabled: false` — operators opt in) and export it from
   `packages/strategies/src/index.ts` (append to `allBundledStrategies`).
2. **Secrets via `host.getSecret` only** — document required secret names in the PR;
   never bake in endpoints/tokens per customer. Egress must go only to the destination's
   documented API (`pnpm egress-check` enforces the no-telemetry/no-vendor rule).
3. **Consent-gate compliance** as described above; destinations must record outcomes with
   `recordDeliveryResult`.
4. **Tests required**: unit tests with `createMockHostRuntime` covering success, HTTP
   error (recorded via delivery stats), and missing-secret no-op.
5. **Gates green**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus
   `pnpm boundary-check` and `pnpm egress-check`.
6. Open the PR with the **community strategy template**: append
   `?template=community_strategy.md` to the compare URL, or copy
   [`.github/PULL_REQUEST_TEMPLATE/community_strategy.md`](.github/PULL_REQUEST_TEMPLATE/community_strategy.md).

General contribution rules: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Premium / marketplace replacement (`replaces`)

Licensed extension bundles may declare `manifest.replaces` listing community ids (e.g.
`replaces: ['jurisdiction']`). `resolveStrategiesWithReplaces` (`@attestrack/sdk`, used
inside `createAttestrackFetchHandler`) drops those bundled ids before the pipeline runs
and appends the extension — KV keys and Worker wiring stay identical. The OSS repo ships
only the `StrategyLoader` slot (`noopStrategyLoader`); licensed CDN loaders are injected
at licensed deploy time ([ADR-010](ADR/ADR-010-attestrack-core-extension-cache.md)).

## Reference map

| Topic | Where |
|---|---|
| `Strategy`, context, loader types | [`packages/sdk/src/interfaces.ts`](packages/sdk/src/interfaces.ts) |
| Manifest / stages | [`packages/types/src/strategy.ts`](packages/types/src/strategy.ts) |
| Consent gate semantics | [`packages/sdk/src/consent-gate.ts`](packages/sdk/src/consent-gate.ts), [docs/REPO-SPEC-OSS.md](docs/REPO-SPEC-OSS.md) |
| Host ports | [`packages/host-contracts/src/index.ts`](packages/host-contracts/src/index.ts), [`packages/sdk/docs/HOST-GUIDE.md`](packages/sdk/docs/HOST-GUIDE.md) |
| Bundled strategies to crib from | [`packages/strategies/src/`](packages/strategies/src/) |
| HTTP / KV contracts | [docs/API-REFERENCE.md](docs/API-REFERENCE.md), [docs/REPO-SPEC-OSS.md](docs/REPO-SPEC-OSS.md) |
| Community consent scope | [docs/COMMUNITY-CONSENT.md](docs/COMMUNITY-CONSENT.md), [ADR-010](ADR/ADR-010-attestrack-core-extension-cache.md) |
