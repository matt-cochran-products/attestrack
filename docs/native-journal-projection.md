# Native journal projection consumption

`NativeJournalProjectionReader` implements the existing authenticated current-frame
reader. It consumes the infra journal adapter's closed
`attestrack.native-operation-projection/v1` body. The application never receives a
journal age identity, signing key or Git writer. It performs provenance reads and
hashes already-public encrypted bytes; it neither decrypts nor writes the store.

`projectedExecution()` loads the fixed source-owned
`release/application-journal-issuers.json`, verifies the projection, enters the
mandatory original provider-job fence, and verifies the current projection again
before returning an opaque Execution capability. A head change during fencing
withholds the capability and retains the consumed marker. Missing configuration,
metadata, archive or current bytes refuses. There is no plaintext/latest fallback.

Both configuration rows are null. No existing target, grant, workflow job,
producer run, genesis or release acceptance is asserted by this source packet.

## Existing identities and shared contract

| Environment | Public existing journal repository | Native repository ID | Branch |
| --- | --- | --- | --- |
| staging | matt-cochran-products/platform-manifests-staging | 1445127324 | release-ledger |
| production | matt-cochran-products/platform-manifests | 1444967543 | release-ledger |

These values match protected infra authority and `journal_crypto.py` at
`86597fd930ac3349d24cbd968d3eedc548dca7bf`. A configured row contains `store`
(repository, repository_id, branch, non-null reviewed genesis_head) and `issuer`.
The issuer uses the same closed `attestrack.native-journal-issuer/v1` contract as
the infra producer: repository `matt-cochran-products/infra`, ID `1326961741`,
workflow `.github/workflows/platform-product-release.yml`, exact source_commit,
native workflow_blob, workflow_sha256 and fixed job_name
`attestrack-native-journal`. That job is a future reviewed extension, not a job
in the current Fly-only workflow. No live issuer pins are filled here.

The original locator separately binds native infra run, attempt, job and artifact
IDs plus source commit. It cannot choose another source, repository or workflow.
The archive must contain only `projection.json`, whose body is:

```text
schema, repository, environment,
store { repository, repository_id, branch, genesis_head, head,
        ciphertext_sha256, signature_sha256 },
frame <the full execution-claimed Frame>, frame_sha256
```

Its fixed artifact name is
`attestrack-native-claim-<operation UUID>-<operation name>-<provider job ID>-<provider attempt>`.
The full frame hash uses the existing canonical JSON serialization, matching the
producer's closed ASCII/safe-integer Python contract.

## What the reader proves

- The actual original infra run and attempt agree, use the configured complete
  source commit and protected-main deployment workflow, and have one successful
  `scope` job and the exact successful original issuer job. The outer run may
  remain in progress; a failed/cancelled completed run refuses. No successful
  whole-run status is invented. Semantic identity/lifecycle bookends ignore
  incidental timestamps and step-progress metadata.
- Actual original workflow bytes match both their native Git blob identity and
  the source-owned reviewed SHA-256 pin. The exact original artifact has the
  expected run/repository/source/branch, name, archive size and native SHA-256.
  Expired, duplicate, foreign or malformed artifacts refuse.
- The body is closed and reconstructs exactly the existing claimed Frame. Its
  environment, operation, original provider executor and full-frame hash agree.
- Fresh public repository/ref reads identify the configured current store head.
  Its complete root tree contains exactly regular `ledger.age` and
  `ledger.age.sig`; the reader reconstructs native Git tree SHA-1, verifies each
  native blob SHA-1 and checks both SHA-256 digests. It repeats the head read after
  byte reads, after native issuer bookends, and after the provider fence.

GitHub artifact metadata identifies a **run**, not its producing job. The source
pin is therefore a reviewed sole-publisher contract, not an invented job field.
Before filling configuration, review the actual extended workflow: checkout must
use the exact original source; only the fixed issuer job may publish the claim
namespace; the payload must come from the authenticated current journal adapter.
An extra or changed uploader changes the pinned workflow bytes and refuses.
This code deliberately does not infer YAML semantics or trust a caller's
`approved` flag. Protect the configuration through normal application source review.

