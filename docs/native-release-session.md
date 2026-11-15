# Phase-aware native release source

The operation and witness consumers now share an immutable release session.
Frame/CoordinatorRecord/ACK/operation projection use v2, with explicit release
UUID and candidate/recovery/resume phase. There is no v1 fallback. The existing
null target and journal-issuer profiles remain null. Hosted custody and complete
workflow/controller assembly are still required; this is not an activated lane.

The existing central `scope` job publishes the closed native intake after
request and managed-environment checks, inside the existing queue. The app's
`NativeIntakeDiscovery` searches bounded active native runs for the exact deployment
artifact namespace; it refuses ambiguous matches and never selects the newest
run as authority. Its locator is only a hint. `NativeIntakeReader` authenticates that actual successful job/source/archive and
requires its outer run still active. The GET-only predecessor observation checks
that queue owner again after observing P and carries its exact controller and
deployment identities. A replacement central run cannot adopt that observation
or renew the original operation authority.

`native-release-session.ts` parses the closed infra descriptor and session
projection. It binds original app run, admitted candidate, independently selected
predecessor and recovery artifacts, target/tool/persistence hashes, required
operation prefix, and distinct operation/cohort/event UUIDs. Parsing JSON does
not establish historical or compatibility authority. In particular, hash
inequality is not recovery proof; the native selection producer must independently
establish P and R before the session can open.

`NativeSessionProjectionReader` authenticates actual original infra run/attempt,
successful fixed issuer job, pinned whole workflow/blob, and native original
archive with sole member `session.json`. Initial session publication comes from
`attestrack-native-session`; later witness claims come from
`attestrack-native-witness-<phase>`. Its descriptor read permits later journal
commits for GET-only preparation. Its witness read additionally requires the
previously selected immutable descriptor, exact current public journal
head/ciphertext/signature, original witness executor and prior witness chain.

`witnessExecution` performs the actual original `native-<phase>-witness` job
checks and fsynced create-only RUNNER_TEMP marker, then repeats the fresh claim
read. `executeWitness` consumes that capability before invoking its lazy fixture
loader and the existing `application-witness.observe`. The witness subject stays
the candidate artifact for the whole P/C/R/resume chain; independent native
readback binds the artifact actually running in each phase. Errors retain the
claim and marker. There is no automatic witness replay.

The executable cores in `native-session-jobs.ts` reuse the existing NativeWriter:

- `observePredecessor` reads actual P before any witness, bound to original source
  admission. It needs no generated release ID or session descriptor.
- `preparePhase` observes the actual current predecessor and prepares a journal
  from the exact admitted C, R or resumed C bundle. The controller independently
  compares that observation with the preceding phase's retained readback.
- `readbackPhase` independently observes native state after each witness. A body
  naming an artifact is not acceptance: the journal role compares actual module,
  configuration, resource and snapshot identities to independently selected
  authority and the phase's exact acknowledged native state.
- `executePhaseOperation` reconstructs the exact journal using the existing
  admitted Bundle before fencing, then obtains provider material lazily only
  after projection verification, original-job consumption and the head bookend.
  Fence, credential acquisition and provider execution remain in one process.
  A setup failure can prove no effect only when that entire execution step was
  skipped; a started step is held for reconciliation.

The observation adapter refuses non-GET methods, bodies and asset-token overrides.
It preserves the existing native pagination reader. No journal writer, age key,
signer or fixture enters the provider core. The original provider process fence
and witness fence use disjoint native job names and marker purposes.

## Required hosted custody remains unconfigured

No reviewed AttesTrack declaration supplying these roles has been established.
Do not invent OPV product/environment/key names or use ambient credentials.
The smallest actual reviewed declaration must provide:

- A read-only GitHub capability for the private infra issuer's original source,
  run/jobs and archives, plus the selected existing public journal. It must not
  permit Git writes or arbitrary repositories. The app token alone does not
  supply private cross-repository access.
- A provider-only capability restricted to the selected existing Worker/Pages
  resources and the operations already implemented by NativeWriter. Read-only
  preparation/readback uses the GET-enforcing adapter. Provider material is
  acquired after the operation fence, not passed into fixture jobs.
- Fixture-only material for the selected existing HTTP target: its portal
  fixture and, only where its existing edge requires it, its Access pair.
  Acquisition follows the durable witness claim/fence. No provider or journal
  writer belongs in this role.
- The existing infra protected journal role for the selected environment's
  signed/encrypted store. It retains signer, age and exact Git CAS authority;
  none is copied into the app.

The central run must hold its existing `platform-release-staging` or
`platform-release-prod` queue throughout P/C/R/resume, all original provider ACKs,
witnesses, readbacks and final acceptance. Explicit sequential job dependencies
must implement the phase graph; matrix creation order is not completion order.
The genuine normal selection producer, fixed hosted CLI/custody adapters, complete
waiting-job workflow wiring and native end-to-end qualification remain open.
No smaller admission or descriptor test is a substitute for those requirements.

The active-run discovery query uses GitHub's documented event/branch/head_sha/
status filters and complete bounded inventories. See the [native workflow-runs
API](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#list-workflow-runs-for-a-repository).
This adds no polling daemon or dispatch identity; the eventual waiting job calls
the read-only discovery and verifier inside its bounded lifecycle.
