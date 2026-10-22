// Provenance: focused copy of the canonical retained-build tests at
// bd8f2dd368809eaab81418fb8f9e9d201e32a688 (candidateRuns, mustReuse, validate,
// verifyStagingPr). Infra generator and image cases are excluded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateRuns, mustReuse, validate, verifyStagingPr, type Evidence, type PullRequest, type Run } from '../.github/actions/retained-build/retained-build.ts';

const repository = 'matt-cochran-products/example';
const tree = 'a'.repeat(40);
const run: Run = { id: 12, run_attempt: 1, head_sha: 'b'.repeat(40), head_branch: 'dev',
  head_repository: { full_name: repository }, path: '.github/workflows/ci.yml',
  event: 'pull_request', status: 'completed', conclusion: 'success',
  pull_requests: [{ number: 5, base: { ref: 'staging', repo: { id: 1 } }, head: { sha: 'b'.repeat(40), repo: { id: 1 } } }] };
const evidence: Evidence = { schema: 1, repository, workflow: 'ci.yml', run_id: 12,
  run_attempt: 1, head_sha: run.head_sha, built_sha: 'c'.repeat(40), tree };

test('identical tree allows a different promotion merge commit', () => {
  validate(evidence, run, repository, 'ci.yml', tree);
});
test('reject changed trees, attempts, repositories and workflow identities', () => {
  for (const patch of [{ tree: 'd'.repeat(40) }, { run_id: 13 }, { run_attempt: 2 },
    { repository: 'attacker/example' }, { workflow: 'other.yml' }, { head_sha: 'e'.repeat(40) },
    { built_sha: '--help' }, { schema: 2 }]) {
    assert.throws(() => validate({ ...evidence, ...patch }, run, repository, 'ci.yml', tree));
  }
});
test('reject failed, cancelled, fork, non-staging and wrong-workflow builds', () => {
  for (const patch of [{ conclusion: 'failure' }, { status: 'in_progress' },
    { head_repository: { full_name: 'attacker/example' } }, { path: '.github/workflows/other.yml' },
    { event: 'pull_request_target' }, { event: 'workflow_dispatch', head_branch: 'dev' }]) {
    assert.throws(() => validate(evidence, { ...run, ...patch }, repository, 'ci.yml', tree));
  }
});
const stagingPr: PullRequest = { number: 670, base: { ref: 'staging', repo: { id: 1, full_name: repository } },
  head: { ref: 'dev', sha: run.head_sha, repo: { id: 1, full_name: repository } } };
const closedRun: Run = { ...run, pull_requests: [] };
const provenance = { number: 670, base_ref: 'staging', base_repo_id: 1, head_ref: 'dev', head_repo_id: 1, head_sha: run.head_sha };
const evidence2: Evidence = { ...evidence, schema: 2, pull_request: provenance };

test('closed staging PR with recorded provenance still provides evidence', () => {
  validate(evidence2, closedRun, repository, 'ci.yml', tree);
  assert.equal(verifyStagingPr(evidence2, closedRun, repository, [stagingPr]).number, 670);
});
test('legacy evidence is accepted only through a live staging PR for the run head', () => {
  assert.equal(verifyStagingPr(evidence, closedRun, repository, [stagingPr]).number, 670);
});
test('reject a recorded PR whose base is not staging', () => {
  assert.throws(() => verifyStagingPr({ ...evidence2, pull_request: { ...provenance, base_ref: 'main' } }, closedRun, repository, [stagingPr]));
});
test('reject a PR retargeted away from staging after the build', () => {
  assert.throws(() => verifyStagingPr(evidence2, closedRun, repository, [{ ...stagingPr, base: { ...stagingPr.base, ref: 'main' } }]));
});
test('reject a fork PR', () => {
  const fork = { ...stagingPr, head: { ...stagingPr.head, repo: { id: 2, full_name: 'attacker/example' } } };
  assert.throws(() => verifyStagingPr(evidence, closedRun, repository, [fork]));
});
test('reject recorded fork provenance', () => {
  assert.throws(() => verifyStagingPr({ ...evidence2, pull_request: { ...provenance, head_repo_id: 2 } }, closedRun, repository, [stagingPr]));
});
test('reject a PR whose head moved past the built commit', () => {
  assert.throws(() => verifyStagingPr(evidence2, closedRun, repository, [{ ...stagingPr, head: { ...stagingPr.head, sha: 'e'.repeat(40) } }]));
});
test('reject recorded provenance for a different PR', () => {
  assert.throws(() => verifyStagingPr(evidence2, closedRun, repository, [{ ...stagingPr, number: 671 }]));
});
test('reject a closed staging PR build whose tree differs', () => {
  assert.throws(() => validate({ ...evidence2, tree: 'd'.repeat(40) }, closedRun, repository, 'ci.yml', tree));
});
test('reject schema 2 pull_request evidence without provenance', () => {
  assert.throws(() => validate({ ...evidence2, pull_request: null }, closedRun, repository, 'ci.yml', tree));
});
test('reject legacy evidence when no live staging PR matches the run', () => {
  assert.throws(() => verifyStagingPr(evidence, closedRun, repository, []));
});

