import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { admit, main, PROFILE, runnerContext, selectProfile, WORKFLOW } from './application-release-scope.ts';
import { digest, fileBytes, inventory, publisherIdentity, PUBLISHER_FILES, type Payload, REPOSITORY } from './application-artifacts.ts';
import { TOOL_FILES, TOOL_PROFILE } from './native-release-tool.ts';
import { buildWorkerEntry } from '../packages/deploy/src/worker-template.ts';
import type { GitHubRead, Target } from './native-application-release.ts';
const context = { repository_id: 41, workflow_commit: 'a'.repeat(40), run_id: 200, run_attempt: 1 };
const http = { origin: 'https://fixture.example.invalid', site_id: 'fictional-site', policy_hash: 'a'.repeat(64) };
const native: Target = { environment: 'staging', account_id: 'a'.repeat(32),
  worker: { id: 'b'.repeat(32), name: 'fictional-worker', configuration_sha256: 'c'.repeat(64), bindings: [
    { name: 'SITE_ID', type: 'plain_text', text: http.site_id }, { name: 'ATTESTRACK_KV', type: 'kv_namespace', namespace_id: 'd'.repeat(32) }, { name: 'CONSENT_TOKEN_SECRET', type: 'secret_text' }] }, pages: null };
const profile = (): {schema:string;staging:{native:Target;http:typeof http};production:{native:Target;http:typeof http}|null} => ({ schema: 'attestrack.application-release-targets/v1', staging: { native: structuredClone(native), http: { ...http } }, production: null });
const witness = () => ({ schema: 'attestrack.application-targets/v1', staging: { ...http } });
const environment = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: '41',
  GITHUB_SERVER_URL: 'https://github.com', GITHUB_API_URL: 'https://api.github.com', GITHUB_EVENT_NAME: 'workflow_run',
  GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_JOB: 'scope', GITHUB_SHA: context.workflow_commit,
  GITHUB_WORKFLOW_SHA: context.workflow_commit, GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '1' });

