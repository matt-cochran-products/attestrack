# Controlled hosted HTTP witness

`scripts/application-witness.ts` collects actual HTTP and warehouse observations;
its `attestrack.http-witness/v1` record is **not** a deployment, fixture grant,
compatibility qualification, native identity, or recovery authorization. The
source tests inject HTTP responses and prove the harness contract only. Existing
source CI selects these tests explicitly. No hosted job or live CLI is wired.

The fixed tracked `release/application-targets.json` currently has `staging:null`.
`configuredTarget()` reads only that source-relative profile; it cannot select a
fixture-supplied filename. A future protected caller must use that reviewed
profile and independently authenticate the original retained artifact before
calling `observe`. There is no fallback host. Configuring a profile does not prove
provider ownership or authorize outbound work.

The reviewed staging target shape is exactly `{origin,site_id,policy_hash}`:
canonical HTTPS origin (no credentials/path/query/port), a dedicated synthetic
site identifier, and the owner-reviewed policy SHA256. Fixture input is only
`{portal_secret,access?:{client_id,client_secret}}`: the native Portal secret and,
when required, an Access service credential. Neither Cloudflare API credentials
nor warehouse write/read credentials belong in this harness. Responses, auth
headers and the minted consent token remain private RAM data. Errors expose only
fixed categories; there are no request/response logs, secret hashes, or raw errors.

Before mutations, the harness observes anonymous Portal denial (401), successful
same-secret native `GET /__attestrack__/portal/v1/site-config` with the exact
site, configured consent and SHADOW/ENFORCEMENT mode, matching
`GET /__attestrack__/consent/context`, and a successful site-and-event-scoped
`POST /__attestrack__/portal/v1/explore/query`. Access credentials, if present,
are included in the anonymous-Portal probe; that probe excludes the Portal secret.
Other statuses (including redirects/proxy/auth failures) refuse the run.

Each phase (`predecessor`, `candidate`, `recovery`, `resume`) verifies all earlier
synthetic rows **before** writing. It performs one native consent commit with a
granted decision, then one `/t/event` POST using the actual minted `at_consent`
cookie, one factory-selected event UUID and the same cohort UUID. Before invoking
`observe` exactly once, the privileged factory must durably persist the complete
`PreparedPhase` (original artifact/target/phase/previous witness plus
`mutation:{cohort,event_id}`) and checkpoint that this write attempt is starting.
The harness never generates replacement mutation IDs. These identifiers are not
authority or success flags. A failed/ambiguous POST is never replayed. Five bounded queries then require exactly one row per expected
UUID with exact site, `release_witness` name and server-stamped `granted` decision;
truncation, duplicates, missing old rows, or unexpected rows fail. The fixed SQL
selects only those synthetic records, at most four; it never resets schemas,
cleans databases, seeds KV, reads unrelated records, or retries mutations.
Requests have a ten-second deadline and a 64KiB response cap. This proves observed
forward-row retention, not instantaneous async delivery or database migration
compatibility by itself. A failed phase may have written its one event; retain
that prepared context even when no witness returns. Call `inspect` with that same
persisted context: it performs only native reads/scoped SELECTs and checks the
same old/new IDs, never consent commit or tracking POST. A successful inspector
record explicitly says `observation:read-only`; a normal response plus readback
says `observation:write-and-read`. Neither asserts idempotence. If the event is
already visible, `observe` refuses before mutation; if it is not visible, async
delivery may still complete, so absence never permits replay. Durable attempted-
phase ownership and native transition verification remain the factory's job;
there is no live factory wired by this component. Do not relabel a reconciled
read as an observed successful POST or completed release qualification.

The closed record contains original candidate artifact ID, producer run/attempt,
archive and inventory SHA256, source tree, target identity SHA256, cohort UUID
ordered phase/event UUIDs and the explicit observation kind. Artifact fields are evidence references, not
self-authenticating authority. The independent native writer/finalizer must
verify original source/artifact provenance, each actual Worker version and Pages
deployment plus exact config before/after, phase ordering and reviewed prior /
compatible recovery identities. Changing runtime is deliberately outside this
harness. A chain-shaped JSON document alone cannot prove any deployment occurred.

Live prerequisites remain unresolved: reviewed existing target mapping; dedicated
owner-provisioned fixture site; valid scoped Portal/Access fixture; native
KV/secret/config inventory and standing outbound authority; actual warehouse
readback availability; original artifact and native phase identities; owner prior
and compatible recovery with real schema qualification. In particular,
`portal/v1/strategies` reads the UI configuration and **does not prove** the
runtime `strategies:enabled` allowlist. Missing/invalid runtime allowlist permits
all optional strategies. No fixture boolean, UI setting or configuration hash can
replace the independent native check; do not wire live event writes until the
real dedicated-site/outbound prerequisites are qualified. No working application
default is changed by this source component.

## Native source compatibility inspected

At protected base `d8ce3588a5fcdc03411a95f3362117a822490c1e`, these are actual
handler implementations, not inferred mock contracts:

- `packages/worker-core/src/portal.ts:151`: prefix routing and whole-Portal
  shared-secret gate; lines 168–170 return the site config directly. The gate's
  `portalUnauthorizedResponse` returns native 401 / `portal_unauthorized`.
- `packages/worker-core/src/portal.ts:264`: POST JSON parsing; lines 272–294
  accept `{sql}`, apply the real Explore SQL gate, execute the query, and return
  `{columns,rows,rowCount,truncated}`. `explore-warehouse.ts:91` derives those
  columns from ClickHouse metadata and rows from data, with native truncation.
- `packages/worker-core/src/create-fetch-handler.ts:141`: actual POST consent
  commit validates `consentCommitRequestSchema`, signs the native token and
  returns `{token}` plus `buildConsentCookie` (line 93). The matching
  `packages/strategies/src/mandatory/consent.ts:73` reads `at_consent`, verifies
  the signature and exact configured site; caller-stamped decisions are not proof.
- `create-fetch-handler.ts:199` returns consent context with actual `siteId`;
  line 269 routes POST `/t/event` via `constants.ts`, validates tracking schema,
  refuses mismatched sites, schedules the real background pipeline and returns
  `{ok:true,accepted:true}`. That asynchronous response is why the witness must
  read durable rows and retain the attempted ID even after transport failure.

The injected-fetch tests exercise ambiguity and failure cases. In addition,
`packages/worker-core/__tests__/contract/application-witness.contract.test.ts`
executes the real `createAttestrackFetchHandler`, Portal gate, consent token
mint/verification strategy and Explore gate/executor. Its only persistence is a
fictional row-recording strategy and a synthetic ClickHouse HTTP response via the
host outbound test port; it proves native wire compatibility, not real
ClickHouse durability, workerd hosting, deployed credentials or provider access.
It is selected by the existing worker-core contract test suite. Native hosted
qualification and the privileged factory's durable attempt journal remain pending.