// Discovery lists unfiltered (infra#939) and must enforce success locally
// before main() touches any artifact of the yielded runs.
function discover(pages: Run[][]) {
  const paths: string[] = [];
  const list = (path: string) => { paths.push(path); return { workflow_runs: pages[paths.length - 1] ?? [] }; };
  return { runs: [...candidateRuns(repository, 'ci.yml', 99, list)], paths };
}
const listPath = (page: number) => `repos/${repository}/actions/workflows/ci.yml/runs?per_page=100&page=${page}`;
test('discovery yields a completed successful staging run from the unfiltered list', () => {
  assert.deepEqual(discover([[run]]), { runs: [run], paths: [listPath(1)] });
});
test('discovery rejects a failed run without artifact access', () => {
  assert.deepEqual(discover([[{ ...run, conclusion: 'failure' }]]), { runs: [], paths: [listPath(1)] });
});
test('discovery rejects an in-progress run without artifact access', () => {
  const inProgress = { ...run, status: 'in_progress', conclusion: null as unknown as string };
  assert.deepEqual(discover([[inProgress]]), { runs: [], paths: [listPath(1)] });
});
test('discovery rejects a run with absent status without artifact access', () => {
  const { status: _s, ...noStatus } = run;
  assert.deepEqual(discover([[noStatus as Run]]), { runs: [], paths: [listPath(1)] });
});
test('discovery rejects a run with absent conclusion without artifact access', () => {
  const { conclusion: _c, ...noConclusion } = run;
  assert.deepEqual(discover([[noConclusion as Run]]), { runs: [], paths: [listPath(1)] });
});
test('discovery rejects a completed run with unknown conclusion without artifact access', () => {
  assert.deepEqual(discover([[{ ...run, conclusion: 'unknown' }]]), { runs: [], paths: [listPath(1)] });
});
test('discovery rejects a successful run with unknown status without artifact access', () => {
  assert.deepEqual(discover([[{ ...run, status: 'unknown', conclusion: 'success' }]]), { runs: [], paths: [listPath(1)] });
});
test('discovery keeps a success listed behind a rejected run on the same page', () => {
  const success = { ...run, id: 2 };
  assert.deepEqual(discover([[{ ...run, id: 1, conclusion: 'failure' }, success]]), { runs: [success], paths: [listPath(1)] });
});
test('discovery stays bounded to 10 pages of 100', () => {
  const full = Array(100).fill({ ...run, id: 1, conclusion: 'failure' });
  const expected = { runs: [], paths: Array.from({ length: 10 }, (_, i) => listPath(i + 1)) };
  assert.deepEqual(discover(Array.from({ length: 11 }, () => full)), expected);
});

test('protected staging dispatch can provide evidence', () => {
  validate(evidence, { ...run, event: 'workflow_dispatch', head_branch: 'staging' }, repository, 'ci.yml', tree);
});
test('production always requires staging reuse, including hotfixes; forks are refused', () => {
  const pr = { base: { ref: 'main' }, head: { ref: 'staging', repo: { full_name: repository } } };
  assert.equal(mustReuse('pull_request', { pull_request: pr }, 'refs/pull/1/merge', repository), true);
  assert.equal(mustReuse('workflow_dispatch', {}, 'refs/heads/main', repository), true);
  assert.equal(mustReuse('workflow_dispatch', {}, 'refs/heads/staging', repository), false);
  assert.throws(() => mustReuse('pull_request', { pull_request: { ...pr, head: { ...pr.head, ref: 'hotfix/bug' } } }, '', repository), /Production promotion must come from staging/);
  assert.throws(() => mustReuse('pull_request', { pull_request: { ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } } }, '', repository));
});
test('production promotion from a deleted fork is refused as a fork, not a TypeError', () => {
  const event = { pull_request: { base: { ref: 'main' }, head: { ref: 'staging', repo: null } } };
  assert.throws(() => mustReuse('pull_request', event, 'refs/pull/9/merge', repository), /cannot come from a fork/);
});
test('a staging PR whose head repository was deleted is not accepted', () => {
  const pr = { number: 5, base: { ref: 'staging', repo: { id: 1, full_name: repository } },
    head: { ref: 'dev', sha: run.head_sha, repo: null } } as PullRequest;
  assert.throws(() => verifyStagingPr(evidence, run, repository, [pr]), /same-repository staging PR/);
});
