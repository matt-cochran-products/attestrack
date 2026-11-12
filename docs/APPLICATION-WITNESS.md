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
cookie, one fresh event UUID and the same cohort UUID. A failed/ambiguous POST is
never replayed. Five bounded queries then require exactly one row per expected
UUID with exact site, `release_witness` name and server-stamped `granted` decision;
truncation, duplicates, missing old rows, or unexpected rows fail. The fixed SQL
selects only those synthetic records, at most four; it never resets schemas,
cleans databases, seeds KV, reads unrelated records, or retries mutations.
Requests have a ten-second deadline and a 64KiB response cap. This proves observed
forward-row retention, not instantaneous async delivery or database migration
compatibility by itself. A failed phase may have written its one event; retain
that evidence and do not relabel/replay it as successful qualification.

The closed record contains original candidate artifact ID, producer run/attempt,
archive and inventory SHA256, source tree, target identity SHA256, cohort UUID
and ordered phase/event UUIDs. Artifact fields are evidence references, not
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
