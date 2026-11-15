# Native operation journal coordinator: bounded source, no activation

This is executable journal-side control logic for one existing `NativeWriter`
operation. It does not implement the entire application release controller or
grant execution. Both target profiles remain null, and the existing application
release workflow remains admission-only. No provider or journal credentials are
added. `NativeOperationCoordinator` has no CLI and makes no provider calls.

`coordinatorIntent()` joins the already independently admitted scope plan's
original run/source, artifact, complete tree, target and tool to the journal
produced by `NativeWriter.prepareOperation()`. This helper does not authenticate
caller JSON. The trusted outer controller must retain the full admitted plan,
HTTP/config/profile identities, accepted staging selection and recovery authority.

The core takes an authenticated current-store reader/CAS adapter and the existing
read-only GitHub adapter. It persists original intent before discovering the
executor, requires the original successful `scope` job, selects the actual unique
operation job from the original run/attempt listing, and CAS-persists that job's
native ID. Job names are fixed as `native-worker-upload`, `native-worker-switch`,
`native-pages-assets`, and `native-pages-deploy`. These are the proposed future
workflow contract; no such hosted jobs are introduced here. An absent current job
waits without granting authority. A rerun/replacement executor refuses.
Before a state transition, both native observations must agree on run and selected
job identity and lifecycle state. Each read independently revalidates repository,
source, successful scope and complete listings. Harmless timestamps, URLs or
step-progress metadata do not make an unchanged executor fail this comparison.

An original successful job's unique ACK artifact is verified against the native
run, attempt-bound name, repository IDs, source, byte size and archive SHA-256,
then parsed with the existing closed ZIP reader and existing operation ACK
validator. The outer run may still be in progress: the verifier checks the real
job's success and never fabricates a successful whole-run object. ACK names also
include operation UUID, operation name, job ID and attempt. GitHub artifact
metadata binds a run, not a producing job; a future trusted fixed workflow must
reserve this name to that one provider job and forbid other jobs publishing it.

All writes compare the entire authenticated store head and environment slot.
Conflicts re-read; thrown persistence errors have unknown outcomes. Only an exact
transition found in a fresh authenticated read resolves a lost write ACK. A
terminal original job without a valid ACK becomes durable `unknown`, never a new
claim. A later authentic successful original ACK can confirm that same claim.
Missing/zero/ambiguous provider observations cannot authorize replay. The core
does not delete, expire, release or steal the environment slot, advance to another
operation, or select rollback. A never-finishing executor keeps its claim.

The tests are appended to `native-application-release.test.ts`, already selected
by required source CI. They exercise actual existing fictional native writer and
artifact-reader fixtures, native API paths, durable CAS decisions, concurrency,
lost ACKs before/after commit, unknown effects, source/attempt/job swaps and archive
tampering. They were authored only; no local app runner/test/build was executed.
Normal required remote CI and independent review remain mandatory.

## Remaining executable integration, not owner busywork

1. Reuse infra `fly/platform/release/ledger.py` / `GitStore.publish()` and
   `JournalCodec` at reviewed infra main `86597fd930ac3349d24cbd968d3eedc548dca7bf`
   through a narrow journal-role adapter. Preserve signed/encrypted ancestry,
   reviewed genesis, exact current Git CAS and a retained environment exclusion
   slot. The generic immutable `records` facility can retain these frames; it is
   not itself an environment lock. Existing `journal.py` is Fly request-specific
   and must not be falsely used as a Worker deployment state machine. There is no
   reviewed AttesTrack journal assembly/grant today. Do not give the provider,
   fixture or browser jobs the Git writer, age identity or signing key.
2. Add a native journal-job-to-provider projection of the committed claimed frame
   bound to current encrypted Git head/ciphertext digest and exact original
   journal job/run/attempt/source. Verify its native archive and successful job;
   reserve its artifact name to that job in the fixed workflow. Reopen current
   public Git head before consumption. A stale/changed head refuses; never
   silently adopt latest. Journal and provider waiting jobs must run in parallel
   after `scope`, avoiding a dependency cycle where claiming requires a job that
   cannot start until claim completes. The source consumer and fence integration
   now exist in `native-journal-projection-reader.ts`; its source-owned issuer
   configuration stays null until actual producer source/genesis/read authority
   are reviewed. See [native-journal-projection.md](native-journal-projection.md).
