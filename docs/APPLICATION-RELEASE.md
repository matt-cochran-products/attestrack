# Retained application bytes (issue103)

This component packages the customer-owned Cloudflare Worker and optional Pages
portal. It does **not** deploy, provision, authorize release, inspect live
provider state, qualify recovery, or establish staging acceptance. Issue103
remains open. npm publication and the interactive owner bootstrap CLI are
separate unchanged paths. Warehouse/bootstrap/schema/grants remain infra1096;
query identity, runtime dashboard configuration and OPV ownership remain
product68/88/67.

## Natural source chain

A protected staging push runs `application-artifacts.yml`. Its credential-free
scope job checks the original native run/attempt, repository, exact current
protected branch/source/tree and clean checkout. The builder independently
checks successful original source CI, its complete-tree identity and recorded
same-repository staging PR. Only source Evidence schema2 with recorded staging
PR provenance is used for new application artifacts; the existing source-CI
resolver still accepts its historical schemas1/2 under their original rules.

The builder uses frozen pnpm9.0.0 and the locked workspace, the existing
`buildWorkerEntry()` composition and esbuild's workerd/browser ESM output. The
portal builds without any inherited VITE environment variable. Its packaged HTML
receives the existing constant `same-origin` runtime meta; repository/dev HTML
stays unchanged. The same retained HTML/JS/CSS bytes can be consumed in either
environment. Worker binding IDs/secrets/SITE_ID and native Worker version UUIDs
are environment-specific configuration, **not** bundle equality.

One `application.json` contains a closed manifest plus base64 exact file bytes,
including hidden output files. It identifies source/workspace lock,
actual Node/pnpm/esbuild, Worker entry and compatibility date, original producer
run/attempt and full source-CI evidence. Every sorted path has size/SHA256; the
whole inventory has its own digest. Canonical ClickHouse SQL is retained for
identity only: no schema is applied. No secret/config files, KV seed,
warehouse credentials, private inventory or e2e resource placeholders belong in
this artifact. A 64MiB total decoded bound,10000file bound and96MiB ZIP/JSON bound
are parser limits, not business budgets or provider limits.

A protected main push selects a successful original staging producer for its
exact complete tree. Before ZIP parsing, it verifies unique native artifact ID,
original producer run/attempt/name, repository/head-branch/source and native outer
ZIP SHA256. Per-run jobs/artifacts require complete native listings bounded to1000entries
and refuse truncation, changing totals or duplicates. Workflow candidate discovery
reuses the existing recent1000-run search, filtering successful native status
locally; a larger historical total does not prevent a valid recent candidate. Required original successful jobs are
unique and bound to native run/attempt/head. The single bounded ZIP member and
all inner bytes are checked; main materializes those same bytes to a fresh
runner directory. A retained `artifact-materialization/v1` record identifies the
original artifact, not a new release/acceptance receipt. Main performs no install,
compilation, bootstrap or rebuild fallback. Missing/expired/invalid bytes fail.

## Evidence and remaining release work

Focused tests use fictional native metadata, actual ZIP/file roundtrips and an
actual child CLI with a fictional GitHub reader. Installer/compiler children are
traps on main. This proves source behavior, **not** real staging packaging: the
first natural staging producer still needs independent native artifact ZIP and
complete inventory verification. A green source job is not a retained bundle.

Before a later provider writer: inventory the actual intended Worker/Pages/KV/
optional private VPC targets, current native predecessors, existing protected
environments, OPV native reader/grant boundaries, environment bindings and
Access/direct-origin protection. No declared or local e2e target is activated by
this workflow. Same-origin portal configuration requires its real hostname's
portal API route to the existing Worker plus Access for static/API paths. Missing
those controls remains a blocker; the old deploy CLI can still use its documented
legacy compile-time URL for owner-operated bootstrap.

