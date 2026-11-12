import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildWorkerEntry } from '../packages/deploy/src/worker-template.ts';
import { bundleEntry, collect, digest, fileBytes, inventory, materialize, publisherIdentity, readSingleZip, REPOSITORY, validateContent, validatePayload, verifiedDocument, WORKFLOW, type Payload } from './application-artifacts.ts';
import type { NativeArtifact, Run } from '../.github/actions/retained-build/retained-build.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = 'a'.repeat(40), tree = 'b'.repeat(40);
const run: Run = { id: 100, run_attempt: 1, head_sha: sha, head_branch: 'staging', head_repository: { full_name: REPOSITORY }, path: `.github/workflows/${WORKFLOW}`, event: 'push', status: 'completed', conclusion: 'success', pull_requests: [] };
function payload(): Payload {
  const files = [fileBytes('worker/index.js', Buffer.from('export default { fetch() { return new Response("fictional"); } };')),
    fileBytes('portal/index.html', Buffer.from('<head><meta name="attestrack-portal-api" content="same-origin" /></head>')),
    fileBytes('portal/.assetsignore', Buffer.from('fictional-hidden\n')), fileBytes('schema/clickhouse.sql', Buffer.from('-- fictional schema\n'))].sort((a, b) => a.path < b.path ? -1 : 1);
  return { schema: 'attestrack.application-bytes/v1', repository: REPOSITORY, repository_id: 41,
    producer: { run_id: 100, run_attempt: 1, source_sha: sha, tree, workflow: WORKFLOW },
    source: { schema: 2, repository: REPOSITORY, workflow: 'ci.yml', run_id: 50, run_attempt: 1, head_sha: sha, built_sha: sha, tree,
      pull_request: { number: 7, base_ref: 'staging', base_repo_id: 41, head_repo_id: 41, head_ref: 'dev', head_sha: sha } },
    build: { node: 'v24.21.0', pnpm: '9.0.0', esbuild: '0.28.2', lock_sha256: digest(readFileSync(join(root, 'pnpm-lock.yaml'))), entry_sha256: digest(buildWorkerEntry()), compatibility_date: '2024-12-01' }, files, inventory_sha256: inventory(files) };
}
function zip(name: string, content: Buffer, extra = false): Buffer {
  return execFileSync('python3', ['-c', 'import sys,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n z.writestr(sys.argv[1],sys.stdin.buffer.read())\n if sys.argv[2]=="yes": z.writestr("unexpected",b"x")\nsys.stdout.buffer.write(b.getvalue())', name, extra ? 'yes' : 'no'], { input: content });
}
function artifact(bytes: Buffer): NativeArtifact {
  return { id: 91, name: 'attestrack-application-1', expired: false, size_in_bytes: bytes.length, digest: `sha256:${digest(bytes)}`,
    workflow_run: { id: run.id, repository_id: 41, head_repository_id: 41, head_branch: 'staging', head_sha: sha } };
}
test('v2 retains generated entry/template/recipe identity without weakening same-tree v1 checks', () => {
  const p = payload(); p.schema = 'attestrack.application-bytes/v2';
  p.files.push(fileBytes('worker/entry.ts', Buffer.from(buildWorkerEntry()))); p.files.sort((a, b) => a.path < b.path ? -1 : 1); p.inventory_sha256 = inventory(p.files);
  p.build.template_sha256 = digest(readFileSync(join(root, 'packages/deploy/src/worker-template.ts'))); p.build.publisher_sha256 = publisherIdentity(path => readFileSync(join(root, path))).sha256;
  validatePayload(p, run, 41, tree);
  for (const mutate of [(p: Payload) => { p.files = p.files.filter(f => f.path !== 'worker/entry.ts'); p.inventory_sha256 = inventory(p.files); },
    (p: Payload) => { p.build.entry_sha256 = '0'.repeat(64); }, (p: Payload) => { p.build.template_sha256 = '0'.repeat(64); },
    (p: Payload) => { p.build.publisher_sha256 = '0'.repeat(64); }]) { const copy = structuredClone(p); mutate(copy); assert.throws(() => validatePayload(copy, run, 41, tree)); }
});
test('actual esbuild compiles exactly captured retained entry buffer despite later caller mutation', async () => {
  const esbuild = await import('esbuild'), original = Buffer.from('export default {fetch(){return new Response("captured-entry")}}');
  const expected = Buffer.from(original);
  const result = await bundleEntry(original, { build(options) { original.fill(0); return esbuild.build(options); } });
  assert.deepEqual(result.entry, expected); assert.notDeepEqual(result.entry, original);
  const worker = await import('data:text/javascript;base64,' + result.bundle.toString('base64'));
  assert.equal(await worker.default.fetch().text(), 'captured-entry');
});
test('actual ZIP parser child excludes inherited provider/GitHub/OPV and Python injection environment', () => {
  const bytes = zip('phase.json', Buffer.from('{"source_only":true}'));
  const dir = mkdtempSync(join(tmpdir(), 'attestrack-zip-child-env-'));
  const saved = Object.fromEntries(['PATH', 'CLOUDFLARE_DEPLOY_TOKEN', 'GH_TOKEN', 'OP_SERVICE_ACCOUNT_TOKEN', 'PYTHONPATH'].map(k => [k, process.env[k]]));
  try {
    const python = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim();
    writeFileSync(join(dir, 'python3'), `#!${process.execPath}\nfor(const name of ['CLOUDFLARE_DEPLOY_TOKEN','GH_TOKEN','OP_SERVICE_ACCOUNT_TOKEN','PYTHONPATH'])if(name in process.env)throw Error('unexpected inherited authority');const c=require('child_process').spawnSync(${JSON.stringify(python)},process.argv.slice(2),{input:require('fs').readFileSync(0),env:process.env});process.stdout.write(c.stdout);process.exit(c.status??99);\n`, { mode: 0o755 });
    process.env.PATH = dir;
    for (const key of ['CLOUDFLARE_DEPLOY_TOKEN', 'GH_TOKEN', 'OP_SERVICE_ACCOUNT_TOKEN', 'PYTHONPATH']) process.env[key] = 'fictional-should-never-enter-parser';
    assert.deepEqual(readSingleZip(bytes, 'phase.json'), { source_only: true });
  } finally {
    for (const [k, value] of Object.entries(saved)) { if (value === undefined) delete process.env[k]; else process.env[k] = value; }
    rmSync(dir, { recursive: true, force: true });
  }
});
test('actual ZIP plus exact manifest materializes all original bytes including hidden assets', () => {
  const p = payload(), bytes = zip('application.json', Buffer.from(JSON.stringify(p))), dir = mkdtempSync(join(tmpdir(), 'attestrack-roundtrip-'));
  try {
    const decoded = verifiedDocument(artifact(bytes), run, 41, 'attestrack-application-1', bytes, 'application.json');
    const checked = validatePayload(decoded, run, 41, tree); const out = join(dir, 'out'); materialize(checked, out);
    for (const f of checked.files) assert.equal(digest(readFileSync(join(out, f.path))), f.sha256);
    assert.equal(readFileSync(join(out, 'portal/.assetsignore'), 'utf8'), 'fictional-hidden\n');
    assert.throws(() => materialize(checked, out), /fresh/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('native digest is checked before attempting ZIP interpretation; bounded inventory refuses extras', () => {
  const bytes = Buffer.from('not ZIP');
  assert.throws(() => verifiedDocument({ ...artifact(bytes), digest: 'sha256:' + '0'.repeat(64) }, run, 41, 'attestrack-application-1', bytes, 'application.json'), /Native artifact/);
  for (const name of ['../application.json', '/application.json', 'nested/application.json']) {
    const b = zip(name, Buffer.from('{}'));
    assert.throws(() => verifiedDocument(artifact(b), run, 41, 'attestrack-application-1', b, 'application.json'));
  }
  const b = zip('application.json', Buffer.from('{}'), true);
  assert.throws(() => verifiedDocument(artifact(b), run, 41, 'attestrack-application-1', b, 'application.json'));
});
test('manifest refuses altered bytes, omitted/duplicate paths, traversal, config, pins and origin drift', () => {
  const changes: ((p: Payload) => void)[] = [p => { p.files[0].base64 = Buffer.from('altered').toString('base64'); },
    p => { p.files.pop(); }, p => { p.files.push(p.files[0]); }, p => { p.files[0].path = 'portal/../../escape'; },
    p => { p.files[0].path = 'portal/.env'; }, p => { p.inventory_sha256 = '0'.repeat(64); },
    p => { p.build.lock_sha256 = '0'.repeat(64); }, p => { p.build.entry_sha256 = '0'.repeat(64); },
    p => { p.producer.run_attempt = 2; }, p => { p.producer.source_sha = 'c'.repeat(40); },
    p => { p.producer.tree = 'c'.repeat(40); }, p => { p.repository_id = 42; },
    p => { const f = p.files.find(f => f.path === 'portal/index.html')!; Object.assign(f, fileBytes(f.path, Buffer.from('<head/>'))); p.inventory_sha256 = inventory(p.files); }];
  for (const change of changes) { const p = payload(); change(p); assert.throws(() => validatePayload(p, run, 41, tree)); }
  for (const patch of [{ head_branch: 'main' }, { run_attempt: 2 }, { event: 'pull_request' }, { conclusion: 'failure' }, { status: 'in_progress' }]) assert.throws(() => validatePayload(payload(), { ...run, ...patch }, 41, tree));
  assert.throws(() => validateContent({ ...payload(), accepted: true }), /closed/);
});
test('real build-output collector includes hidden files and refuses symlinks before reading them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attestrack-collect-'));
  try {
    writeFileSync(join(dir, '.assetsignore'), 'hidden'); assert.equal(collect(dir, 'portal')[0].path, 'portal/.assetsignore');
    symlinkSync('/not-a-real-key-file', join(dir, 'link')); assert.throws(() => collect(dir, 'portal'), /Non-regular/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual main CLI selects original staged ZIP from history over1000 runs; no rebuild child', () => {
  const temp = mkdtempSync(join(tmpdir(), 'attestrack-main-cli-')); const repo = join(temp, 'repo'), bin = join(temp, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  try {
    for (const file of ['scripts/application-artifacts.ts', '.github/actions/retained-build/retained-build.ts', 'packages/deploy/src/worker-template.ts', 'pnpm-lock.yaml']) {
      mkdirSync(dirname(join(repo, file)), { recursive: true }); cpSync(join(root, file), join(repo, file));
    }
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 'Fictional', GIT_AUTHOR_EMAIL: 'fictional@example.test', GIT_COMMITTER_NAME: 'Fictional', GIT_COMMITTER_EMAIL: 'fictional@example.test' } }).toString().trim();
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fictional source');
    const head = git('rev-parse', 'HEAD'), nativeTree = git('rev-parse', 'HEAD^{tree}');
    const staged = { ...run, head_sha: head }; const current = { ...staged, id: 200, head_branch: 'main', status: 'in_progress', conclusion: '' };
    const sourceRun = { ...staged, id: 50, path: '.github/workflows/ci.yml', head_branch: 'dev', event: 'pull_request' };
    const p = payload(); p.producer.source_sha = head; p.producer.tree = nativeTree;
    p.source.head_sha = head; p.source.built_sha = head; p.source.tree = nativeTree; p.source.pull_request!.head_sha = head;
    const bytes = zip('application.json', Buffer.from(JSON.stringify(p))), a = artifact(bytes); a.workflow_run.head_sha = head;
    const fixture = { head, nativeTree, staged, current, sourceRun, artifact: a, historyTotal: 1001, zip: bytes.toString('base64') }; writeFileSync(join(temp, 'native.json'), JSON.stringify(fixture));
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst fs=require('fs');const f=JSON.parse(fs.readFileSync(${JSON.stringify(join(temp, 'native.json'))}));const p=process.argv[3];let r;\n` +
      `if(p.endsWith('/attestrack'))r={id:41};else if(p.includes('/branches/main'))r={protected:f.protected??true,commit:{sha:f.head}};else if(p.includes('/git/commits/'))r={tree:{sha:f.nativeTree}};\n` +
      `else if(p.includes('/workflows/')){if(p.includes('status='))throw Error('Filtered discovery forbidden');r={total_count:f.historyTotal,workflow_runs:[{...f.staged,...(f.noCandidate?{conclusion:'failure'}:{})},...Array.from({length:99},(_,i)=>({...f.staged,id:1000+i,conclusion:'failure'}))]};}else if(p.includes('/attempts/')){const s=p.includes('/50/');const run=s?f.sourceRun:f.staged;const names=s?['resolve','checks / ci','checks / warehouse','checks / e2e / e2e','checks / Build gate','Build gate']:['scope','staging-build'];r={total_count:names.length,jobs:names.map((name,i)=>({id:i+1,name,run_id:run.id,run_attempt:1,head_sha:f.head,status:'completed',conclusion:'success',...f.jobPatch}))};}\n` +
      `else if(p.includes('/artifacts/91/zip')){process.stdout.write(Buffer.from(f.zip,'base64'));process.exit(0);}else if(p.includes('/100/artifacts'))r={total_count:1,artifacts:[f.artifact]};\n` +
      `else if(p.endsWith('/runs/200'))r=f.current;else if(p.endsWith('/runs/50'))r=f.sourceRun;else if(p.includes('/pulls/7'))r={number:7,base:{ref:'staging',repo:{id:41,full_name:${JSON.stringify(REPOSITORY)}}},head:{ref:'dev',sha:f.head,repo:{id:41,full_name:${JSON.stringify(REPOSITORY)}}}};else throw Error('Unexpected native read '+p);process.stdout.write(JSON.stringify(r));\n`, { mode: 0o755 });
    const forbidden = join(temp, 'forbidden');
    for (const name of ['pnpm', 'npm', 'npx', 'esbuild']) writeFileSync(join(bin, name), `#!/bin/sh\necho forbidden >> '${forbidden}'\nexit 97\n`, { mode: 0o755 });
    const invoke = (mode = 'materialize') => spawnSync(process.execPath, [join(repo, 'scripts/application-artifacts.ts'), mode], { cwd: repo,
      env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: temp, RUNNER_TEMP: temp, GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: '41', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head, GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '1' }, encoding: 'utf8', timeout: 30000 });
    const result = invoke();
    assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(forbidden), false);
    const out = join(temp, 'attestrack-application');
    for (const file of p.files) assert.equal(digest(readFileSync(join(out, file.path))), file.sha256);
    const receipt = JSON.parse(readFileSync(join(out, 'original-artifact.json'), 'utf8'));
    assert.equal(receipt.artifact_id, 91); assert.equal(receipt.producer_run, 100); assert.equal(receipt.producer_attempt, 1); assert.equal(receipt.archive_sha256, a.digest);
    rmSync(out, { recursive: true });
    for (const patch of [{ noCandidate: true }, { protected: false }, { protected: 'false' }, { jobPatch: { run_attempt: 2 } },
      { jobPatch: { conclusion: 'skipped' } }, { artifact: { ...a, digest: 'sha256:' + '0'.repeat(64) } },
      { artifact: { ...a, workflow_run: { ...a.workflow_run, repository_id: 42 } } }]) {
      writeFileSync(join(temp, 'native.json'), JSON.stringify({ ...fixture, ...patch }));
      const refused = invoke(); assert.notEqual(refused.status, 0); assert.equal(existsSync(out), false); assert.equal(existsSync(forbidden), false);
    }
    writeFileSync(join(temp, 'native.json'), JSON.stringify(fixture));
    assert.notEqual(invoke('build').status, 0); assert.equal(existsSync(forbidden), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('importing retained source and artifact helpers runs no admission or child command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attestrack-import-only-'));
  try {
    const marker = join(dir, 'child');
    for (const name of ['gh', 'git', 'pnpm', 'npm', 'npx', 'python3']) writeFileSync(join(dir, name), `#!/bin/sh\necho unexpected >> '${marker}'\nexit 97\n`, { mode: 0o755 });
    const modules = ['../.github/actions/retained-build/retained-build.ts', './application-artifacts.ts'].map(p => new URL(p, import.meta.url).href);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `for (const url of ${JSON.stringify(modules)}) await import(url);`],
      { cwd: dir, env: { PATH: dir, HOME: dir }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(marker), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