test('actual tracked defaults refuse staging and production before native API/credential custody', () => {
  const p = JSON.parse(readFileSync(new URL('../' + PROFILE, import.meta.url), 'utf8'));
  const w = JSON.parse(readFileSync(new URL('../release/application-targets.json', import.meta.url), 'utf8'));
  const reader: GitHubRead = { json() { assert.fail('unconfigured target reached native API'); }, bytes() { assert.fail('unconfigured target downloaded bytes'); } };
  for (const branch of ['staging', 'main']) assert.throws(() => admit(reader, context,
    { action: 'completed', repository: { id: 41, full_name: REPOSITORY }, workflow_run: { head_branch: branch } }, p, w), /unconfigured/);
});
test('closed reviewed native profile agrees with the existing HTTP site and environment', () => {
  assert.deepEqual(selectProfile(profile(), witness(), 'staging'), { native, http });
  const bad = profile(); bad.staging.native.worker.bindings[0] = { name: 'SITE_ID', type: 'plain_text', text: 'other-site' };
  assert.throws(() => selectProfile(bad, witness(), 'staging'), /site differ/);
  assert.throws(() => selectProfile(profile(), { ...witness(), staging: null }, 'staging'), /unconfigured/);
  assert.throws(() => selectProfile({ ...profile(), extra: true }, witness(), 'staging'), /Nonclosed/);
  assert.throws(() => selectProfile({ ...profile(), production: { arbitrary: true } }, witness(), 'staging'), /Nonclosed/);
  assert.throws(() => selectProfile(profile(), { ...witness(), staging: { ...http, origin: 'https://other.invalid' } }, 'staging'), /binding differs/);
  const wrong = profile(); wrong.staging.native.environment = 'production';
  assert.throws(() => selectProfile(wrong, witness(), 'staging'), /environment/);
});
test('scope context is fixed protected main, original positive run IDs, and no CLI selectors', () => {
  assert.deepEqual(runnerContext(environment()), context);
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/dev' }, { GITHUB_REF_PROTECTED: 'false' },
    { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) }, { GITHUB_JOB: 'writer' }, { GITHUB_RUN_ATTEMPT: '1.5' }, { GITHUB_RUN_ID: '0' }, { GITHUB_REPOSITORY: 'foreign/repo' }]) {
    assert.throws(() => runnerContext({ ...environment(), ...patch }));
  }
  assert.throws(() => main({}, ['--run', 'anything']), /no selectors/);
});
test('scope workflow preserves publishers and grants only read authority with no environment/OPV install', () => {
  const workflow = readFileSync(new URL('../' + WORKFLOW, import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:/); assert.match(workflow, /workflows: \[Retained application artifacts, Native release tool bytes\]/);
  assert.match(workflow, /ref: \$\{\{ github.workflow_sha }}/);
  assert.doesNotMatch(workflow, /(?:environment:|secrets:|id-token:|deployments:|packages:|workflow_dispatch:|pnpm install)/);
  assert.match(workflow, /run: node scripts\/application-release-scope.ts/);
});

const STAGE = 'a'.repeat(40), TREE = 'b'.repeat(40), DEV = 'd'.repeat(40), MAIN = 'e'.repeat(40), BUILT = 'f'.repeat(40);
const prefix = `repos/${REPOSITORY}`;
const obj = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
function zip(member: string, value: unknown): Buffer {
  return execFileSync('/usr/bin/python3', ['-I', '-c', 'import sys,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:z.writestr(sys.argv[1],sys.stdin.buffer.read())\nsys.stdout.buffer.write(b.getvalue())', member], { input: JSON.stringify(value), timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
}
function toolValue() {
  const deploy = createRequire(new URL('../packages/deploy/package.json', import.meta.url));
  const wrangler = createRequire(deploy.resolve('wrangler/package.json'));
  const directory = dirname(wrangler.resolve('blake3-wasm/package.json'));
  return { schema: 'attestrack.native-release-tool/v1', profile_sha256: TOOL_PROFILE,
    files: Object.fromEntries(Object.keys(TOOL_FILES).map(p => [p, readFileSync(join(directory, p)).toString('base64')])) };
}
function fixture(branch: 'staging' | 'main' = 'staging') {
  const ctx = { ...context, workflow_commit: MAIN };
  const data = new Map<string, unknown>(), blobs = new Map<string, Buffer>(), reads: string[] = [];
  const bytes = [fileBytes('worker/index.js', Buffer.from('export default {fetch(){return new Response("synthetic")} };')),
    fileBytes('worker/entry.ts', Buffer.from(buildWorkerEntry())), fileBytes('portal/index.html', Buffer.from('<head><meta name="attestrack-portal-api" content="same-origin" /></head>')),
    fileBytes('schema/clickhouse.sql', Buffer.from('-- synthetic unchanged warehouse'))].sort((a, b) => a.path.localeCompare(b.path));
  const payload: Payload = { schema: 'attestrack.application-bytes/v2', repository: REPOSITORY, repository_id: 41,
    producer: { run_id: 100, run_attempt: 1, source_sha: STAGE, tree: TREE, workflow: 'application-artifacts.yml' },
    source: { schema: 2, repository: REPOSITORY, workflow: 'ci.yml', run_id: 50, run_attempt: 1, head_sha: DEV, built_sha: BUILT, tree: TREE,
      pull_request: { number: 8, base_ref: 'staging', base_repo_id: 41, head_repo_id: 41, head_ref: 'dev', head_sha: DEV } },
    build: { node: 'v24.21.0', pnpm: '9.0.0', esbuild: '0.28.2', lock_sha256: digest(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url))),
      entry_sha256: digest(buildWorkerEntry()), template_sha256: digest(readFileSync(new URL('../packages/deploy/src/worker-template.ts', import.meta.url))),
      publisher_sha256: publisherIdentity(p => readFileSync(new URL('../' + p, import.meta.url))).sha256, compatibility_date: '2024-12-01' },
    files: bytes, inventory_sha256: inventory(bytes) };
  const source = branch === 'staging' ? STAGE : MAIN;
  function run(id: number, path: string, sha: string, headBranch: string, event = 'push') {
    return { id, run_attempt: 1, path, head_sha: sha, head_branch: headBranch, head_repository: { full_name: REPOSITORY },
      event, status: 'completed', conclusion: 'success', pull_requests: [] };
  }
  const application = run(100, '.github/workflows/application-artifacts.yml', STAGE, 'staging');
  const materializer = run(120, '.github/workflows/application-artifacts.yml', MAIN, 'main');
  const tool = run(150, '.github/workflows/native-release-tool.yml', source, branch);
  const ci = run(50, '.github/workflows/ci.yml', DEV, 'dev', 'pull_request');
  const own = { ...run(200, WORKFLOW, MAIN, 'main', 'workflow_run'), status: 'in_progress', conclusion: null };
  for (const r of [application, materializer, tool, ci, own]) {
    data.set(`${prefix}/actions/runs/${r.id}`, r);
    data.set(`${prefix}/actions/runs/${r.id}/attempts/1`, r);
    const names = r.id === 100 ? ['scope', 'staging-build'] : r.id === 120 ? ['scope', 'main-materialize'] : r.id === 150 ? ['tool-package'] : r.id === 200 ? ['scope']
      : ['resolve', 'checks / ci', 'checks / warehouse', 'checks / e2e / e2e', 'checks / Build gate', 'Build gate'];
    data.set(`${prefix}/actions/runs/${r.id}/attempts/1/jobs?per_page=100&page=1`, { total_count: names.length,
      jobs: names.map((name, i) => ({ id: i + 1, name, run_id: r.id, run_attempt: 1, head_sha: r.head_sha, status: r.status, conclusion: r.conclusion })) });
  }
  data.set(prefix, { id: 41, full_name: REPOSITORY, fork: false, default_branch: 'main' });
  data.set(`${prefix}/branches/main`, { protected: true, commit: { sha: MAIN } });
  data.set(`${prefix}/branches/staging`, { protected: true, commit: { sha: STAGE } });
  for (const id of [MAIN, STAGE, DEV, BUILT]) data.set(`${prefix}/git/commits/${id}`, { sha: id, tree: { sha: TREE },
    parents: id === MAIN ? [{ sha: '2'.repeat(40) }, { sha: STAGE }] : id === STAGE ? [{ sha: '1'.repeat(40) }, { sha: DEV }] : [] });
  const promotion = (number: number, base: string, head: string, sha: string, merge: string) => ({ id: number + 1000, number, merged: true, state: 'closed', merge_commit_sha: merge,
    base: { ref: base, repo: { id: 41, full_name: REPOSITORY } }, head: { ref: head, sha, repo: { id: 41, full_name: REPOSITORY } } });
  const stagePr = promotion(8, 'staging', 'dev', DEV, STAGE), mainPr = promotion(9, 'main', 'staging', STAGE, MAIN);
  data.set(`${prefix}/pulls/8`, stagePr); data.set(`${prefix}/pulls/9`, mainPr);
  data.set(`${prefix}/pulls?state=closed&base=${branch}&per_page=100&page=1`, [branch === 'staging' ? stagePr : mainPr]);
  data.set(`${prefix}/compare/${STAGE}...${MAIN}`, { status: 'ahead', merge_base_commit: { sha: STAGE } });
  for (const name of [...PUBLISHER_FILES, 'pnpm-lock.yaml', 'packages/deploy/src/worker-template.ts']) {
    const b = readFileSync(new URL('../' + name, import.meta.url));
    data.set(`${prefix}/contents/${name}?ref=${STAGE}`, { type: 'file', path: name, encoding: 'base64', size: b.length,
      content: b.toString('base64'), sha: createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex') });
  }
  function artifact(r: ReturnType<typeof run>, id: number, name: string, member: string, value: unknown) {
    const b = zip(member, value);
    const metadata = { id, name, expired: false, size_in_bytes: b.length, digest: `sha256:${digest(b)}`,
      workflow_run: { id: r.id, repository_id: 41, head_repository_id: 41, head_branch: r.head_branch, head_sha: r.head_sha } };
    data.set(`${prefix}/actions/runs/${r.id}/artifacts?per_page=100&page=1`, { total_count: 1, artifacts: [metadata] });
    blobs.set(`${prefix}/actions/artifacts/${id}/zip`, b); return metadata;
  }
  const app = artifact(application, 91, 'attestrack-application-1', 'application.json', payload);
  artifact(tool, 92, 'native-release-tool-1', 'native-release-tool.json', toolValue());
  const receipt = { schema: 'attestrack.artifact-materialization/v1', repository: REPOSITORY, artifact_id: 91, producer_run: 100, producer_attempt: 1,
    archive_sha256: app.digest, inventory_sha256: payload.inventory_sha256 };
  artifact(materializer, 93, 'application-materialization-1', 'original-artifact.json', receipt);
  const activeApp = branch === 'staging' ? application : materializer;
  for (const [path, r] of [['application-artifacts.yml', activeApp], ['native-release-tool.yml', tool]] as const)
    data.set(`${prefix}/actions/workflows/${path}/runs?branch=${branch}&head_sha=${source}&event=push&per_page=100&page=1`, { total_count: 1, workflow_runs: [r] });
  const reader: GitHubRead = { json<T>(path: string): T {
    reads.push(path); if (!data.has(path)) throw new Error(`Unexpected fictional read ${path}`);
    return structuredClone(data.get(path)) as T;
  }, bytes(path: string) { reads.push(path); if (!blobs.has(path)) throw new Error('Unexpected fictional archive'); return Buffer.from(blobs.get(path)!); } };
  const p = profile();
  if (branch === 'main') p.production = { native: { ...structuredClone(native), environment: 'production' }, http: { ...http } };
  const event = { action: 'completed', repository: { id: 41, full_name: REPOSITORY }, workflow_run: { ...activeApp } };
  return { reader, data, blobs, reads, ctx, event, profile: p, witness: witness(), payload, receipt,
    result: () => admit(reader, ctx, event, p, witness()), artifact, application, materializer, tool };
}

test('native staged admission authenticates actual ZIP/source2/jobs/tool and outputs planned identity only', () => {
  const f = fixture(); const result = f.result();
  assert.equal(result.kind, 'planned'); assert.equal(result.branch, 'staging'); assert.equal(result.source_tree, TREE);
  assert.equal(result.artifact.artifact_id, 91); assert.equal(result.tool.artifact_id, 92); assert.equal(result.materialization, null);
  assert.ok(f.reads.includes(`${prefix}/actions/runs/50/attempts/1`));
  assert.equal('accepted' in result, false); assert.equal('credentials' in result, false);
});
test('native main admission preserves original staged bytes and exact historical attempts without rebuild', () => {
  const f = fixture('main');
  // A later source/compiler rerun cannot substitute its metadata for original1.
  f.data.set(`${prefix}/actions/runs/100`, { ...f.application, run_attempt: 2, conclusion: 'failure' });
  f.data.set(`${prefix}/actions/runs/50`, { run_attempt: 2, conclusion: 'failure' });
  const result = f.result(); assert.equal(result.artifact.producer_run, 100); assert.equal(result.artifact.producer_attempt, 1);
  assert.equal(result.materialization?.artifact_id, 93); assert.equal(result.source_commit, MAIN);
  assert.equal(result.artifact.archive_sha256, digest(f.blobs.get(`${prefix}/actions/artifacts/91/zip`)!));
  assert.equal(f.reads.includes(`${prefix}/actions/runs/100`), false);
  assert.equal(f.reads.includes(`${prefix}/actions/runs/50`), false);
});
test('either genuine producer completion wakes admission; absent or failed peer never creates a request', () => {
  const f = fixture(); f.event.workflow_run = { ...f.tool }; assert.equal(f.result().tool.run_id, 150);
  const path = `${prefix}/actions/workflows/application-artifacts.yml/runs?branch=staging&head_sha=${STAGE}&event=push&per_page=100&page=1`;
  f.data.set(path, { total_count: 0, workflow_runs: [] }); assert.throws(f.result, /peer producer/);
});
test('native repo/source/merge/attempt/job and complete listing substitutions are refused', () => {
  const changes: [string, (raw: unknown) => unknown][] = [
    [prefix, raw => ({ ...obj(raw), id: 42 })],
    [`${prefix}/branches/staging`, () => ({ protected: true, commit: { sha: DEV } })],
    [`${prefix}/actions/runs/200/attempts/1`, raw => ({ ...obj(raw), path: '.github/workflows/other.yml' })],
    [`${prefix}/actions/runs/100/attempts/1`, raw => ({ ...obj(raw), run_attempt: 2 })],
    [`${prefix}/actions/runs/150/attempts/1`, raw => ({ ...obj(raw), head_sha: DEV })],
    [`${prefix}/pulls/8`, raw => ({ ...obj(raw), merged: false })],
    [`${prefix}/git/commits/${DEV}`, raw => ({ ...obj(raw), tree: { sha: 'c'.repeat(40) } })],
    [`${prefix}/actions/runs/50/attempts/1/jobs?per_page=100&page=1`, raw => ({ ...obj(raw), total_count: 100 })],
    [`${prefix}/actions/runs/100/artifacts?per_page=100&page=1`, raw => ({ ...obj(raw), total_count: 2 })],
    [`${prefix}/actions/runs/150/attempts/1/jobs?per_page=100&page=1`, raw => ({ ...obj(raw), jobs: [ { ...obj((obj(raw).jobs as unknown[])[0]), conclusion: 'skipped' } ] })],
  ];
  for (const [path, mutation] of changes) {
    const f = fixture(); f.data.set(path, mutation(f.data.get(path))); assert.throws(f.result, Error, path);
  }
});
test('native original ZIP tamper and valid-ZIP false tool closure cannot pass admission', () => {
  for (const id of [91, 92]) { const f = fixture(); f.blobs.set(`${prefix}/actions/artifacts/${id}/zip`, Buffer.from('tampered')); assert.throws(f.result, /digest mismatch/); }
  const f = fixture(); const wrong = toolValue(); wrong.files.LICENSE = Buffer.from('false package').toString('base64');
  f.artifact(f.tool, 92, 'native-release-tool-1', 'native-release-tool.json', wrong);
  assert.throws(f.result, /identity mismatch/);
});
test('main receipt altered digest/attempt/array identity or unrelated prior ancestry is refused', () => {
  for (const patch of [{ archive_sha256: 'sha256:' + '1'.repeat(64) }, { producer_attempt: [1] }, { producer_attempt: '1' }, { artifact_id: [91] }, { inventory_sha256: '1'.repeat(64) }]) {
    const f = fixture('main'); f.artifact(f.materializer, 93, 'application-materialization-1', 'original-artifact.json', { ...f.receipt, ...patch });
    assert.throws(f.result);
  }
  const f = fixture('main'); f.data.set(`${prefix}/compare/${STAGE}...${MAIN}`, { status: ['ahead'], merge_base_commit: { sha: STAGE } });
  assert.throws(f.result, /ancestry/);
});

test('real CLI checks actual clean Git source and fixed scratch output with only native readonly fake gh', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'attestrack-admission-cli-'));
  try {
    const checkout = join(temporary, 'checkout'), scratch = join(temporary, 'runner'), bin = join(temporary, 'bin');
    mkdirSync(checkout); mkdirSync(scratch); mkdirSync(bin);
    const files = ['scripts/application-release-scope.ts', 'scripts/native-application-release.ts', 'scripts/native-application-operation.ts', 'scripts/native-release-tool.ts',
      'scripts/application-artifacts.ts', 'scripts/application-witness.ts', '.github/actions/retained-build/retained-build.ts',
      'packages/deploy/src/worker-template.ts', 'release/application-publishers.json', WORKFLOW];
    for (const name of files) { const path = join(checkout, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, readFileSync(new URL('../' + name, import.meta.url))); }
    const f = fixture();
    writeFileSync(join(checkout, PROFILE), JSON.stringify(f.profile));
    writeFileSync(join(checkout, 'release/application-targets.json'), JSON.stringify(f.witness));
    const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-C', checkout, ...args], { timeout: 10000 }).toString().trim();
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'source-fixture'); git('config', 'user.email', 'source@example.invalid');
    git('add', '.'); git('commit', '-q', '-m', 'fictional protected source');
    const head = git('rev-parse', 'HEAD'); f.ctx.workflow_commit = head;
    f.data.set(`${prefix}/branches/main`, { protected: true, commit: { sha: head } });
    for (const name of [`${prefix}/actions/runs/200`, `${prefix}/actions/runs/200/attempts/1`]) f.data.set(name, { ...obj(f.data.get(name)), head_sha: head });
    const jobsPath = `${prefix}/actions/runs/200/attempts/1/jobs?per_page=100&page=1`;
    f.data.set(jobsPath, { total_count: 1, jobs: (obj(f.data.get(jobsPath)).jobs as unknown[]).map(j => ({ ...obj(j), head_sha: head })) });
    const expected = f.result(), metadata = join(temporary, 'native.json'), marker = join(temporary, 'gh-called');
    writeFileSync(metadata, JSON.stringify({ data: Object.fromEntries(f.data), bytes: Object.fromEntries([...f.blobs].map(([p, b]) => [p, b.toString('base64')])) }));
    const fake = join(bin, 'gh');
    writeFileSync(fake, `#!/usr/bin/python3 -I\nimport sys,json,base64\nfrom pathlib import Path\nassert len(sys.argv)==3 and sys.argv[1]=='api'\nPath(${JSON.stringify(marker)}).write_text('called')\nd=json.loads(Path(${JSON.stringify(metadata)}).read_text());p=sys.argv[2]\nif p in d['bytes']:sys.stdout.buffer.write(base64.b64decode(d['bytes'][p]))\nelse:print(json.dumps(d['data'][p]))\n`, { mode: 0o700 });
    const event = join(scratch, 'event.json'), output = join(scratch, 'output');
    writeFileSync(event, JSON.stringify(f.event)); writeFileSync(output, '');
    const env = { ...environment(), GITHUB_SHA: head, GITHUB_WORKFLOW_SHA: head,
      PATH: bin + ':/usr/bin:/bin', HOME: temporary, GH_TOKEN: 'fictional-job-readonly', RUNNER_TEMP: scratch,
      GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output };
    const invoke = (environment: NodeJS.ProcessEnv) => spawnSync(process.execPath, [join(checkout, 'scripts/application-release-scope.ts')],
      { env: environment, cwd: checkout, timeout: 30000, encoding: 'utf8' });
    const result = invoke(env); assert.equal(result.status, 0, result.stderr);
    const file = join(scratch, 'attestrack-release-scope/application-release-request.json'), raw = readFileSync(file);
    assert.deepEqual(JSON.parse(raw.toString()), expected);
    assert.ok(readFileSync(output, 'utf8').includes(`request-sha256=${digest(raw)}`));
    assert.equal(git('status', '--porcelain'), '');
    rmSync(marker); const previousOutput = readFileSync(output, 'utf8');
    const denied = invoke({ ...env, GITHUB_HEAD_REF: 'foreign-feature' }); assert.equal(denied.status, 1);
    assert.equal(existsSync(marker), false); assert.equal(readFileSync(output, 'utf8'), previousOutput);
    assert.doesNotMatch(denied.stderr + denied.stdout, /fictional-job-readonly/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('current normal source merge may retain genuinely verified older Source2 CI for the exact same tree', () => {
  const f = fixture(), newer = '3'.repeat(40);
  f.data.set(`${prefix}/git/commits/${STAGE}`, { sha: STAGE, tree: { sha: TREE }, parents: [{ sha: '1'.repeat(40) }, { sha: newer }] });
  f.data.set(`${prefix}/git/commits/${newer}`, { sha: newer, tree: { sha: TREE }, parents: [] });
  const old = obj(f.data.get(`${prefix}/pulls/8`)), current = { ...old, id: 1010, number: 10, head: { ...obj(old.head), sha: newer } };
  f.data.set(`${prefix}/pulls/10`, current);
  f.data.set(`${prefix}/pulls?state=closed&base=staging&per_page=100&page=1`, [current]);
  assert.equal(f.result().promotion_pr, 10);
});
test('valid signed-producer ZIP with wrong source-CI branch/kind/attempt cannot replace actual retained source proof', () => {
  for (const change of [{ schema: 1 }, { run_attempt: [1] }, { pull_request: { ...fixture().payload.source.pull_request!, base_ref: 'dev' } }]) {
    const f = fixture(); const payload = { ...f.payload, source: { ...f.payload.source, ...change } };
    f.artifact(f.application, 91, 'attestrack-application-1', 'application.json', payload);
    assert.throws(f.result);
  }
  const f = fixture(); const path = `${prefix}/actions/runs/50/attempts/1`;
  f.data.set(path, { ...obj(f.data.get(path)), event: 'push', head_branch: 'dev' }); assert.throws(f.result, /Untrusted|staging/);
});

test('native source/protected-main bookends refuse drift after original archive admission', () => {
  for (const branch of ['main', 'staging']) {
    const f = fixture(), original = f.reader.json.bind(f.reader); let seen = 0;
    f.reader.json = function<T>(path: string): T {
      if (path === `${prefix}/branches/${branch}` && ++seen > 1) return { protected: true, commit: { sha: '4'.repeat(40) } } as T;
      return original<T>(path);
    };
    assert.throws(f.result, /binding differs/);
  }
});
test('native expiration must be positively false and required source jobs may not be skipped', () => {
  for (const id of [100, 150]) {
    const f = fixture(), path = `${prefix}/actions/runs/${id}/artifacts?per_page=100&page=1`;
    const row = obj(f.data.get(path)), artifacts = row.artifacts as unknown[];
    f.data.set(path, { ...row, artifacts: artifacts.map(a => ({ ...obj(a), expired: null })) });
    assert.throws(f.result, /expiration/);
  }
  const f = fixture(), path = `${prefix}/actions/runs/50/attempts/1/jobs?per_page=100&page=1`, row = obj(f.data.get(path));
  f.data.set(path, { ...row, jobs: (row.jobs as unknown[]).map(j => obj(j).name === 'Build gate' ? { ...obj(j), conclusion: 'skipped' } : j) });
  assert.throws(f.result, /Unsuccessful/);
});