Native no-bundle Worker upload and Pages direct-upload support prebuilt bytes
([Workers](https://developers.cloudflare.com/workers/wrangler/bundling/),
[Pages](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)).
The future exact pinned uploader/readback still needs review and qualification;
this component does not call either API. A later real staging writer must retain
native serving version/deployment/config identities, demonstrate fictional
consent-isolated event→durable warehouse→authenticated Explore acceptance, and
qualify genuine same-state recovery that preserves forward writes before target
mutations. Production must require that staging acceptance for the same original
bytes. No artifact schema/label or JSON boolean provides that authority, and no
warehouse, outbound advertising or licensed extension authority is implied.

## Native retained-byte writer source (still not activated)

`scripts/native-application-release.ts` implements actual Cloudflare HTTP paths;
it has no CLI, inferred target, credential environment-variable reader or hosted
workflow entrypoint. `readOriginal` reuses the existing provenance engine to
authenticate the original staging run/attempt, complete scoped jobs/artifact
listings, native outer ZIP digest, source2/recorded PR and exact complete tree.
It checks all retained files before giving a process-local bundle capability to
the writer. Copies, mutated payloads and arbitrary caller JSON do not obtain that
capability. Its public artifact identity uses **raw lowercase64hex** archive and
inventory SHA256, alongside original artifact ID/run/attempt/source tree. Native
GitHub's `sha256:` prefix is removed only after native archive verification;
historical materialization receipts keep their existing format.

A reviewed target must name an **existing** account, immutable Worker ID and
script name, complete existing KV/SITE_ID/secret-name/optional private-VPC binding
set and pinned native configuration. Pages is optional and, if selected, names
an existing direct-upload static project and production branch. Different
environment targets remain different identities. Missing mappings remain
unconfigured. There is no Worker/project creation, KV creation/seed, runtime
secret delivery, ClickHouse schema/grant change, npm publication, installation or
compiler command in the writer. The existing owner bootstrap/deploy CLI is
unchanged and is not called.

The modern [Worker version API](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/)
accepts a Worker ID **or existing name**. This source uses the reviewed immutable
ID; GET must resolve that ID/name, and GET of the legacy script's active version
through that same ID must succeed with the expected bindings/configuration. An
old account/plan/topology that cannot satisfy those readbacks is unsupported and
fails closed. No migration, new registration, replacement identity or account
upgrade is attempted. Actual compatibility with the selected account remains a
native prerequisite, not something fictional tests establish.

Uploading `modules` with `deploy=false` creates a version without switching
traffic. Explicit secret-binding `inherit.version_id` points to the observed
active predecessor; values remain provider-side. The older script upload API
supports only floating `latest` inheritance, so it is deliberately not used.
GET `include=modules` independently checks the uploaded module's exact SHA256.
Existing compatibility flags/date, limits, placement and usage model are
preserved and checked; unsupported stateful/assets/exports topology is refused.
A separate [deployment POST](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/)
switches100% traffic. Successful readback requires the exact returned deployment
ID, uploaded version UUID and module bytes. An uploaded version is not an active
deployment. Mixed traffic and active/latest disagreement are refused.

Pages uploads exactly retained static bytes via the documented [asset API](https://developers.cloudflare.com/api/resources/pages/subresources/assets/methods/upload/)
and [Direct Upload deployment API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/).
The manifest uses Cloudflare's actual BLAKE3(base64(bytes)+extension) truncated
content key, not the artifact SHA256. The upload JWT is native short-lived
asset-only transport input and is not journaled. Pages Functions/control files
are refused before any target mutation. The canonical project deployment must
equal the returned successful production deployment, with the submitted source
metadata and unchanged project configuration. This is native association with
the submitted manifest/bytes, **not** an independently downloaded Pages bundle
hash or a claim that every serving edge has already converged. Worker version
UUIDs and Pages deployment IDs are environment-specific, not cross-target bundle
equality or schema compatibility.

`native-release-tool.yml` packages a **separate public tool artifact**, without
installing packages or running npm scripts. `native-release-tool.ts` checks the
already locked blake3-wasm2.1.5 tarball's SHA512, reads only six fixed regular
members, and verifies each exact JS/Wasm/license/package SHA256. All are verified
again before loading the unmodified upstream hash entry from a fresh trusted
directory, and checked for drift afterward. Package version alone is never
identity. The packaging artifact itself does not authorize provider access; the
factory must independently authenticate its original native run/artifact/ZIP
and fixed tool profile. Node/Python/controller source also remain part of the
trusted job/tool contract. Candidate application dependency code is not loaded
by this writer. Official primary sources inspected:

- [Cloudflare SDK0eb9ef0](https://github.com/cloudflare/cloudflare-typescript/blob/0eb9ef0ea40c1fe38e4b19be92f41bd7466bc1d6/src/resources/workers/beta/workers/versions.ts): JSON creation, explicit inherited version and module readback.
- [Cloudflare uploader3cea40b](https://github.com/cloudflare/workers-sdk/blob/3cea40b078519222db432b5edf827ddc3e629a2a/packages/deploy-helpers/src/deploy/helpers/hash.ts): exact Pages hash convention.
- [Official BLAKE3 vectors657284b](https://github.com/BLAKE3-team/BLAKE3/blob/657284b1fa4c4378aa7422b4450dcb5c2c9052fc/test_vectors/test_vectors.json): credential-free upstream runtime checks, including chunk boundary cases.

The caller must durably retain every journal append **before dispatch**. Each
mutation starts `unknown`; `confirmed` means its native API acknowledgement was
received, not hosted acceptance. A later failure retains confirmed Worker work
and unknown Pages work. No automatic rollback/retry occurs. Stale predecessor
readback refuses overwrite of a newer deployment or upload. Recovery is another
explicit original-artifact selection under qualified authority; the prior UUID
is never silently treated as a compatible recovery. These native APIs do not
provide an atomic cross-service compare-and-swap: external concurrent writers,
secret/settings changes and partial commits require actual exclusion and
reconciliation, not a claim that bookend GETs eliminate the race. Provider calls
have30second deadlines and a10minute client lifetime; timeout remains unknown.

### Mandatory immediate factory follow-on (issue103 stays open)

This packet is source groundwork, not the whole release-source implementation.
Before any callable hosted writer: implement the protected current-source and
preexisting-environment scope gate **before** credential allocation; separate
native OPV reader/grant contracts and roles; authenticate retained original tool
and application native artifacts; implement durable operation/phase identity,
writer exclusion, write-ahead persistence and read-only unknown reconciliation;
join actual native predecessor/recovery compatibility and staging acceptance
producers. Endorz's HTTP forward-write witness is evidence, never a grant.
Its exact prepared synthetic event/cohort IDs must be persisted before a POST;
an ambiguous call gets read-only inspection, never another write invocation.

The finalizer also needs native route/custom-domain/project association for the
reviewed HTTP origin before/after. A successful HTTP site read and a separate
Worker/Pages ID GET do not establish that association. Existing Access/bypass,
dedicated tenant and disabled outbound strategies, same-store forward writes and
an explicit reviewed recovery artifact remain required. Real target IDs,
custody/bootstrap and native compatibility proof are not invented here. No
source test, artifact schema, journal field or HTTP witness marks activation,
acceptance or recovery ready. Prepared controls remain unchanged.
