# Native release source admission

This is the first source artifact for issue103, not the completed hosted release
pipeline. It does not deploy, mint credentials, request an environment, call OPV,
run application/fixture code, or assert acceptance/recovery. Existing artifact
and tool publishers, Worker/Pages/KV/warehouse topology and separate package/CLI
release ownership are unchanged.

## Fixed execution and inputs

`.github/workflows/application-release.yml` runs only on natural completion of
`Retained application artifacts` or `Native release tool bytes` for staging/main.
The workflow executes the protected default-main SDK, not upstream source; its
checkout is pinned to `github.workflow_sha`. It has only Contents/Actions/Pull
Requests read, no environment or secret reference, no arbitrary input/command and
no dependency install. The two completion events can each produce a plan. If the
peer producer is unfinished, admission fails; its later natural completion can
wake admission. No age-based rerun/retry is added.

The fixed CLI takes no arguments. It checks protected-main runner identity and
actual clean Git HEAD, then native own repository/run/attempt/active scope job,
original successful push producer identities and current protected branch head.
The desired source must be a native normal same-repository dev→staging or
staging→main merge whose second-parent complete tree equals the merged tree.
Closed promotion PRs are read explicitly: the commit-associated PR endpoint can
return only the default-branch introduction after bootstrap. Branch identities
are re-read after all archive checks; advancement refuses before output.

Only source-reviewed `release/application-release-targets.json` selects targets.
Its closed schema `attestrack.application-release-targets/v1` has `staging` and
`production` entries, initially BOTH null. A configured entry is exactly
`{native,http}` using the existing `NativeWriter.Target` and HTTP witness target
schemas. Native `SITE_ID`, HTTP site and declared lane must agree. Staging also
must equal the existing `release/application-targets.json` staging target; that
older HTTP-only witness schema is not changed. Null refuses without opening a
provider/fixture environment or OPV channel. Neither profile hashes nor an
`environment` label prove existing target ownership, isolation or live readiness.
Actual existing mappings and grants remain owner/native qualification inputs;
this source invents none and creates no service.

## Actual retained-byte admission

Staging authenticates the original application run/attempt and native archive.
Main authenticates its actual `application-materialization-ATTEMPT` receipt, then
reopens the SAME original staged artifact ID/run/attempt/archive/inventory. The
original staged producer must be in main's promoted ancestry and its complete
tree must match. There is no application rebuild/compile fallback.

`readApplication(reader, repositoryId, locator, tree)` first uses the existing
native archive/origin validator before inspecting source provenance. It pins the
actual original application AND recorded Source2 CI attempt endpoints, then calls
existing `readOriginal` for full source/job/PR/publisher/recipe/lock/template/entry
admission. A later rerun cannot substitute latest metadata. This does not admit
historical dev green, weaker source schemas, skipped jobs or unsigned fixture
claims. Native listing completeness/duplicate rules and ZIP digest-before-parse
are reused. The original tool producer/attempt/job/archive is independently
verified with the exact existing pinned BLAKE3 JS/Wasm profile; scope never loads
that runtime or executes candidate bytes. No publisher/signing system is added.

## Output and remaining consumer contract

A successful scope emits only canonical `application-release-request.json`, schema
`attestrack.application-source-admission/v1`, kind `planned`. It binds source
commit/tree, current normal promotion, original application identity, main
materialization locator when present, original tool locator/profile and canonical
reviewed native/HTTP target hashes. `request-sha256` is the SHA256 of exact file
bytes. The attempt-named native artifact is
`application-source-admission-RUN-ATTEMPT`. Job outputs expose only its name and
request hash. None is an execution grant or successful deployment receipt.

Root's remaining coordinator must:

1. Authenticate the actual completed source-scope workflow/job/artifact ID, source
   commit, run/attempt and native ZIP digest before parsing. Re-read protected
   current heads and the exact original reviewed profile/SDK closure before
   credential allocation; never trust the plan's `kind` or a caller hash as a
   grant. Qualify actual workflow_run native metadata against this strict default-
   main source binding before enabling any writer.
2. Reopen original application/tool artifacts using the same pinned native
   validators. Fetch the profile from its protected original workflow commit,
   compare canonical profile/native/HTTP hashes, and independently prove existing
   Worker/Pages IDs/config, origin routing/Access, fixture identity/site and
   runtime outbound constraints. Source shape does not establish those facts.
3. Own durable exclusion and write-ahead operation/phase identity before existing
   `NativeWriter` calls. Two completion events can emit plans with distinct outer
   contexts: the plan digest is NOT an idempotency key. Coalesce/reconcile the same
   actual artifact/target transaction and never replay an ambiguous mutation.
4. Establish genuine predecessor and compatible retained recovery authority,
   execute bounded hosted HTTP/warehouse acceptance plus P/C/R/resume forward-write
   witness with durable prepared IDs, and independently join fresh native serving
   identity/routing after observations. Then require accepted staged exact bytes
   before same-artifact production deployment. A main source/materialization
   success alone cannot authorize production.
5. Supply an explicit owner-authorized first staging canary path once profiles and
   prerequisites exist. Installing this workflow on main cannot retroactively
   trigger an earlier staging completion. Do not solve that bootstrap timing by
   claiming old events were current, inventing a live acceptance, or rebuilding
   main. Normal subsequent staging/main producers wake this scope naturally.

No real target, fixture, native writer/coordinator, recovery baseline or hosted
acceptance has been qualified by this component. Issue103 remains open.

## Source validation

The registered Node24 source tests use
`node --test --experimental-test-isolation=none scripts/application-release-scope.test.ts`.
In the installed24.21 native runner, ordinary isolated TS test execution reported
only a file-level test; the explicit flag executes the named regressions. The
existing source CI commands/gates remain intact. Tests use real native ZIP parsing,
locked public tool bytes, synthetic API responses, and an actual clean temporary
Git checkout/fixed CLI invocation; no provider, paid work or credentials are used.
