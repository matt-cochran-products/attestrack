import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, REPOSITORY } from './application-artifacts.ts';
import { canonical } from './native-release-canonical.ts';
import { claimOperation, consumeExecution, prepareOperation, type Frame } from './native-application-operation.ts';
import { JOB_FENCE_DIRECTORY, JOB_FENCE_FILE } from './native-application-job-fence.ts';
import type { GitHubRead, Journal } from './native-application-release.ts';
import { INFRA, INFRA_ID, JOURNAL_STORES, projectionArtifactName, validateProjection, type JournalProjection } from './native-journal-projection.ts';
import { ISSUER_WORKFLOW, NativeJournalProjectionReader, ProjectionGitHubRead, configuredProjectionReader, consumeProjection,
  selectIssuer, validateIssuerBinding, type IssuerBinding, type ProjectionLocator } from './native-journal-projection-reader.ts';

const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const blobId = (bytes: Buffer) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function zip(value: unknown, member = 'projection.json'): Buffer {
  return execFileSync('python3', ['-c', 'import sys,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:z.writestr(sys.argv[1],sys.stdin.buffer.read())\nsys.stdout.buffer.write(b.getvalue())', member], { input: JSON.stringify(value) });
}
let providerRun = 800;
function fixture(environment: Frame['environment'] = 'staging') {
  const hash = 'a'.repeat(64), source = 'b'.repeat(40), head = 'c'.repeat(40), genesis = 'e'.repeat(40);
  const owner = { repository_id: 41, workflow_commit: 'f'.repeat(40), run_id: ++providerRun, run_attempt: 1, job_id: 502 };
  const journal: Journal = { schema: 'attestrack.native-write-journal/v1', operation_id: uuid(1),
    artifact: { artifact_id: 91, producer_run: 100, producer_attempt: 1, archive_sha256: hash, inventory_sha256: hash, source_tree: source },
    target_sha256: hash, tool_profile_sha256: hash, predecessor: { worker: { deployment_id: uuid(2), version_id: uuid(3), latest_version_id: uuid(3),
      configuration_sha256: hash, version_configuration_sha256: hash, module_sha256: hash, operation_id: null, deployment_operation_id: null }, pages: null },
    operations: [{ name: 'worker-upload', state: 'unknown', native_id: null }], after: null };
  const frame = claimOperation(prepareOperation(journal, environment), owner);
  const store = { ...JOURNAL_STORES[environment], branch: 'release-ledger' as const, genesis_head: genesis };
  // Fictional reviewed source fixture, not a current deployed issuer job.
  const workflow = Buffer.from('name: Fictional infra journal\non: deployment\njobs:\n  scope:\n    runs-on: ubuntu-latest\n  attestrack-native-journal:\n    needs: scope\n    steps:\n      - uses: actions/upload-artifact@' + '1'.repeat(40) + '\n        with:\n          name: ${{ steps.projection.outputs.artifact-name }}\n');
  const binding: IssuerBinding = { store, issuer: { schema: 'attestrack.native-journal-issuer/v1', repository: INFRA, repository_id: INFRA_ID, workflow: ISSUER_WORKFLOW, source_commit: source,
    workflow_blob: blobId(workflow), workflow_sha256: digest(workflow), job_name: 'attestrack-native-journal' } };
  const original: ProjectionLocator = { run_id: 900, run_attempt: 1, job_id: 901, artifact_id: 902, source_commit: source };
  const cipher = Buffer.from('FICTIONAL opaque encrypted journal bytes'), signature = Buffer.from('FICTIONAL opaque signature bytes');
  const projection: JournalProjection = { schema: 'attestrack.native-operation-projection/v1', repository: REPOSITORY, environment,
    store: { ...store, head, ciphertext_sha256: digest(cipher), signature_sha256: digest(signature) }, frame, frame_sha256: digest(canonical(frame)) };
  let archive = zip(projection);
  const ip = `repos/${INFRA}`, sp = `repos/${store.repository}`;
  const run = { id: 900, run_attempt: 1, head_sha: source, head_branch: 'main', head_repository: { full_name: INFRA }, path: ISSUER_WORKFLOW,
    event: 'deployment', status: 'in_progress', conclusion: null as string | null };
  const journalJob = { id: 901, name: 'attestrack-native-journal', run_id: 900, run_attempt: 1, head_sha: source, status: 'completed', conclusion: 'success' as string | null };
  const scope = { ...journalJob, id: 903, name: 'scope' };
  const artifact = { id: 902, name: projectionArtifactName(frame), expired: false, size_in_bytes: archive.length, digest: `sha256:${digest(archive)}`,
    workflow_run: { id: 900, repository_id: INFRA_ID, head_repository_id: INFRA_ID, head_branch: 'main', head_sha: source } };
  const nativeBlob = (bytes: Buffer) => ({ sha: blobId(bytes), size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
  const workflowBlob = { ...nativeBlob(workflow), type: 'file', path: ISSUER_WORKFLOW };
  const ref = { ref: 'refs/heads/release-ledger', object: { type: 'commit', sha: head } };
  const entries = [
    { path: 'ledger.age', mode: '100644', type: 'blob', sha: blobId(cipher), size: cipher.length },
    { path: 'ledger.age.sig', mode: '100644', type: 'blob', sha: blobId(signature), size: signature.length },
  ];
  const treeBytes = Buffer.concat(entries.flatMap(entry => [Buffer.from(`100644 ${entry.path}\0`), Buffer.from(entry.sha, 'hex')]));
  const tree = createHash('sha1').update(`tree ${treeBytes.length}\0`).update(treeBytes).digest('hex');
  const gitTree = { sha: tree, truncated: false, tree: entries };
  const documents: Record<string, unknown> = {
    [ip]: { id: INFRA_ID, full_name: INFRA, fork: false, private: true, default_branch: 'main' },
    [`${ip}/branches/main`]: { name: 'main', protected: true },
    [`${ip}/actions/runs/900`]: run, [`${ip}/actions/runs/900/attempts/1`]: run,
    [`${ip}/actions/runs/900/attempts/1/jobs?per_page=100&page=1`]: { total_count: 2, jobs: [scope, journalJob] },
    [`${ip}/actions/runs/900/artifacts?per_page=100&page=1`]: { total_count: 1, artifacts: [artifact] },
    [`${ip}/contents/${ISSUER_WORKFLOW}?ref=${source}`]: workflowBlob,
    [sp]: { id: store.repository_id, full_name: store.repository, fork: false, private: false },
    [`${sp}/git/ref/heads/release-ledger`]: ref,
    [`${sp}/git/commits/${head}`]: { sha: head, tree: { sha: tree } },
    [`${sp}/git/trees/${tree}`]: gitTree,
    [`${sp}/git/blobs/${blobId(cipher)}`]: nativeBlob(cipher), [`${sp}/git/blobs/${blobId(signature)}`]: nativeBlob(signature),
  };
  const reads: string[] = []; let before: ((path: string) => void) | null = null;
  const reader: GitHubRead = { json<T>(path: string): T {
    reads.push(path); before?.(path); if (!(path in documents)) throw Error(`Unexpected projection read ${path}`); return structuredClone(documents[path]) as T;
  }, bytes(path) { reads.push(path); assert.equal(path, `${ip}/actions/artifacts/902/zip`); return archive; } };
  const context = { repository: REPOSITORY, environment, operation_id: journal.operation_id } as const;
  return { binding, original, projection, frame, owner, environment, source, workflow, workflowBlob, run, journalJob, scope, artifact,
    documents, reads, ref, gitTree, reader, context, ip, sp,
    verifier: () => new NativeJournalProjectionReader(binding, environment, original, reader),
    onRead(callback: (path: string) => void) { before = callback; },
    replaceArchive(value: unknown, member?: string) { archive = zip(value, member); artifact.size_in_bytes = archive.length; artifact.digest = `sha256:${digest(archive)}`; } };
}

test('both configured existing stores authenticate exact original issuer job and public current ciphertext while outer run remains active', async () => {
  for (const environment of ['staging', 'production'] as const) {
    const f = fixture(environment);
    assert.deepEqual(await f.verifier().readCurrent(f.context), f.frame);
    assert.equal(f.run.status, 'in_progress'); assert.equal(f.run.conclusion, null);
    assert.ok(f.reads.includes(`${f.ip}/actions/runs/900/attempts/1/jobs?per_page=100&page=1`));
    assert.equal(f.reads.filter(p => p === `${f.sp}/git/ref/heads/release-ledger`).length, 3);
  }
});
test('real source defaults are null and refuse before creating a native reader or execution grant', () => {
  const f = fixture(), profile = JSON.parse(readFileSync(new URL('../release/application-journal-issuers.json', import.meta.url), 'utf8'));
  assert.equal(profile.staging, null); assert.equal(profile.production, null);
  for (const environment of ['staging', 'production'] as const) {
    assert.throws(() => selectIssuer(profile, environment), /unconfigured/);
    assert.throws(() => configuredProjectionReader(environment, f.original), /unconfigured/);
  }
  assert.equal(f.reads.length, 0);
});
test('configuration binds actual known repository IDs, exact ref, non-null genesis and reviewed issuer source', () => {
  const f = fixture();
  const changes: ((b: IssuerBinding) => void)[] = [b => { b.store.repository_id++; }, b => { b.store.repository = 'foreign/store'; },
    b => { b.store.genesis_head = ''; }, b => { b.issuer.repository_id++; }, b => { b.issuer.workflow_blob = ''; },
    b => { b.issuer.workflow_sha256 = ''; }, b => { b.issuer.source_commit = ''; }];
  for (const change of changes) { const b = structuredClone(f.binding); change(b); assert.throws(() => validateIssuerBinding(b, 'staging')); }
  assert.throws(() => validateIssuerBinding(f.binding, 'production'));
  assert.throws(() => validateIssuerBinding({ ...f.binding, issuer: { ...f.binding.issuer, job_name: 'scope' } }, 'staging'));
  assert.throws(() => new NativeJournalProjectionReader(f.binding, 'staging', { ...f.original, source_commit: '0'.repeat(40) }, f.reader), /source pin/);
});
test('projection is closed and binds the exact claim, operation, environment, full frame and configured genesis', () => {
  const f = fixture();
  for (const patch of [{ schema: 'other' }, { extra: true }, { environment: 'production' }, { frame_sha256: '0'.repeat(64) },
    { frame: { ...f.frame, state: 'unknown' } }, { store: { ...f.projection.store, genesis_head: '0'.repeat(40) } }]) {
    assert.throws(() => validateProjection({ ...f.projection, ...patch }, f.context, f.binding.store));
  }
  assert.throws(() => validateProjection(f.projection, { ...f.context, operation_id: uuid(9) }, f.binding.store));
});
test('original run/source/attempt/job/scope defects refuse before projection download', async () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [f => { f.run.run_attempt = 2; }, f => { f.run.head_sha = '0'.repeat(40); },
    f => { f.run.event = 'push'; }, f => { f.journalJob.id++; }, f => { f.journalJob.conclusion = 'failure'; },
    f => { f.run.status = 'completed'; f.run.conclusion = 'failure'; },
    f => { f.scope.conclusion = 'failure'; }, f => { f.documents[`${f.ip}/branches/main`] = { name: 'main', protected: false }; },
    f => { f.documents[`${f.ip}/actions/runs/900`] = { ...f.run, status: 'completed', conclusion: 'cancelled' }; }];
  for (const change of changes) {
    const f = fixture(); change(f); await assert.rejects(f.verifier().readCurrent(f.context));
    assert.ok(!f.reads.includes(`${f.ip}/actions/artifacts/902/zip`));
  }
});
test('actual original workflow mutation or an additional uploader fails the reviewed whole-source pin', async () => {
  for (const suffix of ['# changed source\n', '  second-publisher:\n    steps:\n      - uses: actions/upload-artifact@' + '1'.repeat(40) + '\n']) {
    const f = fixture(), changed = Buffer.concat([f.workflow, Buffer.from(suffix)]);
    Object.assign(f.workflowBlob, { sha: blobId(changed), size: changed.length, content: changed.toString('base64') });
    await assert.rejects(f.verifier().readCurrent(f.context), /workflow/);
    assert.ok(!f.reads.includes(`${f.ip}/actions/artifacts/902/zip`));
  }
});
test('artifact origin, uniqueness, job-bound name, archive hash and closed ZIP member are independently required', async () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [f => { f.artifact.expired = true; }, f => { f.artifact.workflow_run.repository_id++; },
    f => { f.artifact.digest = `sha256:${'0'.repeat(64)}`; }, f => { f.artifact.name += '-other'; },
    f => { f.documents[`${f.ip}/actions/runs/900/artifacts?per_page=100&page=1`] = { total_count: 2, artifacts: [f.artifact, { ...f.artifact, id: 904 }] }; },
    f => { f.replaceArchive(f.projection, 'wrong.json'); }, f => { f.replaceArchive({ ...f.projection, frame_sha256: '0'.repeat(64) }); }];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.verifier().readCurrent(f.context)); }
});
test('stale or changing public head refuses at initial read, byte bookend and final issuer bookend', async () => {
  for (const at of [1, 2, 3]) {
    const f = fixture(); let reads = 0;
    f.onRead(path => { if (path === `${f.sp}/git/ref/heads/release-ledger` && ++reads === at) f.ref.object.sha = '0'.repeat(40); });
    await assert.rejects(f.verifier().readCurrent(f.context), /head/);
  }
});
test('public repository and complete regular-file tree/blob identity cannot be replaced by digest-only claims', async () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [f => { f.documents[f.sp] = { id: 1, full_name: f.binding.store.repository, fork: false, private: false }; },
    f => { f.gitTree.truncated = true; }, f => { f.gitTree.tree[0].mode = '120000'; }, f => { f.gitTree.tree[0].path = 'index.age'; },
    f => { f.gitTree.tree.push({ ...f.gitTree.tree[0] }); },
    f => { const entry = f.gitTree.tree[0]; f.documents[`${f.sp}/git/blobs/${entry.sha}`] = { sha: entry.sha, size: entry.size, encoding: 'base64', content: Buffer.from('wrong').toString('base64') }; },
    f => { const p = structuredClone(f.projection); p.store.signature_sha256 = '0'.repeat(64); f.replaceArchive(p); }];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.verifier().readCurrent(f.context)); }
});
test('incidental native job progress is accepted but lifecycle changes at the issuer bookend refuse', async () => {
  for (const change of ['metadata', 'lifecycle']) {
    const f = fixture(); let reads = 0;
    f.onRead(path => {
      if (path === `${f.ip}/actions/runs/900` && ++reads === 2) {
        if (change === 'metadata') { Object.assign(f.run, { updated_at: '2026-11-15T01:00:00Z' }); Object.assign(f.journalJob, { steps: [{ status: 'completed' }] }); }
        else f.journalJob.conclusion = 'cancelled';
      }
    });
    if (change === 'metadata') assert.deepEqual(await f.verifier().readCurrent(f.context), f.frame);
    else await assert.rejects(f.verifier().readCurrent(f.context));
  }
});
test('read adapter rejects foreign stores, alternate refs, undiscovered objects and non-read selectors before invoking gh', () => {
  const f = fixture(), reader = new ProjectionGitHubRead(f.binding, 'staging', f.original);
  for (const path of ['https://github.com', 'repos/foreign/store', `${f.sp}/git/ref/heads/main`, `${f.sp}/git/blobs/${'a'.repeat(40)}`,
    `${f.ip}/actions/runs/901`, `${f.ip}/actions/runs/900/attempts/2/jobs?per_page=100&page=1`, `${f.ip}/actions/artifacts/902/zip?method=POST`]) {
    assert.throws(() => reader.bytes(path), /Unapproved/);
  }
});
function providerRuntime(f: ReturnType<typeof fixture>, temporary: string) {
  const owner = f.owner, p = `repos/${REPOSITORY}`, name = 'native-worker-upload';
  const run = { id: owner.run_id, run_attempt: owner.run_attempt, head_sha: owner.workflow_commit, head_branch: 'main', head_repository: { full_name: REPOSITORY },
    path: '.github/workflows/application-release.yml', event: 'workflow_run', status: 'in_progress', conclusion: null };
  const job = { id: owner.job_id, name, run_id: owner.run_id, run_attempt: owner.run_attempt, head_sha: owner.workflow_commit, status: 'in_progress', conclusion: null };
  f.documents[p] = { id: owner.repository_id, full_name: REPOSITORY, fork: false, default_branch: 'main' };
  f.documents[`${p}/actions/runs/${owner.run_id}`] = run; f.documents[`${p}/actions/runs/${owner.run_id}/attempts/1`] = run;
  f.documents[`${p}/actions/runs/${owner.run_id}/attempts/1/jobs?per_page=100&page=1`] = { total_count: 2, jobs: [job, { ...job, id: 503, name: 'scope', status: 'completed', conclusion: 'success' }] };
  return { github: f.reader, env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: String(owner.repository_id), GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com', GITHUB_EVENT_NAME: 'workflow_run', GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_JOB: name,
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/application-release.yml@refs/heads/main`, GITHUB_SHA: owner.workflow_commit, GITHUB_WORKFLOW_SHA: owner.workflow_commit,
    GITHUB_RUN_ID: String(owner.run_id), GITHUB_RUN_ATTEMPT: '1', RUNNER_OS: 'Linux', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: temporary } };
}
test('verified current-head projection feeds the mandatory original provider-job fence without any journal/provider write role', async () => {
  const f = fixture(), temporary = mkdtempSync(join(tmpdir(), 'attestrack-projection-fence-'));
  try {
    const cap = await consumeProjection(f.verifier(), f.context, f.owner, providerRuntime(f, temporary));
    assert.deepEqual(consumeExecution(cap), f.frame);
    assert.equal(JSON.parse(readFileSync(join(temporary, JOB_FENCE_DIRECTORY, JOB_FENCE_FILE), 'utf8')).frame_sha256, f.projection.frame_sha256);
    assert.throws(() => consumeExecution(cap), /capability/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
test('journal head change during fence creation withholds capability and retains consumed marker', async () => {
  const f = fixture(), temporary = mkdtempSync(join(tmpdir(), 'attestrack-projection-hold-'));
  try {
    const runtime = providerRuntime(f, temporary); let reads = 0;
    f.onRead(path => { if (path === `repos/${REPOSITORY}/actions/runs/${f.owner.run_id}` && ++reads === 2) f.ref.object.sha = '0'.repeat(40); });
    await assert.rejects(consumeProjection(f.verifier(), f.context, f.owner, runtime), /head/);
    assert.ok(existsSync(join(temporary, JOB_FENCE_DIRECTORY, JOB_FENCE_FILE)));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('actual default NativeGitHub CLI transport pins github.com despite a foreign GH_HOST and preserves its repository allowlist', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'attestrack-native-gh-argv-'));
  try {
    const capture = join(temporary, 'calls.jsonl');
    // Fictional executable only: no network, credential read or actual gh process.
    // Simulate gh's GH_HOST default so dropping the explicit hostname fails.
    const fake = `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nconst argv=process.argv.slice(2),i=argv.indexOf('--hostname');\nconst selected=i<0?process.env.GH_HOST:argv[i+1];\nappendFileSync(process.env.ATTESTRACK_FICTIONAL_ARGV,JSON.stringify(argv)+'\\n');\nif(selected!=='github.com')process.exit(71);\nprocess.stdout.write(JSON.stringify({fixture:true,selected}));\n`;
    writeFileSync(join(temporary, 'gh'), fake, { mode: 0o700 });
    const module = new URL('./native-application-release.ts', import.meta.url).href;
    const program = `import {NativeGitHub} from ${JSON.stringify(module)};\nconst reader=new NativeGitHub();\nconst result=reader.json(${JSON.stringify(`repos/${REPOSITORY}`)});\nlet refused=false;try{reader.bytes('repos/foreign/repository')}catch{refused=true}\nprocess.stdout.write(JSON.stringify({result,refused}));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      env: { PATH: temporary, GH_HOST: 'untrusted.invalid', ATTESTRACK_FICTIONAL_ARGV: capture }, timeout: 10000,
    }).toString());
    assert.deepEqual(result, { result: { fixture: true, selected: 'github.com' }, refused: true });
    const calls = readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls, [['api', '--hostname', 'github.com', `repos/${REPOSITORY}`]]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('native CI RUNNER_TEMP metadata satisfies the unchanged original-job filesystem prerequisites', t => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    t.skip('Native GitHub Actions runner metadata proof only; no local compatibility claim');
    return;
  }
  assert.ok(process.platform === 'linux' && process.env.RUNNER_OS === 'Linux', 'Original-job fence requires the native Linux runner');
  assert.ok(typeof process.getuid === 'function', 'Native runner uid must be available');
  const temporary = process.env.RUNNER_TEMP;
  assert.ok(temporary && isAbsolute(temporary) && resolve(temporary) === temporary && dirname(temporary) !== temporary, 'Native RUNNER_TEMP must be a fixed absolute directory');
  assert.ok(constants.O_NOFOLLOW && constants.O_DIRECTORY, 'Native no-follow directory primitives must be available');
  for (let path = temporary; ; path = dirname(path)) {
    const stat = lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Native RUNNER_TEMP ancestry must contain only real directories');
    if (path === dirname(path)) break;
  }
  // Read metadata only: do not reserve a real claim or write anything in the
  // actual RUNNER_TEMP. All other suite writes stay in isolated fixture dirs.
  const fd = openSync(temporary, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const pinned = fstatSync(fd), current = lstatSync(temporary);
    assert.ok(pinned.isDirectory() && pinned.uid === process.getuid!() && (pinned.mode & 0o022) === 0, 'Native RUNNER_TEMP must be owned by this uid and not group/other writable');
    assert.ok(pinned.dev === current.dev && pinned.ino === current.ino, 'Native RUNNER_TEMP identity must remain pinned');
  } finally { closeSync(fd); }
});