## Credential and readiness boundary

Native metadata confirms infra is **private**. Reading its original workflow,
run/job and artifact requires a reviewed read-only infra identity. The product
GITHUB_TOKEN alone is not claimed to have cross-repository access. The separate
`ProjectionGitHubRead` adapter allows only the configured infra original evidence
endpoints and selected public store ref; it follows only Git objects discovered
from that ref and pins the CLI hostname to github.com. It cannot submit Git writes,
provider calls or arbitrary API methods. The original application GitHub reader's
allowlist is unchanged. No read grant, token, secret or OPV binding is installed
by this packet; absence remains a real bootstrap prerequisite.

The infra role retains crypto/ancestry/transition verification and store writing.
The provider trusts its independently authenticated successful original projection
job and confirms current public ciphertext equality. It does not pretend to verify
encrypted logical content without the key. The public projection includes only
closed deployment identities/hashes, not secret values.

Thirteen new unique tests are selected once by required source CI. They cover
native provenance and namespace negatives, whole-workflow byte changes, current
head races, Git tree/blob verification, archive/closed-body tampering, source
defaults, endpoint restrictions, and the actual projection→process-fence capability
path using fictional metadata and isolated files. They are authored, not locally
executed. Syntax-only parsing and diff checks do not qualify hosted deployment.

The full lane remains open: existing central native admission/request routing,
journal job/adapter wiring, exact public projection publication, scoped read
authority, app waiting-provider jobs, terminal ACK flow, no-effect abort,
witness/recovery/acceptance and main's accepted exact-byte selection still need
end-to-end source assembly and genuine native qualification. This packet adds no
dispatch or owner-only task and does not activate either environment.

# Shared journal scheduling requirement

Read-only source evidence: infra main
`86597fd930ac3349d24cbd968d3eedc548dca7bf`,
`.github/workflows/platform-product-release.yml`, workflow-level concurrency:

```yaml
group: platform-release-${{ (inputs['source-branch'] || github.event.deployment.payload.inputs['source-branch']) == 'staging' && 'staging' || 'prod' }}
cancel-in-progress: false
queue: max
```

The native AttesTrack extension must retain this same central infra workflow
queue for the entire native transaction, including the waiting application
provider, its original-job acknowledgement, and journal reconciliation. The
effective keys are `platform-release-staging` and `platform-release-prod`.
Merely assigning a matching string in the application repository does not
serialize it with the infra workflow. The central run must remain alive and
own the queue; completing the projection issuer job may not release the outer
run's queue while its provider is still consuming the projection. Scheduling
does not replace independently validated request/environment authority.

Why this is required: both Fly and native adapters append the same environment
journal. A legitimate unrelated commit after projection issuance can invalidate
the exact current-head evidence. If it lands during the provider fence, the
create-only marker remains and no execution capability is exposed. This is a
safe hold, but ordinary retry cannot recover it: the same job's existing marker
refuses, and a replacement job violates the immutable executor binding. The
consumer must not remove the marker, ignore the head change, or treat that
outcome as proof that an arbitrary provider effect did not happen.

Future optimized recovery would require a separately reviewed authenticated
no-effect abort/renewal protocol. The current source does not implement that
protocol. Until then, preserve the shared queue throughout the transaction and
leave unknown/held operations excluded. Queue scheduling alone does not guard
owner writes or a terminated central run; those still require existing durable
claim reconciliation and explicit serialized owner handoffs. Staging and
production use separate stores and queue keys; neither blocks the other.

This addendum is an assembly requirement, not a workflow activation or test
result. Frozen consumer patch `cc5d46db...` and fence patch `e4893b6e...` are
unchanged. All native issuer profiles remain null.