3. Wire the implemented mandatory job fence into the eventual fixed provider
   entrypoint before provider material is read. `execution()` now calls
   `reserveOriginalJob()` before issuing a capability, authenticating actual
   original environment/run/attempt/job and successful scope through native
   read-only metadata. A pinned Linux directory descriptor anchors an exclusively
   created directory and `O_EXCL | O_NOFOLLOW` marker beneath `RUNNER_TEMP`.
   The marker binds the full canonical frame SHA-256, environment, operation and
   complete native executor; file, directory and temporary-root directory are
   fsynced. An existing directory also refuses, including a crash before marker
   creation. There is no deletion, reset or replay path. The process-local
   Set/WeakMap remains supplemental. Fixed job names match the coordinator's
   `native-<operation>` contract; no current hosted job is added. The current-head
   public projection consumer from step 2 remains unconfigured. Do not pass
   age/signing/store-writer material into a provider to work around that gap.
4. Wire actual durable controller jobs, original artifact readers in the provider
   process, retained witness intent before POST, read-only inspect after uncertain
   witness writes, P/C/R/resume authority and independent native/HTTP/warehouse
   readback. Integrate all operations without releasing exclusion between them,
   reconcile mixed Worker/Pages outcomes, and finalize accepted staging before
   main may select those exact bytes. Coalesce the two producer wakeups at the
   release transaction layer; repeated calls for this exact intent already
   coalesce, but a different original run cannot replace its existing claim.
5. Add native workflow tests and actual adapter tests, then normal source CI and
   genuine hosted qualification under the existing reviewed custody/target
   bootstrap. Source progress is not target readiness, hosted activation or a
   complete release lane. Keep the full deliverable open until this is wired.

The whole controller also needs a separate authenticated **no-effect abort/retry**
path for setup failures before claim and consumption. A Node installation failure
before the provider entrypoint is not the same outcome as an ambiguous provider
POST. This bounded core deliberately does not release even its prepared slot.
The future abort must prove the original native job is terminal, authenticate its
fixed source/step ordering and pre-dispatch failure, and join that evidence to a
current durable record that was never claimed or consumed. Absence of an ACK,
marker or visible provider row alone is insufficient. CAS must prevent a claim
racing that decision; retain an authenticated aborted record before a separately
admitted retry can acquire exclusion. An existing claim/consumption or uncertain
effect remains held for reconciliation, with no timeout, deletion or blind retry.

## Job-local fence evidence and its limit

The fence defaults to the real native GitHub reader and `process.env` through
`execution()`. Its explicit dependencies support fictional native CI fixtures,
not caller-selected authority in a hosted workflow. It requires Linux, the exact
original protected-main workflow and job, and an owned temporary directory with
no group/other write permission or symlink ancestry. Native bookends compare
identity and active lifecycle; incidental timestamps and step progress may vary.
Failure after marker creation preserves the hold, even before provider dispatch.
The provider entrypoint has not been wired; key acquisition must be sequenced
after this gate there, not claimed as complete from this source helper alone.

Eight new authored tests cover the marker binding/modes, a fresh process trying
again, two concurrent fresh processes, torn/conflicting/symlink state, foreign
native job/environment, unsafe temporary directories, semantic metadata progress
versus identity/lifecycle changes, and mandatory capability gating. Existing
fictional native writer tests also traverse the real temporary-file fence. The
only cleanup is test-suite teardown of its own fictional directories. These new
tests await native source CI; local checks parse syntax without executing modules.

GitHub documents `RUNNER_TEMP` as job-scoped and cleaned at job boundaries; it
also documents that `GITHUB_RUN_ATTEMPT` advances on rerun. This supports a
same-job **process restart** fence combined with a durable external original
claim. It does not establish survival of arbitrary runner filesystem loss, nor
protect against malicious trusted workflow code removing the marker. Do not call
it provider exactly-once. A new/recreated runner/job without the reviewed
original lifecycle must refuse or require read-only reconciliation, never infer
permission from a missing marker.

- [GitHub variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
- [GitHub rerun semantics](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
