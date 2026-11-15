import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkerEntry } from '../packages/deploy/src/worker-template.ts';
import { digest, fileBytes, inventory, publisherIdentity, REPOSITORY, type Payload } from './application-artifacts.ts';
import { inspect } from './application-witness.ts';
import { canonical, Cloudflare, NativeGitHub, NativeWriter, pagesConfiguration, readOriginal, targetIdentity, validateTarget, workerConfiguration,
  type Bundle, type GitHubRead, type Journal, type NativeHTTP, type Target } from './native-application-release.ts';
import { loadTool } from './native-release-tool.ts';
import { upstreamTool } from './native-release-tool.test.ts';
import { prepareOperation, claimOperation, unknownOperation, execution, recordAcknowledgement, validateJournal } from './native-application-operation.ts';
import { NativeOperationCoordinator, coordinatorIntent, acknowledgementName, operationJobName,
  type CoordinatorRecord, type CoordinatorStore, type Slot } from './native-application-coordinator.ts';
import type { PlannedRequest } from './application-release-scope.ts';
import { JOB_FENCE_DIRECTORY, JOB_FENCE_FILE, reserveOriginalJob } from './native-application-job-fence.ts';
import type { AuthenticatedJournalReader, Executor, Frame } from './native-application-operation.ts';
import { observePredecessor, preparePhase, readbackPhase, readOnlyNative, executePhaseOperation } from './native-session-jobs.ts';
import { NativeIntakeReader, intakeContext } from './native-intake-reader.ts';
import type { SessionDescriptor, SessionContext } from './native-release-session.ts';
import { NativeJournalProjectionReader, ISSUER_JOBS, ISSUER_WORKFLOW } from './native-journal-projection-reader.ts';
import { INFRA, INFRA_ID, JOURNAL_STORES } from './native-journal-projection.ts';
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const W = id(1), P = id(2), C = id(3), DP = id(4), DC = id(5), PG = id(6), PP = id(7), PC = id(8);
const source = 'a'.repeat(40), tree = 'b'.repeat(40);
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function input(): Payload {
  const files = [fileBytes('worker/index.js', Buffer.from('export default { fetch(){return new Response("retained")} };')), fileBytes('worker/entry.ts', Buffer.from(buildWorkerEntry())),
    fileBytes('portal/index.html', Buffer.from('<head><meta name="attestrack-portal-api" content="same-origin" /></head>')),
    fileBytes('portal/assets/page.js', Buffer.from('console.log("retained portal");')),
    fileBytes('schema/clickhouse.sql', Buffer.from('-- untouched warehouse'))].sort((a, b) => a.path.localeCompare(b.path));
  return { schema: 'attestrack.application-bytes/v2', repository: REPOSITORY, repository_id: 41,
    producer: { run_id: 100, run_attempt: 1, source_sha: source, tree, workflow: 'application-artifacts.yml' },
    source: { schema: 2, repository: REPOSITORY, workflow: 'ci.yml', run_id: 50, run_attempt: 1, head_sha: source, built_sha: source, tree,
      pull_request: { number: 7, base_ref: 'staging', base_repo_id: 41, head_repo_id: 41, head_ref: 'dev', head_sha: source } },
    build: { node: 'v24.21.0', pnpm: '9.0.0', esbuild: '0.28.2', lock_sha256: digest(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url))),
      entry_sha256: digest(buildWorkerEntry()), compatibility_date: '2024-12-01', template_sha256: digest(readFileSync(new URL('../packages/deploy/src/worker-template.ts', import.meta.url))),
      publisher_sha256: publisherIdentity(path => readFileSync(new URL('../' + path, import.meta.url))).sha256 }, files, inventory_sha256: inventory(files) };
}
function nativeInput(payload = input(), originalFiles: Record<string, Buffer> = {}) {
  const bytes = execFileSync('python3', ['-c', 'import sys,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:z.writestr("application.json",sys.stdin.buffer.read())\nsys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(payload) });
  const staged = { id: 100, run_attempt: 1, head_sha: source, head_branch: 'staging', head_repository: { full_name: REPOSITORY }, event: 'push', path: '.github/workflows/application-artifacts.yml', status: 'completed', conclusion: 'success', pull_requests: [] };
  const sourceRun = { ...staged, id: 50, head_branch: 'dev', event: 'pull_request', path: '.github/workflows/ci.yml' };
  const artifact = { id: 91, name: 'attestrack-application-1', expired: false, size_in_bytes: bytes.length, digest: `sha256:${digest(bytes)}`,
    workflow_run: { id: 100, repository_id: 41, head_repository_id: 41, head_branch: 'staging', head_sha: source } };
  const patch: Record<string, unknown> = {};
  const reader: GitHubRead = {
    bytes() { return bytes; },
    json<T>(path: string): T {
      let v: unknown;
      if (path.includes('/contents/')) {
        const name = path.split('/contents/')[1].split('?')[0], bytes = originalFiles[name] ?? readFileSync(new URL('../' + name, import.meta.url));
        v = { type: 'file', path: name, size: bytes.length, encoding: 'base64', content: bytes.toString('base64'),
          sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), ...objectPatch('blob') };
      } else if (path === `repos/${REPOSITORY}`) v = { id: 41 };
      else if (path.includes('/attempts/')) {
        const run = path.includes('/50/') ? sourceRun : staged;
        const names = run.id === 50 ? ['resolve', 'checks / ci', 'checks / warehouse', 'checks / e2e / e2e', 'checks / Build gate', 'Build gate'] : ['scope', 'staging-build'];
        v = { total_count: names.length, jobs: names.map((name, i) => ({ id: i + 1, name, run_id: run.id, run_attempt: 1, head_sha: source, status: 'completed', conclusion: 'success', ...objectPatch('job') })) };
      } else if (path.includes('/100/artifacts')) v = { total_count: 1, artifacts: [{ ...artifact, ...objectPatch('artifact') }] };
      else if (path.endsWith('/runs/100')) v = { ...staged, ...objectPatch('run') };
      else if (path.endsWith('/runs/50')) v = sourceRun;
      else if (path.includes('/git/commits/')) v = { tree: { sha: patch.tree ?? tree } };
      else if (path.endsWith('/pulls/7')) v = { number: 7, base: { ref: 'staging', repo: { id: 41, full_name: REPOSITORY } }, head: { ref: 'dev', sha: source, repo: { id: 41, full_name: REPOSITORY } } };
      else throw new Error(`Unexpected read ${path}`);
      return v as T;
    },
  };
  function objectPatch(k: string) { return (patch[k] ?? {}) as Record<string, unknown>; }
  return { reader, patch, bundle: () => readOriginal(reader, 100, 91, tree) };
}
class FictionalCloudflare implements NativeHTTP {
  calls: { path: string; init: RequestInit; jwt?: string }[] = [];
  latest = P; active = P; deployment = DP; pages = PP; pagesMarker: string | undefined; deploymentMarker: string | undefined; failPages = false; corruptModule = false;
  worker: Record<string, unknown> = { id: W, name: 'fictional-worker', logpush: false, observability: {}, tags: [], tail_consumers: [], subdomain: {}, references: {} };
  bindings = [{ name: 'ATTESTRACK_KV', type: 'kv_namespace', namespace_id: 'c'.repeat(32) }, { name: 'CONSENT_TOKEN_SECRET', type: 'secret_text' }, { name: 'SITE_ID', type: 'plain_text', text: 'fictional-site' }];
  project: Record<string, unknown> = { id: PG, name: 'fictional-portal', production_branch: 'main', source: null, build_config: {}, deployment_configs: { production: {}, preview: {} }, domains: [] };
  versions = new Map([[P, { id: P, number: 1, main_module: 'index.js', compatibility_date: '2024-12-01', compatibility_flags: [], bindings: this.bindings,
    modules: [{ name: 'index.js', content_type: 'application/javascript+module', content_base64: Buffer.from('previous').toString('base64') }] }]]);
  before: ((path: string, init: RequestInit) => void) | null = null;
  inventoryPatch: Record<string, unknown> = {};
  target(): Target { return { environment: 'staging', account_id: 'd'.repeat(32), worker: { id: W, name: 'fictional-worker', bindings: this.bindings as Target['worker']['bindings'], configuration_sha256: workerConfiguration(this.worker) },
    pages: { id: PG, name: 'fictional-portal', production_branch: 'main', configuration_sha256: pagesConfiguration(this.project) } }; }
  async request(path: string, init: RequestInit = {}, jwt?: string): Promise<unknown> {
    this.calls.push({ path, init, jwt }); this.before?.(path, init);
    if (path.endsWith(`/workers/workers/${W}`)) return structuredClone(this.worker);
    if (path.endsWith('/versions?per_page=1&page=1')) return { items: [{ id: this.latest }] };
    if (path.endsWith('/versions?deploy=false')) {
      const body = JSON.parse(init.body as string);
      assert.equal(body.bindings.find((b: { name: string }) => b.name === 'CONSENT_TOKEN_SECRET').version_id, P);
      const modules = this.corruptModule ? [{ ...body.modules[0], content_base64: Buffer.from('wrong').toString('base64') }] : body.modules;
      this.versions.set(C, { ...body, bindings: this.bindings, id: C, number: 2, modules }); this.latest = C;
      return { id: C };
    }
    if (/\/versions\/.+\?include=modules$/.test(path)) return structuredClone(this.versions.get(path.split('/').at(-1)!.split('?')[0]));
    if (path.endsWith('/deployments') && path.includes('/workers/')) {
      if (init.method === 'POST') { this.active = C; this.deployment = DC; this.deploymentMarker = JSON.parse(init.body as string).annotations['workers/message']; return { id: DC }; }
      return { deployments: [{ id: this.deployment, annotations: { 'workers/message': this.deploymentMarker }, versions: [{ version_id: this.active, percentage: 100 }] }] };
    }
    if (path.endsWith('/pages/projects/fictional-portal')) return { ...structuredClone(this.project), canonical_deployment: { id: this.pages } };
    if (path.endsWith('/upload-token')) return { jwt: 'fictional-assets-token' };
    if (path.startsWith('/pages/assets/')) { assert.equal(jwt, 'fictional-assets-token'); return {}; }
    if (path.endsWith('/fictional-portal/deployments') && init.method === 'POST') {
      if (this.failPages) throw new Error('Fictional Pages ambiguous dispatch');
      assert.ok(init.body instanceof FormData); assert.equal(init.body.get('commit_hash'), source);
      this.pages = PC; this.pagesMarker = String(init.body.get('commit_message')); return { id: PC };
    }
    if (path.includes('/fictional-portal/deployments/')) return { id: path.split('/').at(-1), project_id: PG, project_name: 'fictional-portal', environment: 'production', is_skipped: false,
      latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { branch: 'main', commit_hash: source, commit_message: path.split('/').at(-1) === PC ? this.pagesMarker : undefined } } };
    throw new Error(`Unrecognized fictional native endpoint ${path}`);
  }
  async page(path: string) {
    let items: unknown[];
    if (path.includes('/workers/workers/')) items = [...this.versions.values()];
    else items = await Promise.all([PP, ...(this.pages === PC ? [PC] : [])].map(id => this.request(`/accounts/${'d'.repeat(32)}/pages/projects/fictional-portal/deployments/${id}`)));
    return { items: structuredClone(items), info: { page: 1, per_page: 25, count: items.length, total_count: items.length, total_pages: 1, ...this.inventoryPatch } };
  }
  writes() { return this.calls.filter(c => c.init.method === 'POST'); }
}
async function withRuntime(fn: (runtime: ReturnType<typeof loadTool>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'attestrack-native-writer-'));
  try { await fn(loadTool(upstreamTool(), join(dir, 'tool'))); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('original artifact admission verifies actual ZIP/source2 and rejects native attempt/tree/expired/job defects', () => {
  const f = nativeInput(); assert.equal(f.bundle().identity.artifact_id, 91);
  assert.match(f.bundle().identity.archive_sha256, /^[a-f0-9]{64}$/);
  for (const p of [{ run: { run_attempt: 2 } }, { tree: 'e'.repeat(40) }, { artifact: { expired: true } },
    { artifact: { digest: 'sha256:' + '0'.repeat(64) } }, { job: { conclusion: 'skipped' } }, { job: { run_attempt: 2 } }, { blob: { sha: '0'.repeat(40) } }]) {
    Object.assign(f.patch, p); assert.throws(f.bundle); for (const k of Object.keys(p)) delete f.patch[k];
  }
});
test('v2 admits different ORIGINAL native lock/template/entry bytes without evaluating candidate code or comparing current checkout', () => {
  const p = input(), lock = Buffer.from(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8') + '\n# original fictional lock\n');
  const template = Buffer.from(readFileSync(new URL('../packages/deploy/src/worker-template.ts', import.meta.url), 'utf8').replace('Every string binding', 'Original input binding'));
  const entry = fileBytes('worker/entry.ts', Buffer.from(buildWorkerEntry().replace('Every string binding', 'Original input binding')));
  Object.assign(p.files.find(f => f.path === 'worker/entry.ts')!, entry); p.inventory_sha256 = inventory(p.files);
  p.build.lock_sha256 = digest(lock); p.build.template_sha256 = digest(template); p.build.entry_sha256 = entry.sha256;
  const original = { 'pnpm-lock.yaml': lock, 'packages/deploy/src/worker-template.ts': template };
  assert.equal(nativeInput(p, original).bundle().payload.build.entry_sha256, entry.sha256);
  const wrongLock = { ...original, 'pnpm-lock.yaml': Buffer.from('wrong original') };
  assert.throws(() => nativeInput(p, wrongLock).bundle(), /lock mismatch/);
  const wrongRecipe = { ...original, 'scripts/application-artifacts.ts': Buffer.from('unreviewed publisher') };
  assert.throws(() => nativeInput(p, wrongRecipe).bundle());
});
test('arbitrary historical v1 artifact cannot borrow reviewed known entry hashes or become grandfathered', () => {
  const p = input(); p.schema = 'attestrack.application-bytes/v1'; delete p.build.template_sha256; delete p.build.publisher_sha256;
  p.files = p.files.filter(f => f.path !== 'worker/entry.ts'); p.inventory_sha256 = inventory(p.files);
  assert.throws(() => nativeInput(p).bundle(), /Unsupported legacy publisher/);
});
test('actual admitted artifact identity bridges to actual HTTP inspect validator; native-prefixed digest refuses before HTTP', async () => {
  const bundle = nativeInput().bundle(), event = randomUUID(), cohort = randomUUID(); let requests = 0;
  const target = { origin: 'https://fictional.invalid', site_id: 'fictional', policy_hash: 'a'.repeat(64) };
  const input = { target, artifact: bundle.identity, phase: 'predecessor' as const, mutation: { cohort, event_id: event } };
  const fetcher: typeof fetch = async (url, init) => {
    requests++; const path = new URL(String(url)).pathname;
    if (path.endsWith('/site-config')) return new Headers(init!.headers).has('x-attestrack-portal-secret')
      ? Response.json({ siteId: target.site_id, consentConfigured: true, mode: 'ENFORCEMENT' }) : Response.json({ error: 'portal_unauthorized' }, { status: 401 });
    if (path.endsWith('/consent/context')) return Response.json({ siteId: target.site_id });
    assert.ok(path.endsWith('/explore/query'));
    return Response.json({ columns: ['eventId', 'siteId', 'eventName', 'consentDecision'], rows: [{ eventId: event, siteId: target.site_id, eventName: 'release_witness', consentDecision: 'granted' }], rowCount: 1, truncated: false });
  };
  const witness = await inspect(input, { portal_secret: 'fictional-source-only-portal-secret' }, fetcher);
  assert.deepEqual(witness.artifact, bundle.identity); assert.equal(witness.observation, 'read-only'); assert.equal(requests, 4);
  requests = 0;
  await assert.rejects(() => inspect({ ...input, artifact: { ...bundle.identity, archive_sha256: 'sha256:' + bundle.identity.archive_sha256 } }, { portal_secret: 'fictional-source-only-portal-secret' }, fetcher), /invalid_artifact_reference/);
  assert.equal(requests, 0);
});
test('fictional native writer uploads exact original module/static bytes, separates version creation/switch and retains native serving readback', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), f = nativeInput(), bundle = f.bundle(); const records: Journal[] = [];
  const previous = await writer.observe(); const result = await writer.deploy(bundle, previous, tool, { operation_id: OP, async append(r) { records.push(r); } });
  assert.equal(result.after!.worker.version_id, C); assert.equal(result.after!.pages!.deployment_id, PC);
  assert.deepEqual(result.artifact, bundle.identity); assert.equal(result.target_sha256, targetIdentity(cloud.target()));
  assert.equal(result.operations.length, 4); assert.ok(result.operations.every(o => o.state === 'confirmed'));
  assert.equal(result.operation_id, OP); assert.equal(result.after!.worker.operation_id, OP); assert.equal(result.after!.pages!.operation_id, OP);
  const upload = JSON.parse(cloud.writes()[0].init.body as string);
  assert.equal(upload.modules[0].content_base64, bundle.payload.files.find(f => f.path === 'worker/index.js')!.base64);
  assert.equal(cloud.writes()[1].path.endsWith('/deployments'), true);
  const assets = cloud.writes().filter(c => c.path === '/pages/assets/upload').flatMap(c => JSON.parse(c.init.body as string));
  for (const asset of assets) assert.ok(bundle.payload.files.some(f => f.path.startsWith('portal/') && f.base64 === asset.value));
  assert.ok(records.some(r => r.operations.at(-1)?.name === 'worker-switch' && r.operations.at(-1)?.state === 'unknown'));
  assert.equal(JSON.stringify(result).includes('fictional-assets-token'), false);
  assert.equal(JSON.stringify(result).includes('accepted'), false);
}));
test('read-only native operation reconciliation finds exact tag plus bytes/config; absence/duplicates never dispatch a replay', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), bundle = nativeInput().bundle(), p = await writer.observe();
  const records: Journal[] = [];
  await writer.deploy(bundle, p, tool, { operation_id: OP, async append(r) { records.push(r); } });
  const writes = cloud.writes().length, seen = await writer.inspectOperation(bundle, OP);
  assert.equal(seen.worker.versions.length, 1); assert.equal(seen.worker.versions[0].id, C);
  assert.equal(seen.worker.versions[0].module_sha256, bundle.payload.files.find(f => f.path === 'worker/index.js')!.sha256);
  assert.equal(seen.pages!.deployments.length, 1); assert.equal(seen.pages!.deployments[0].id, PC);
  const absent = await writer.inspectOperation(bundle, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(absent.worker.versions.length, 0); assert.equal(absent.pages!.deployments.length, 0);
  cloud.versions.set(id(9), { ...cloud.versions.get(C)!, id: id(9), number: 3 });
  const duplicate = await writer.inspectOperation(bundle, OP); assert.equal(duplicate.worker.versions.length, 2);
  assert.equal(cloud.writes().length, writes); assert.equal('qualified' in duplicate, false);
  assert.equal(records[0].operation_id, OP); assert.equal(records[0].operations.length, 0);
}));
test('incomplete/native-truncated operation inventories refuse read-only reconciliation without any write', async () => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), bundle = nativeInput().bundle();
  for (const patch of [{ total_count: 26, total_pages: 2 }, { total_count: 1001, total_pages: 41 }, { page: 2 }, { per_page: 100 }]) {
    cloud.inventoryPatch = patch; await assert.rejects(() => writer.inspectOperation(bundle, OP), /inventory/);
  }
  assert.equal(cloud.writes().length, 0);
});
test('active/latest disagreement and wrong existing identity/config fail before any mutation', async () => withRuntime(async tool => {
  for (const defect of ['latest', 'worker', 'config', 'pages']) {
    const cloud = new FictionalCloudflare(), target = cloud.target();
    if (defect === 'latest') cloud.latest = C;
    if (defect === 'worker') cloud.worker.id = C;
    if (defect === 'config') cloud.worker.logpush = true;
    if (defect === 'pages') cloud.project.id = C;
    const writer = new NativeWriter(target, cloud);
    await assert.rejects(() => writer.observe()); assert.equal(cloud.writes().length, 0);
  }
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe();
  cloud.latest = C;
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { operation_id: OP, async append() {} })); assert.equal(cloud.writes().length, 0);
}));
test('unadmitted or mutated application bytes and invalid Pages controls cannot reach provider writes', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe();
  const bundle = nativeInput().bundle();
  await assert.rejects(() => writer.deploy(structuredClone(bundle) as Bundle, p, tool, { operation_id: OP, async append() {} }), /admission/);
  bundle.payload.files[0].base64 = '';
  await assert.rejects(() => writer.deploy(bundle, p, tool, { operation_id: OP, async append() {} }), /drifted/);
  const raw = input(); raw.files.push(fileBytes('portal/_worker.js', Buffer.from('forbidden function'))); raw.files.sort((a, b) => a.path.localeCompare(b.path)); raw.inventory_sha256 = inventory(raw.files);
  await assert.rejects(() => writer.deploy(nativeInput(raw).bundle(), p, tool, { operation_id: OP, async append() {} }), /control file/);
  assert.equal(cloud.writes().length, 0);
}));
test('native code mismatch stops before traffic switch; newer upload/deployment refuses overwrite', async () => withRuntime(async tool => {
  for (const defect of ['bytes', 'newer-upload', 'newer-deployment']) {
    const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe();
    if (defect === 'bytes') cloud.corruptModule = true;
    cloud.before = path => {
      if (cloud.latest === C && path.endsWith('/versions?per_page=1&page=1') && defect === 'newer-upload') cloud.latest = id(9);
      if (cloud.latest === C && path.endsWith('/deployments') && defect === 'newer-deployment') cloud.deployment = id(9);
    };
    await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { operation_id: OP, async append() {} }));
    assert.equal(cloud.writes().filter(c => c.path.endsWith('/deployments')).length, 0); assert.equal(cloud.active, P);
  }
}));
test('Worker success/Pages unknown preserves partial journal; no hidden automatic rollback/replay', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe(); cloud.failPages = true;
  const records: Journal[] = [];
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { operation_id: OP, async append(r) { records.push(r); } }), /ambiguous/);
  assert.equal(cloud.active, C); const last = records.at(-1)!;
  assert.equal(last.operations.at(-1)!.name, 'pages-deploy'); assert.equal(last.operations.at(-1)!.state, 'unknown');
  assert.equal(last.after!.worker.version_id, C); assert.equal(cloud.writes().filter(c => c.path.endsWith('/fictional-portal/deployments')).length, 1);
  // Replaying the stale predecessor cannot overwrite the confirmed Worker or a newer revision.
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { operation_id: OP, async append() {} }), /predecessor changed/);
}));
test('journal durability failure before dispatch prevents mutation; fixed target rejects unsupported topology', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe(); let writes = 0;
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { operation_id: OP, async append() { if (++writes === 2) throw new Error('durability failed'); } }), /durability/);
  assert.equal(cloud.writes().length, 0);
  for (const raw of [null, { ...cloud.target(), account_id: '../escape' }, { ...cloud.target(), extra: true },
    { ...cloud.target(), worker: { ...cloud.target().worker, bindings: [{ name: 'D1', type: 'd1' }] } }]) assert.throws(() => validateTarget(raw));
  assert.notEqual(targetIdentity(cloud.target()), targetIdentity({ ...cloud.target(), environment: 'production' }));
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
}));
test('fixed native transport never redirects provider tokens or emits raw error bodies', async () => {
  const fetchBefore = globalThis.fetch; const requests: { url: string; options: RequestInit }[] = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options: options! });
      return new Response(JSON.stringify({ success: true, errors: [], result: { native: 'fictional' } }), { status: 200 });
    };
    const client = new Cloudflare('fictional-provider-token');
    await client.request('/accounts/' + 'a'.repeat(32) + '/workers/workers/' + W);
    assert.equal(requests[0].url.startsWith('https://api.cloudflare.com/client/v4/accounts/'), true);
    assert.equal(requests[0].options.redirect, 'error');
    await client.request('/pages/assets/upload', { method: 'POST', body: '[]' }, 'fictional-asset-token');
    assert.equal((requests[1].options.headers as Record<string, string>).authorization, 'Bearer fictional-asset-token');
    for (const path of ['https://attacker.invalid/', '/accounts/../../secret', '/zones/somewhere']) await assert.rejects(() => client.request(path), /Forbidden/);
    globalThis.fetch = async () => new Response('raw-sensitive-provider-error', { status: 403 });
    await assert.rejects(() => client.request('/pages/assets/upload'), e => e instanceof Error && e.message === 'Native Cloudflare HTTP 403');
  } finally { globalThis.fetch = fetchBefore; }
});
test('fake pinned-tool callbacks and changed required binding types refuse before any writes', async () => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe();
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, { hash: () => Buffer.alloc(32), assertUnchanged() {} }, { operation_id: OP, async append() {} }), /Pinned uploader/);
  assert.equal(cloud.writes().length, 0);
  const t = cloud.target(); t.worker.bindings = t.worker.bindings.map(b => b.name === 'ATTESTRACK_KV' ? { name: b.name, type: 'secret_text' } : b);
  assert.throws(() => validateTarget(t), /required binding type/);
});
test('actual native GitHub CLI reader accepts its exact repository root and rejects foreign reads before child dispatch', () => {
  const d = mkdtempSync(join(tmpdir(), 'attestrack-native-gh-'));
  try {
    writeFileSync(join(d, 'gh'), `#!${process.execPath}\nif(process.argv.length!==6||process.argv[2]!=='api'||process.argv[3]!=='--hostname'||process.argv[4]!=='github.com'||process.argv[5]!==${JSON.stringify(`repos/${REPOSITORY}`)})throw Error('wrong native path');process.stdout.write('{"id":41}');\n`, { mode: 0o755 });
    const source = new URL('./native-application-release.ts', import.meta.url).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import {NativeGitHub} from ${JSON.stringify(source)};console.log(JSON.stringify(new NativeGitHub().json(${JSON.stringify(`repos/${REPOSITORY}`)})))`],
      { env: { PATH: d }, timeout: 10000 });
    assert.equal(JSON.parse(output.toString()).id, 41);
    assert.throws(() => new NativeGitHub().json('repos/foreign/attestrack'), /Foreign/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

const releasePhase = { release_id: id(8), phase: 'candidate' as const };
const executorOwner={repository_id:41,workflow_commit:'e'.repeat(40),run_id:200,run_attempt:1,job_id:300};
test('role-separated native operations execute exact retained components with separate durable claim and ACK steps',async()=>withRuntime(async tool=>{
 const cloud=new FictionalCloudflare(),writer=new NativeWriter(cloud.target(),cloud),bundle=nativeInput().bundle(),before=await writer.observe();let last:Journal|null=null;
 for(let n=0;n<4;n++){
  const journal=writer.prepareOperation(bundle,before,OP,last),prepared=prepareOperation(journal,'staging', releasePhase);
  assert.equal(prepared.state,'prepared');const writes=cloud.writes().length;
  // A merely prepared or interrupted/unknown record cannot obtain execution.
  await assert.rejects(execution({async readCurrent(){return prepared;}},{...releasePhase,environment:'staging',operation_id:OP},executorOwner),/claim differs/);
  const claimed=claimOperation(prepared,{...executorOwner,job_id:300+n});assert.throws(()=>claimOperation(claimed,executorOwner),/reconciliation/);
  const cap=await fixtureExecution({async readCurrent(){return claimed;}},{...releasePhase,environment:'staging',operation_id:OP},{...executorOwner,job_id:300+n});
  const ack=await writer.executeOperation(bundle,tool,cap);assert.ok(cloud.writes().length>writes);
  await assert.rejects(writer.executeOperation(bundle,tool,cap),/capability/);
  await assert.rejects(fixtureExecution({async readCurrent(){return claimed;}},{...releasePhase,environment:'staging',operation_id:OP},{...executorOwner,job_id:300+n}),/already issued/);
  const finished=recordAcknowledgement(claimed,ack);assert.equal(finished.state,'acknowledged');last=finished.journal;
 }
 assert.equal(last!.after!.worker.version_id,C);assert.equal(last!.after!.pages!.deployment_id,PC);assert.equal(last!.operations.length,4);
 assert.throws(()=>writer.prepareOperation(bundle,before,OP,last),/complete/);
}));
test('durable unknown, unclaimed, swapped executor/source and forged capability refuse without provider mutation',async()=>withRuntime(async tool=>{
 const cloud=new FictionalCloudflare(),writer=new NativeWriter(cloud.target(),cloud),bundle=nativeInput().bundle(),before=await writer.observe(),j=writer.prepareOperation(bundle,before,OP),prepared=prepareOperation(j,'staging', releasePhase),claimed=claimOperation(prepared,executorOwner);
 for(const f of [prepared,unknownOperation(claimed)])await assert.rejects(execution({async readCurrent(){return f;}},{...releasePhase,environment:'staging',operation_id:OP},executorOwner),/claim differs/);
 for(const patch of [{job_id:301},{run_attempt:2},{run_id:201},{repository_id:42},{workflow_commit:'f'.repeat(40)}])await assert.rejects(execution({async readCurrent(){return claimed;}},{...releasePhase,environment:'staging',operation_id:OP},{...executorOwner,...patch}),/claim differs/);
 await assert.rejects(execution(undefined as never,{...releasePhase,environment:'staging',operation_id:OP},executorOwner),/Authenticated current/);
 await assert.rejects(writer.executeOperation(bundle,tool,{operation_id:OP}),/capability/);
 assert.throws(()=>writer.prepareOperation(bundle,before,OP,j),/Unknown/);assert.equal(cloud.writes().length,0);
}));
test('lost native ACK remains unknown and reconciliation reads existing operation without dispatching again',async()=>withRuntime(async tool=>{
 const cloud=new FictionalCloudflare(),writer=new NativeWriter(cloud.target(),cloud),bundle=nativeInput().bundle(),before=await writer.observe(),prepared=prepareOperation(writer.prepareOperation(bundle,before,OP),'staging', releasePhase),owner={...executorOwner,run_id:210},claimed=claimOperation(prepared,owner);
 cloud.corruptModule=true;const cap=await fixtureExecution({async readCurrent(){return claimed;}},{...releasePhase,environment:'staging',operation_id:OP},owner);
 await assert.rejects(writer.executeOperation(bundle,tool,cap),/Uploaded original/);assert.equal(cloud.writes().length,1);
 const unknown=unknownOperation(claimed);await assert.rejects(execution({async readCurrent(){return unknown;}},{...releasePhase,environment:'staging',operation_id:OP},owner),/claim differs/);
 const observation=await writer.inspectOperation(bundle,OP);assert.equal(observation.worker.versions.length,1);assert.equal(cloud.writes().length,1);
}));
test('ACK binding tampering cannot advance a durable original claim and monolithic production path is refused',async()=>withRuntime(async tool=>{
 const cloud=new FictionalCloudflare(),writer=new NativeWriter(cloud.target(),cloud),bundle=nativeInput().bundle(),before=await writer.observe(),claimed=claimOperation(prepareOperation(writer.prepareOperation(bundle,before,OP),'staging', releasePhase),{...executorOwner,run_id:220});
 const cap=await fixtureExecution({async readCurrent(){return claimed;}},{...releasePhase,environment:'staging',operation_id:OP},{...executorOwner,run_id:220}),ack=await writer.executeOperation(bundle,tool,cap);
 for(const patch of [{journal_sha256:'0'.repeat(64)},{operation_id:id(9)},{name:'pages-deploy'},{native_id:['bad']}])assert.throws(()=>recordAcknowledgement(claimed,{...ack,...patch} as typeof ack));
 const target=cloud.target();target.environment='production';const prod=new NativeWriter(target,cloud),writes=cloud.writes().length;
 await assert.rejects(prod.deploy(bundle,before,tool,{operation_id:OP,async append(){assert.fail('Production must not enter combined journal/provider custody');}}),/role-separated/);assert.equal(cloud.writes().length,writes);
}));
test('production remains expressible through separate claimed operations without combined writer authority',async()=>withRuntime(async tool=>{
 const cloud=new FictionalCloudflare(),target=cloud.target();target.environment='production';target.pages=null;
 const writer=new NativeWriter(target,cloud),bundle=nativeInput().bundle(),before=await writer.observe();let last:Journal|null=null;
 for(let n=0;n<2;n++){const owner={...executorOwner,run_id:230,job_id:330+n},claimed=claimOperation(prepareOperation(writer.prepareOperation(bundle,before,OP,last),'production', releasePhase),owner),cap=await fixtureExecution({async readCurrent(){return claimed;}},{...releasePhase,environment:'production',operation_id:OP},owner),ack=await writer.executeOperation(bundle,tool,cap);last=recordAcknowledgement(claimed,ack).journal;}
 assert.equal(last!.after!.worker.version_id,C);assert.equal(last!.after!.pages,null);assert.equal(cloud.writes().length,2);
}));

test('confirmed final Pages ACK requires matching current deployment and operation readback',async()=>withRuntime(async tool=>{
 const cloud=new FictionalCloudflare(),writer=new NativeWriter(cloud.target(),cloud),bundle=nativeInput().bundle(),before=await writer.observe();let last:Journal|null=null;
 for(let n=0;n<4;n++){
  const owner={...executorOwner,run_id:240,job_id:340+n},claimed=claimOperation(prepareOperation(writer.prepareOperation(bundle,before,OP,last),'staging', releasePhase),owner),cap=await fixtureExecution({async readCurrent(){return claimed;}},{...releasePhase,environment:'staging',operation_id:OP},owner),ack=await writer.executeOperation(bundle,tool,cap);
  if(n===3){
   for(const pages of [null,before.pages,{...ack.after!.pages!,deployment_id:PG},{...ack.after!.pages!,operation_id:null},{...ack.after!.pages!,operation_id:id(9)}]){
    const changed=structuredClone(ack);changed.after!.pages=pages;assert.throws(()=>recordAcknowledgement(claimed,changed),/Pages serving acknowledgement/);
   }
   const swapped=structuredClone(ack);swapped.native_id=PG;assert.throws(()=>recordAcknowledgement(claimed,swapped),/Pages serving acknowledgement/);
  }
  last=recordAcknowledgement(claimed,ack).journal;
 }
 assert.equal(last!.operations[3].native_id,PC);assert.equal(last!.after!.pages!.deployment_id,PC);assert.equal(last!.after!.pages!.operation_id,OP);assert.deepEqual(validateJournal(last),last);
 for(const pages of [null,before.pages,{...last!.after!.pages!,deployment_id:PG},{...last!.after!.pages!,operation_id:null},{...last!.after!.pages!,operation_id:id(9)}]){
  const changed=structuredClone(last!);changed.after!.pages=pages;assert.throws(()=>validateJournal(changed),/Pages serving acknowledgement/);
 }
}));

// Fictional CAS transport only. Production assembly must use authenticated Git
// journal bytes and actual compare-and-swap; this fixture is not that adapter.
class FictionalCoordinatorStore implements CoordinatorStore {
  slot: Slot = { head: '1'.repeat(40), record: null };
  commits = 0;
  fault: 'before' | 'after' | 'conflict' | null = null;
  async read() { return structuredClone(this.slot); }
  async compareAndSwap(_environment: 'staging' | 'production', expected: Slot, next: CoordinatorRecord) {
    if (canonical(expected) !== canonical(this.slot)) return false;
    const fault = this.fault; this.fault = null;
    if (fault === 'before') throw Error('Fictional disconnected push, no commit observed');
    if (fault === 'conflict') { this.slot.head = '2'.repeat(40); return false; }
    this.commits++;
    this.slot = { head: this.commits.toString(16).padStart(40, '0'), record: structuredClone(next) };
    if (fault === 'after') throw Error('Fictional committed push with lost acknowledgement');
    return true;
  }
}
async function coordinatorFixture(runId = 500) {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), bundle = nativeInput().bundle();
  const journal = writer.prepareOperation(bundle, await writer.observe(), OP);
  const context = { repository_id: 41, workflow_commit: 'e'.repeat(40), run_id: runId, run_attempt: 1 };
  const plan: PlannedRequest = { schema: 'attestrack.application-source-admission/v1', kind: 'planned', repository: REPOSITORY, repository_id: 41,
    context, branch: 'staging', source_commit: source, source_tree: tree, promotion_pr: 7, artifact: bundle.identity, materialization: null,
    tool: { run_id: 101, run_attempt: 1, artifact_id: 92, archive_sha256: 'f'.repeat(64), profile_sha256: journal.tool_profile_sha256 },
    targets: { profile_sha256: 'f'.repeat(64), native_sha256: journal.target_sha256, http_sha256: 'f'.repeat(64) } };
  const intent = coordinatorIntent(plan, journal, releasePhase), store = new FictionalCoordinatorStore();
  const run = { id: runId, run_attempt: 1, head_sha: context.workflow_commit, head_branch: 'main', head_repository: { full_name: REPOSITORY },
    event: 'workflow_run', path: '.github/workflows/application-release.yml', status: 'in_progress', conclusion: null as string | null, pull_requests: [] };
  const scope = { id: 501, name: 'scope', run_id: runId, run_attempt: 1, head_sha: context.workflow_commit, status: 'completed', conclusion: 'success' as string | null };
  const job = { ...scope, id: 502, name: operationJobName(intent), status: 'in_progress', conclusion: null as string | null };
  let jobs = [scope, job], archive = Buffer.alloc(0);
  const artifacts: Record<string, unknown>[] = [];
  const patch: { latest?: Record<string, unknown>; run?: Record<string, unknown>; repo?: Record<string, unknown>; total?: number } = {};
  const reads: string[] = []; let beforeRead: ((path: string) => void) | null = null;
  const reader: GitHubRead = {
    json<T>(path: string): T {
      reads.push(path); beforeRead?.(path); let result: unknown;
      if (path === `repos/${REPOSITORY}`) result = { id: 41, full_name: REPOSITORY, fork: false, default_branch: 'main', ...patch.repo };
      else if (path === `repos/${REPOSITORY}/actions/runs/${runId}`) result = { ...run, ...patch.latest };
      else if (path === `repos/${REPOSITORY}/actions/runs/${runId}/attempts/1`) result = { ...run, ...patch.run };
      else if (path === `repos/${REPOSITORY}/actions/runs/${runId}/attempts/1/jobs?per_page=100&page=1`) result = { total_count: patch.total ?? jobs.length, jobs };
      else if (path === `repos/${REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100&page=1`) result = { total_count: artifacts.length, artifacts };
      else throw Error(`Unexpected coordinator native read ${path}`);
      return structuredClone(result) as T;
    },
    bytes(path) { assert.equal(path, `repos/${REPOSITORY}/actions/artifacts/901/zip`); return archive; },
  };
  const coordinator = () => new NativeOperationCoordinator(store, reader);
  function acknowledge(ack: unknown) {
    archive = execFileSync('python3', ['-c', 'import sys,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:z.writestr("acknowledgement.json",sys.stdin.buffer.read())\nsys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(ack) });
    artifacts.push({ id: 901, name: acknowledgementName(intent, job.id), expired: false, size_in_bytes: archive.length, digest: `sha256:${digest(archive)}`,
      workflow_run: { id: runId, repository_id: 41, head_repository_id: 41, head_branch: 'main', head_sha: context.workflow_commit } });
    job.status = 'completed'; job.conclusion = 'success';
  }
  const ack = { schema: 'attestrack.native-operation-ack/v2' as const, ...releasePhase, journal_sha256: digest(canonical(journal)), operation_id: OP,
    name: 'worker-upload' as const, native_id: C, after: null };
  return { cloud, writer, bundle, plan, journal, intent, store, run, job, scope, patch, reads, artifacts, coordinator, acknowledge, ack,
    setJobs(value: typeof jobs) { jobs = value; }, corruptArchive() { archive = Buffer.from('wrong bytes'); },
    onRead(callback: (path: string) => void) { beforeRead = callback; } };
}
test('coordinator persists original intent before discovering native job; duplicate wakes and restart reuse exact claim', async () => {
  const f = await coordinatorFixture();
  const first = await f.coordinator().reconcile(f.intent);
  assert.equal(first.kind, 'claimed-awaiting-original-job'); assert.equal(first.record.current.executor!.job_id, 502);
  assert.equal(f.store.commits, 2); assert.equal(f.cloud.writes().length, 0);
  const second = await f.coordinator().reconcile(f.intent);
  assert.deepEqual(second, first); assert.equal(f.store.commits, 2);
  assert.ok(f.reads.includes(`repos/${REPOSITORY}/actions/runs/500/attempts/1/jobs?per_page=100&page=1`));
});
test('coordinator genuine existing writer ACK settles successful original job while outer run remains in progress', async () => withRuntime(async tool => {
  const f = await coordinatorFixture(510), claimed = await f.coordinator().reconcile(f.intent);
  const cap = await fixtureExecution({ async readCurrent() { return claimed.record.current; } }, { ...releasePhase, environment: 'staging', operation_id: OP }, claimed.record.current.executor!);
  const ack = await f.writer.executeOperation(f.bundle, tool, cap); f.acknowledge(ack);
  const result = await f.coordinator().reconcile(f.intent);
  assert.equal(result.kind, 'acknowledged'); assert.equal(result.record.current.journal.operations[0].native_id, C);
  assert.equal(f.run.status, 'in_progress'); assert.equal(f.cloud.writes().length, 1);
  assert.deepEqual(await f.coordinator().reconcile(f.intent), result); assert.equal(f.cloud.writes().length, 1);
}));
test('lost journal ACK after committed prepare, claim and final ACK is reconciled without a second transition', async () => {
  for (const phase of ['prepare', 'claim', 'ack']) {
    const f = await coordinatorFixture();
    if (phase === 'claim') { f.setJobs([f.scope]); await f.coordinator().reconcile(f.intent); f.setJobs([f.scope, f.job]); }
    if (phase === 'ack') { await f.coordinator().reconcile(f.intent); f.acknowledge(f.ack); }
    f.store.fault = 'after'; const result = await f.coordinator().reconcile(f.intent);
    assert.equal(result.kind, phase === 'ack' ? 'acknowledged' : 'claimed-awaiting-original-job');
    assert.equal(f.store.commits, phase === 'ack' ? 3 : 2);
    await f.coordinator().reconcile(f.intent); assert.equal(f.store.commits, phase === 'ack' ? 3 : 2);
    assert.equal(f.cloud.writes().length, 0);
  }
});
test('failed durable prepare never reads executor or touches provider; CAS conflict safely reopens current bytes', async () => {
  const f = await coordinatorFixture(); f.store.fault = 'before';
  await assert.rejects(f.coordinator().reconcile(f.intent), /write outcome unresolved/);
  assert.equal(f.store.slot.record, null); assert.equal(f.reads.length, 0); assert.equal(f.cloud.writes().length, 0);
  f.store.fault = 'conflict'; assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'claimed-awaiting-original-job');
  assert.equal(f.store.commits, 2);
});
test('terminal success without ACK, cancellation and failure hold unknown; no replacement executor or retry', async () => {
  for (const conclusion of ['success', 'cancelled', 'failure', 'timed_out']) {
    const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent);
    f.job.status = 'completed'; f.job.conclusion = conclusion;
    const result = await f.coordinator().reconcile(f.intent); assert.equal(result.kind, 'read-only-reconciliation');
    assert.deepEqual(await f.coordinator().reconcile(f.intent), result); assert.equal(f.store.commits, 3);
    f.job.id = 503; await assert.rejects(f.coordinator().reconcile(f.intent), /replaced/);
    assert.equal(f.cloud.writes().length, 0);
  }
});
test('late original successful job ACK resolves durable unknown but does not reset execution', async () => {
  const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent);
  f.job.status = 'completed'; f.job.conclusion = 'success';
  assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'read-only-reconciliation');
  f.acknowledge(f.ack); assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'acknowledged');
  assert.equal(f.store.commits, 4); assert.equal(f.cloud.writes().length, 0);
});
test('never finishing original executor keeps claim without expiry, and original scope-only workflow cannot claim', async () => {
  const f = await coordinatorFixture(); f.setJobs([f.scope]);
  for (let n = 0; n < 3; n++) assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'waiting-original-job');
  assert.equal(f.store.commits, 1); f.setJobs([f.scope, f.job]); await f.coordinator().reconcile(f.intent);
  for (let n = 0; n < 3; n++) assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'claimed-awaiting-original-job');
  assert.equal(f.store.commits, 2); assert.equal(f.cloud.writes().length, 0);
});
test('wrong original run/source/attempt/repository/job and incomplete or duplicate listing cannot claim', async () => {
  const mutations: ((f: Awaited<ReturnType<typeof coordinatorFixture>>) => void)[] = [
    f => { f.patch.latest = { run_attempt: 2 }; }, f => { f.patch.run = { head_sha: 'f'.repeat(40) }; },
    f => { f.patch.run = { event: 'workflow_dispatch' }; }, f => { f.patch.run = { path: '.github/workflows/foreign.yml' }; },
    f => { f.patch.repo = { id: 42 }; }, f => { f.patch.repo = { fork: true }; },
    f => { f.job.run_attempt = 2; }, f => { f.job.head_sha = 'f'.repeat(40); },
    f => { f.scope.conclusion = 'failure'; }, f => { f.patch.total = 3; },
    f => { f.setJobs([f.scope, f.job, { ...f.job, id: 503 }]); },
  ];
  for (const change of mutations) {
    const f = await coordinatorFixture(); change(f); await assert.rejects(f.coordinator().reconcile(f.intent));
    assert.equal((f.store.slot.record as CoordinatorRecord).current.state, 'prepared'); assert.equal(f.cloud.writes().length, 0);
  }
});
test('another environment intent or changed original run cannot steal the retained slot', async () => {
  const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent);
  const other = structuredClone(f.intent); other.original_run.run_id++;
  await assert.rejects(f.coordinator().reconcile(other), /occupied/);
  const changed = structuredClone(f.intent); changed.prepared.journal.operation_id = id(9); changed.current = structuredClone(changed.prepared);
  await assert.rejects(f.coordinator().reconcile(changed), /occupied/);
  assert.equal(f.store.commits, 2); assert.equal(f.cloud.writes().length, 0);
});
test('job-bound ACK archive origin, native hash, uniqueness and operation contents are all required', async () => {
  const mutations: ((f: Awaited<ReturnType<typeof coordinatorFixture>>) => void)[] = [
    f => { f.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; }, f => { f.corruptArchive(); },
    f => { f.artifacts[0].expired = true; }, f => { f.artifacts[0].workflow_run = { id: 999 }; },
    f => { f.artifacts.push({ ...f.artifacts[0], id: 902 }); },
  ];
  for (const change of mutations) {
    const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent); f.acknowledge(f.ack); change(f);
    await assert.rejects(f.coordinator().reconcile(f.intent)); assert.equal(f.store.commits, 2);
  }
  for (const patch of [{ operation_id: id(9) }, { journal_sha256: '0'.repeat(64) }, { name: 'worker-switch' }, { extra: true }]) {
    const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent); f.acknowledge({ ...f.ack, ...patch });
    await assert.rejects(f.coordinator().reconcile(f.intent)); assert.equal(f.store.commits, 2);
  }
});
test('a failed provider job cannot launder even a valid ACK artifact into confirmed state', async () => {
  const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent); f.acknowledge(f.ack); f.job.conclusion = 'failure';
  assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'read-only-reconciliation'); assert.equal(f.cloud.writes().length, 0);
});
test('plan target/artifact/tool binding mismatch refuses before an intent can enter the durable slot', async () => {
  const f = await coordinatorFixture();
  for (const field of ['target_sha256', 'tool_profile_sha256'] as const) {
    const changed = structuredClone(f.journal); changed[field] = '0'.repeat(64);
    assert.throws(() => coordinatorIntent(f.plan, changed, releasePhase), /differs/);
  }
  const changed = structuredClone(f.journal); changed.artifact.producer_attempt++;
  assert.throws(() => coordinatorIntent(f.plan, changed, releasePhase), /differs/);
  assert.equal(f.store.commits, 0);
});
test('concurrent journal coordinators coalesce through whole-head CAS without duplicate claim transitions', async () => {
  const f = await coordinatorFixture();
  const [one, two] = await Promise.all([f.coordinator().reconcile(f.intent), f.coordinator().reconcile(f.intent)]);
  assert.deepEqual(one, two); assert.equal(f.store.commits, 2); assert.equal(f.cloud.writes().length, 0);
});
test('uncommitted final ACK write remains claimed and a fresh reader can persist original ACK without provider replay', async () => {
  const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent); f.acknowledge(f.ack); f.store.fault = 'before';
  await assert.rejects(f.coordinator().reconcile(f.intent), /write outcome unresolved/);
  assert.equal((f.store.slot.record as CoordinatorRecord).current.state, 'execution-claimed');
  assert.equal((await f.coordinator().reconcile(f.intent)).kind, 'acknowledged');
  assert.equal(f.store.commits, 3); assert.equal(f.cloud.writes().length, 0);
});
test('native attempt changing between claim read and bookend prevents durable claim', async () => {
  const f = await coordinatorFixture(); let reads = 0;
  f.onRead(path => { if (path.endsWith('/runs/500') && ++reads === 2) f.patch.latest = { run_attempt: 2 }; });
  await assert.rejects(f.coordinator().reconcile(f.intent), /rerun/);
  assert.equal((f.store.slot.record as CoordinatorRecord).current.state, 'prepared'); assert.equal(f.store.commits, 1);
});
async function nextCoordinatorFixture() {
  const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent); f.acknowledge(f.ack);
  const acknowledged = await f.coordinator().reconcile(f.intent);
  const journal = f.writer.prepareOperation(f.bundle, f.journal.predecessor, OP, acknowledged.record.current.journal);
  const next = coordinatorIntent(f.plan, journal, releasePhase);
  const job = { ...f.job, id: 504, name: operationJobName(next), status: 'in_progress', conclusion: null };
  f.setJobs([f.scope, f.job, job]);
  return { ...f, next, nextJob: job };
}
test('explicit next operation preserves durable ACK and claims its distinct original active job', async () => {
  const f = await nextCoordinatorFixture(), previous = structuredClone(f.store.slot.record as CoordinatorRecord);
  const next = await f.coordinator().advanceOperation(f.next);
  assert.equal(next.kind, 'claimed-awaiting-original-job'); assert.equal(next.record.current.executor!.job_id, 504);
  assert.deepEqual(next.record.prepared.journal.operations.slice(0, -1), previous.current.journal.operations);
  assert.equal(f.store.commits, 5); assert.equal(f.cloud.writes().length, 0);
  assert.deepEqual(await f.coordinator().advanceOperation(f.next), next); assert.equal(f.store.commits, 5);
});
test('next operation never advances an unclaimed, claimed or unknown predecessor', async () => {
  for (const state of ['prepared', 'execution-claimed', 'unknown'] as const) {
    const f = await nextCoordinatorFixture(), claimed = claimOperation(f.intent.prepared, { ...f.intent.original_run, job_id: f.job.id });
    f.store.slot.record = { ...f.intent, current: state === 'prepared' ? f.intent.prepared : state === 'unknown' ? unknownOperation(claimed) : claimed };
    await assert.rejects(f.coordinator().advanceOperation(f.next), /acknowledged/);
    assert.equal(f.store.commits, 3); assert.equal(f.cloud.writes().length, 0);
  }
});
test('next operation binds full previous journal, original run and operation prefix', async () => {
  for (const field of ['run', 'artifact', 'predecessor', 'operation'] as const) {
    const f = await nextCoordinatorFixture(), next = structuredClone(f.next);
    if (field === 'run') next.original_run.run_id++;
    else {
      if (field === 'artifact') next.prepared.journal.artifact.producer_run++;
      if (field === 'predecessor') next.prepared.journal.predecessor.worker.module_sha256 = '0'.repeat(64);
      if (field === 'operation') next.prepared.journal.operation_id = id(9);
      next.current = structuredClone(next.prepared);
    }
    await assert.rejects(f.coordinator().advanceOperation(next)); assert.equal(f.store.commits, 3);
  }
});
test('next-operation lost CAS ACK and conflict reopen without duplicating the claim', async () => {
  for (const fault of ['after', 'conflict'] as const) {
    const f = await nextCoordinatorFixture(); f.store.fault = fault;
    assert.equal((await f.coordinator().advanceOperation(f.next)).record.current.executor!.job_id, 504);
    assert.equal(f.store.commits, 5); assert.equal(f.cloud.writes().length, 0);
  }
});
test('benign native timestamps and step progress between bookends do not refuse claim or ACK', async () => {
  for (const phase of ['claim', 'ack']) {
    const f = await coordinatorFixture();
    if (phase === 'ack') { await f.coordinator().reconcile(f.intent); f.acknowledge(f.ack); }
    let reads = 0;
    f.onRead(path => {
      if (path.endsWith('/runs/500') && ++reads === 2) {
        f.patch.latest = { updated_at: '2026-11-14T12:01:00Z', display_title: 'Progress updated' };
        f.patch.run = { updated_at: '2026-11-14T12:01:00Z', run_started_at: '2026-11-14T12:00:00Z' };
        Object.assign(f.job, { updated_at: '2026-11-14T12:01:00Z', steps: [{ number: 1, status: 'completed', conclusion: 'success' }] });
      }
    });
    const result = await f.coordinator().reconcile(f.intent);
    assert.equal(result.kind, phase === 'ack' ? 'acknowledged' : 'claimed-awaiting-original-job');
    assert.equal(f.store.commits, phase === 'ack' ? 3 : 2); assert.equal(f.cloud.writes().length, 0);
  }
});
test('actual native identity or lifecycle changes between bookends still prevent claim', async () => {
  const changes: ((f: Awaited<ReturnType<typeof coordinatorFixture>>) => void)[] = [
    f => { f.job.id = 503; }, f => { f.job.name = 'foreign-operation'; },
    f => { f.job.status = 'completed'; f.job.conclusion = 'success'; },
    f => { f.job.run_attempt = 2; }, f => { f.job.head_sha = 'f'.repeat(40); },
    f => { f.patch.run = { status: 'completed', conclusion: 'failure' }; },
    f => { f.patch.run = { head_sha: 'f'.repeat(40) }; }, f => { f.patch.latest = { run_attempt: 2 }; },
  ];
  for (const change of changes) {
    const f = await coordinatorFixture(); let reads = 0;
    f.onRead(path => { if (path.endsWith('/runs/500') && ++reads === 2) change(f); });
    await assert.rejects(f.coordinator().reconcile(f.intent));
    assert.equal((f.store.slot.record as CoordinatorRecord).current.state, 'prepared');
    assert.equal(f.store.commits, 1); assert.equal(f.cloud.writes().length, 0);
  }
});
test('authenticated storage is still structurally checked: forged terminal ACK and replacement executor refuse', async () => {
  for (const kind of ['terminal', 'executor']) {
    const f = await coordinatorFixture(); await f.coordinator().reconcile(f.intent);
    const record = f.store.slot.record as CoordinatorRecord;
    if (kind === 'terminal') { record.current.state = 'acknowledged'; record.current.acknowledgement = f.ack; }
    else record.current.executor!.run_attempt++;
    await assert.rejects(f.coordinator().reconcile(f.intent)); assert.equal(f.store.commits, 2); assert.equal(f.cloud.writes().length, 0);
  }
});

// Real isolated files, fictional public native metadata. Cleanup is test-suite
// teardown only; production fence code deliberately has no cleanup/reset API.
const fenceFixtureDirectories: string[] = [];
after(() => { for (const directory of fenceFixtureDirectories) rmSync(directory, { recursive: true, force: true }); });
function originalJobFixture(frame: Frame) {
  const owner = frame.executor!, name = `native-${frame.phase}-${frame.journal.operations.at(-1)!.name}`;
  const temporary = mkdtempSync(join(tmpdir(), 'attestrack-fictional-job-')); fenceFixtureDirectories.push(temporary);
  const env: NodeJS.ProcessEnv = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: String(owner.repository_id),
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_API_URL: 'https://api.github.com', GITHUB_EVENT_NAME: 'workflow_run',
    GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_JOB: name,
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/application-release.yml@refs/heads/main`,
    GITHUB_SHA: owner.workflow_commit, GITHUB_WORKFLOW_SHA: owner.workflow_commit, GITHUB_RUN_ID: String(owner.run_id),
    GITHUB_RUN_ATTEMPT: String(owner.run_attempt), RUNNER_OS: 'Linux', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: temporary };
  const run = { id: owner.run_id, run_attempt: owner.run_attempt, head_sha: owner.workflow_commit, head_branch: 'main', head_repository: { full_name: REPOSITORY },
    event: 'workflow_run', path: '.github/workflows/application-release.yml', status: 'in_progress', conclusion: null as string | null };
  const job = { id: owner.job_id, name, run_id: owner.run_id, run_attempt: owner.run_attempt, head_sha: owner.workflow_commit, status: 'in_progress', conclusion: null as string | null };
  const scope = { ...job, id: owner.job_id + 1000, name: 'scope', status: 'completed', conclusion: 'success' };
  const prefix = `repos/${REPOSITORY}`, documents: Record<string, unknown> = {
    [prefix]: { id: owner.repository_id, full_name: REPOSITORY, fork: false, default_branch: 'main' },
    [`${prefix}/actions/runs/${owner.run_id}`]: run,
    [`${prefix}/actions/runs/${owner.run_id}/attempts/${owner.run_attempt}`]: run,
    [`${prefix}/actions/runs/${owner.run_id}/attempts/${owner.run_attempt}/jobs?per_page=100&page=1`]: { total_count: 2, jobs: [scope, job] },
  };
  let beforeRead: ((path: string) => void) | null = null;
  const github: GitHubRead = { json<T>(path: string): T {
    beforeRead?.(path); if (!(path in documents)) throw Error(`Unexpected original job read ${path}`); return structuredClone(documents[path]) as T;
  }, bytes() { assert.fail('Job fence never downloads a provider key or artifact'); } };
  return { github, env, temporary, run, job, scope, documents,
    marker: join(temporary, JOB_FENCE_DIRECTORY, JOB_FENCE_FILE),
    onRead(callback: (path: string) => void) { beforeRead = callback; } };
}
async function fixtureExecution(reader: AuthenticatedJournalReader, context: { release_id: string; phase: Frame['phase']; environment: Frame['environment']; operation_id: string }, owner: Executor) {
  const frame = await reader.readCurrent({ repository: REPOSITORY, ...context }) as Frame;
  return execution(reader, context, owner, originalJobFixture(frame));
}
async function fenceFrame(runId: number) {
  const fixture = await coordinatorFixture(runId);
  return claimOperation(fixture.intent.prepared, { ...fixture.intent.original_run, job_id: 502 });
}
test('mandatory execution fence binds exact whole frame and native identity before capability issuance', async () => {
  const frame = await fenceFrame(610), runtime = originalJobFixture(frame);
  const cap = await execution({ async readCurrent() { return frame; } }, { ...releasePhase, environment: 'staging', operation_id: OP }, frame.executor!, runtime);
  assert.equal(cap.operation_id, OP);
  assert.deepEqual(JSON.parse(readFileSync(runtime.marker, 'utf8')), { schema: 'attestrack.native-job-consumption/v2', repository: REPOSITORY,
    ...releasePhase, environment: 'staging', operation_id: OP, executor: frame.executor, frame_sha256: digest(canonical(frame)) });
  assert.equal(lstatSync(runtime.marker).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(runtime.temporary, JOB_FENCE_DIRECTORY)).mode & 0o777, 0o700);
  assert.throws(() => reserveOriginalJob(frame, runtime), /EEXIST/);
});
test('a fresh process cannot reacquire an existing exact original job marker', async () => {
  const frame = await fenceFrame(611), runtime = originalJobFixture(frame); reserveOriginalJob(frame, runtime);
  const fixture = join(runtime.temporary, 'fictional-native.json');
  writeFileSync(fixture, JSON.stringify({ frame, env: runtime.env, documents: runtime.documents }), { mode: 0o600 });
  const module = new URL('./native-application-job-fence.ts', import.meta.url).href;
  const program = `import {readFileSync} from 'node:fs';import {reserveOriginalJob} from ${JSON.stringify(module)};
    const f=JSON.parse(readFileSync(process.argv[1],'utf8'));
    const github={json(path){if(!(path in f.documents))throw Error('Unexpected path');return f.documents[path]},bytes(){throw Error('No downloads')}};
    try{reserveOriginalJob(f.frame,{env:f.env,github});process.stdout.write('UNSAFE_REISSUE')}catch(error){if(error.code!=='EEXIST')throw error;process.stdout.write('existing-job-refused')}`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', program, fixture], { env: { PATH: process.env.PATH }, timeout: 10000 }).toString(), 'existing-job-refused');
  assert.equal(JSON.parse(readFileSync(runtime.marker, 'utf8')).frame_sha256, digest(canonical(frame)));
});
test('empty torn directory, torn or conflicting marker, files and symlinks all permanently refuse', async () => {
  const frame = await fenceFrame(612);
  for (const kind of ['empty', 'torn', 'conflicting', 'file', 'symlink']) {
    const runtime = originalJobFixture(frame), directory = join(runtime.temporary, JOB_FENCE_DIRECTORY);
    if (kind === 'file') writeFileSync(directory, 'not a directory');
    else if (kind === 'symlink') symlinkSync(runtime.temporary, directory);
    else { mkdirSync(directory, { mode: 0o700 }); if (kind !== 'empty') writeFileSync(runtime.marker, kind === 'torn' ? '{' : JSON.stringify({ frame_sha256: '0'.repeat(64) })); }
    assert.throws(() => reserveOriginalJob(frame, runtime), /EEXIST/);
    assert.ok(lstatSync(directory)); // Refusal does not delete even malformed state.
  }
});
test('untrusted runner environment or replaced original native executor refuses before any marker', async () => {
  const frame = await fenceFrame(613);
  for (const patch of [{ GITHUB_JOB: 'scope' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_RUN_ID: '614' }, { GITHUB_REPOSITORY_ID: '42' },
    { GITHUB_WORKFLOW_SHA: 'f'.repeat(40) }, { GITHUB_REF_PROTECTED: 'false' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { RUNNER_TEMP: '/tmp/../tmp' }]) {
    const runtime = originalJobFixture(frame); Object.assign(runtime.env, patch);
    assert.throws(() => reserveOriginalJob(frame, runtime)); assert.equal(existsSync(runtime.marker), false);
  }
  for (const patch of [{ id: 503 }, { run_attempt: 2 }, { head_sha: 'f'.repeat(40) }, { status: 'completed', conclusion: 'success' }]) {
    const runtime = originalJobFixture(frame); Object.assign(runtime.job, patch);
    assert.throws(() => reserveOriginalJob(frame, runtime)); assert.equal(existsSync(runtime.marker), false);
  }
});
test('shared writable or symlinked RUNNER_TEMP cannot receive an execution fence', async () => {
  const frame = await fenceFrame(614), writable = originalJobFixture(frame); chmodSync(writable.temporary, 0o777);
  try { assert.throws(() => reserveOriginalJob(frame, writable), /permissions/); assert.equal(existsSync(writable.marker), false); }
  finally { chmodSync(writable.temporary, 0o700); }
  const linked = originalJobFixture(frame), path = linked.temporary + '-link'; fenceFixtureDirectories.push(path); symlinkSync(linked.temporary, path); linked.env.RUNNER_TEMP = path;
  assert.throws(() => reserveOriginalJob(frame, linked), /Symlinked/); assert.equal(existsSync(linked.marker), false);
});
test('harmless native progress is accepted but identity/status changes after marking retain a consumed hold', async () => {
  const frame = await fenceFrame(615);
  for (const change of ['metadata', 'identity', 'status', 'reader-error']) {
    const runtime = originalJobFixture(frame); let reads = 0;
    runtime.onRead(path => {
      if (path.endsWith('/runs/615') && ++reads === 2) {
        assert.ok(existsSync(runtime.marker));
        if (change === 'metadata') { Object.assign(runtime.run, { updated_at: '2026-11-14T13:00:00Z' }); Object.assign(runtime.job, { steps: [{ status: 'completed' }] }); }
        else if (change === 'identity') runtime.job.id++;
        else if (change === 'status') { runtime.job.status = 'completed'; runtime.job.conclusion = 'cancelled'; }
        else throw Error('Fictional native read lost');
      }
    });
    if (change === 'metadata') reserveOriginalJob(frame, runtime);
    else assert.throws(() => reserveOriginalJob(frame, runtime));
    assert.equal(JSON.parse(readFileSync(runtime.marker, 'utf8')).frame_sha256, digest(canonical(frame)));
    runtime.job.id = frame.executor!.job_id; runtime.job.status = 'in_progress'; runtime.job.conclusion = null;
    assert.throws(() => reserveOriginalJob(frame, runtime), /EEXIST/);
  }
});
test('execution cannot bypass the mandatory job fence with a matching claimed frame', async () => {
  const frame = await fenceFrame(616), runtime = originalJobFixture(frame);
  mkdirSync(join(runtime.temporary, JOB_FENCE_DIRECTORY), { mode: 0o700 });
  await assert.rejects(execution({ async readCurrent() { return frame; } }, { ...releasePhase, environment: 'staging', operation_id: OP }, frame.executor!, runtime), /EEXIST/);
  const noRuntime = { github: runtime.github, env: {} };
  await assert.rejects(execution({ async readCurrent() { return frame; } }, { ...releasePhase, environment: 'staging', operation_id: OP }, frame.executor!, noRuntime), /environment/);
});
test('two fresh original-job processes race for one durable marker and only one wins', async () => {
  const frame = await fenceFrame(617), runtime = originalJobFixture(frame), fixture = join(runtime.temporary, 'fictional-race.json');
  writeFileSync(fixture, JSON.stringify({ frame, env: runtime.env, documents: runtime.documents }), { mode: 0o600 });
  const module = new URL('./native-application-job-fence.ts', import.meta.url).href;
  const program = `import {readFileSync} from 'node:fs';import {reserveOriginalJob} from ${JSON.stringify(module)};
    const f=JSON.parse(readFileSync(process.argv[1],'utf8'));
    const github={json(path){if(!(path in f.documents))throw Error('Unexpected path');return f.documents[path]},bytes(){throw Error('No downloads')}};
    try{reserveOriginalJob(f.frame,{env:f.env,github});process.stdout.write('won')}catch(error){if(error.code!=='EEXIST')throw error;process.stdout.write('held')}`;
  const attempt = () => new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', program, fixture], { env: { PATH: process.env.PATH }, timeout: 10000 },
      (error, stdout) => { if (error) reject(error); else resolve(stdout); });
  });
  assert.deepEqual((await Promise.all([attempt(), attempt()])).sort(), ['held', 'won']);
  assert.equal(JSON.parse(readFileSync(runtime.marker, 'utf8')).frame_sha256, digest(canonical(frame)));
});
test('latest-only terminal lifecycle cannot claim through a stale in-progress attempt response', async () => {
  for (const conclusion of ['success', 'cancelled', 'failure', 'timed_out']) {
    const f = await coordinatorFixture();
    f.patch.latest = { status: 'completed', conclusion };
    await assert.rejects(f.coordinator().reconcile(f.intent), /latest\/attempt lifecycle disagrees/);
    assert.equal((f.store.slot.record as CoordinatorRecord).current.state, 'prepared');
    assert.equal(f.store.commits, 1); assert.equal(f.cloud.writes().length, 0);
  }
});
test('latest-only terminal change at the bookend prevents a stale original-job claim', async () => {
  const f = await coordinatorFixture(); let reads = 0;
  f.onRead(path => {
    if (path.endsWith('/runs/500') && ++reads === 2) f.patch.latest = { status: 'completed', conclusion: 'cancelled' };
  });
  await assert.rejects(f.coordinator().reconcile(f.intent), /latest\/attempt lifecycle disagrees/);
  assert.equal((f.store.slot.record as CoordinatorRecord).current.state, 'prepared');
  assert.equal(f.store.commits, 1); assert.equal(f.cloud.writes().length, 0);
});

test('release phase binds frame ACK and capability before any provider write', async () => {
  const f = await coordinatorFixture(950), prepared = f.intent.prepared, owner = { ...f.intent.original_run, job_id: f.job.id };
  const claimed = claimOperation(prepared, owner);
  for (const patch of [{ release_id: id(9) }, { phase: 'recovery' as const }, { phase: 'resume' as const }]) {
    assert.throws(() => recordAcknowledgement(claimed, { ...f.ack, ...patch }), /Acknowledgement differs/);
    await assert.rejects(execution({ async readCurrent() { return claimed; } },
      { ...releasePhase, environment: 'staging', operation_id: OP, ...patch }, owner), /claim differs/);
  }
  for (const phase of ['candidate', 'recovery', 'resume'] as const) {
    const selected = prepareOperation(f.journal, 'staging', { ...releasePhase, phase });
    assert.equal(selected.phase, phase);
    assert.throws(() => prepareOperation(f.journal, 'staging', { ...releasePhase, phase: 'predecessor' as never }));
  }
  assert.throws(() => coordinatorIntent(f.plan, f.journal, { ...releasePhase, phase: 'recovery' }), /differs/);
  const confirmedAsPrepared = structuredClone(prepared); confirmedAsPrepared.journal.operations[0] = { name: 'worker-upload', state: 'confirmed', native_id: C };
  assert.throws(() => claimOperation(confirmedAsPrepared, owner), /already confirmed/);
  assert.equal(f.cloud.writes().length, 0);
});
test('coordinator cannot advance an ACK into another release or phase even with identical journal bytes', async () => {
  const f = await nextCoordinatorFixture();
  for (const patch of [{ release_id: id(9) }, { phase: 'resume' as const }]) {
    const next = structuredClone(f.next);
    Object.assign(next, patch); Object.assign(next.prepared, patch); Object.assign(next.current, patch);
    const before = f.store.commits;
    await assert.rejects(f.coordinator().advanceOperation(next), /acknowledged predecessor/);
    assert.equal(f.store.commits, before);
  }
});

function descriptorFor(f: Awaited<ReturnType<typeof coordinatorFixture>>): SessionDescriptor {
  return { schema: 'attestrack.native-release-session/v1', release_id: releasePhase.release_id, environment: 'staging', original_run: f.plan.context,
    admission_sha256: digest(canonical(f.plan)), predecessor: { ...f.bundle.identity, artifact_id: 10 }, candidate: f.bundle.identity,
    recovery: { ...f.bundle.identity, artifact_id: 11, source_tree: 'c'.repeat(40), archive_sha256: 'c'.repeat(64) },
    target_sha256: f.journal.target_sha256, tool_profile_sha256: f.journal.tool_profile_sha256, http_target_sha256: f.plan.targets.http_sha256,
    persistence_contract_sha256: 'f'.repeat(64), required_operations: ['worker-upload', 'worker-switch', 'pages-assets', 'pages-deploy'],
    phase_operations: { candidate: OP, recovery: randomUUID(), resume: randomUUID() },
    witness: { cohort: randomUUID(), events: { predecessor: randomUUID(), candidate: randomUUID(), recovery: randomUUID(), resume: randomUUID() } } };
}
test('native session P observation and phase preparation use real existing writer reads with no reachable mutation', async () => {
  const f = await coordinatorFixture(960), d = descriptorFor(f), own = { ...f.plan.context, job_id: 970 };
  let bookends = 0;
  class FictionalIntakeReader extends NativeIntakeReader {
    constructor() { super({ store: { ...JOURNAL_STORES.staging, branch: 'release-ledger', genesis_head: '1'.repeat(40) },
      issuer: { schema: 'attestrack.native-journal-issuer/v2', repository: INFRA, repository_id: INFRA_ID, workflow: ISSUER_WORKFLOW,
        source_commit: '2'.repeat(40), workflow_blob: '3'.repeat(40), workflow_sha256: '4'.repeat(64), jobs: { ...ISSUER_JOBS } } },
      'staging', { run_id: 1, run_attempt: 1, job_id: 2, artifact_id: 3, source_commit: '2'.repeat(40) }); }
    override read(context: SessionContext) {
      assert.deepEqual(context, intakeContext(f.plan, 77));
      return { receipt: { schema: 'attestrack.native-release-intake/v1' as const, ...context,
        controller: { repository_id: INFRA_ID, workflow_commit: '2'.repeat(40), run_id: 1, run_attempt: 1 } },
        assertControllerActive() { bookends++; } };
    }
  }
  const intake = new FictionalIntakeReader();
  const predecessor = await observePredecessor(f.plan, own, f.cloud.target(), f.cloud, intake, 77);
  assert.equal(bookends, 1); assert.equal(predecessor.deployment_id, 77); assert.equal(predecessor.controller.run_id, 1);
  assert.deepEqual(predecessor.snapshot, f.journal.predecessor); assert.equal(predecessor.admission_sha256, digest(canonical(f.plan)));
  const prepared = await preparePhase(d, 'candidate', f.bundle, f.cloud.target(), f.cloud);
  assert.deepEqual(prepared, f.journal);
  const readback = await readbackPhase(d, 'predecessor', own, f.cloud.target(), f.cloud);
  assert.deepEqual(readback.snapshot, predecessor.snapshot); assert.deepEqual(readback.artifact, d.predecessor);
  await assert.rejects(preparePhase(d, 'recovery', f.bundle, f.cloud.target(), f.cloud), /selected phase/);
  await assert.rejects(observePredecessor(f.plan, { ...own, run_attempt: 2 }, f.cloud.target(), f.cloud, intake, 77), /admission/);
  await assert.rejects(readbackPhase(d, 'candidate', { ...own, run_id: 999 }, f.cloud.target(), f.cloud), /original app run/);
  assert.equal(f.cloud.writes().length, 0);
});
test('native observation adapter rejects methods, body and asset-token overrides before transport', async () => {
  let calls = 0;
  const adapter = readOnlyNative({ async request() { calls++; return {}; }, async page() { calls++; return { items: [], info: {} }; } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) await assert.rejects(adapter.request('/accounts/example', { method }), /refuses writes/);
  await assert.rejects(adapter.request('/accounts/example', { method: 'GET', body: 'payload' }), /payload/);
  await assert.rejects(adapter.request('/accounts/example', undefined, 'override'), /override/);
  assert.equal(calls, 0); await adapter.request('/accounts/example'); await adapter.page!('/accounts/example'); assert.equal(calls, 2);
});

test('provider role core rejects cloned retained bytes before fencing and reads provider material only after original-job consumption', async () => withRuntime(async tool => {
  const f = await coordinatorFixture(971), d = descriptorFor(f), own = { ...f.plan.context, job_id: f.job.id };
  const claimed = claimOperation(f.intent.prepared, own), runtime = originalJobFixture(claimed);
  // Deliberately fictional authenticated-reader seam for role ordering only.
  // The real native archive/source/current-head proof is exercised independently
  // by native-journal-projection.test.ts; this is not hosted qualification.
  class FictionalClaimReader extends NativeJournalProjectionReader {
    constructor() { super({ store: { ...JOURNAL_STORES.staging, branch: 'release-ledger', genesis_head: '1'.repeat(40) },
      issuer: { schema: 'attestrack.native-journal-issuer/v2', repository: INFRA, repository_id: INFRA_ID, workflow: ISSUER_WORKFLOW,
        source_commit: '2'.repeat(40), workflow_blob: '3'.repeat(40), workflow_sha256: '4'.repeat(64), jobs: { ...ISSUER_JOBS } } },
      'staging', { run_id: 1, run_attempt: 1, job_id: 2, artifact_id: 3, source_commit: '2'.repeat(40) }); }
    override async readCurrent() { return structuredClone(claimed); }
  }
  const reader = new FictionalClaimReader(), context = { ...releasePhase, environment: 'staging' as const, operation_id: OP };
  let acquired = 0;
  const acquire = async () => { acquired++; assert.equal(existsSync(runtime.marker), true); assert.equal(f.cloud.writes().length, 0); return f.cloud; };
  await assert.rejects(executePhaseOperation(d, context, own, structuredClone(f.bundle), tool, f.cloud.target(), reader, acquire, runtime), /Original native artifact admission/);
  assert.equal(existsSync(runtime.marker), false); assert.equal(acquired, 0);
  const ack = await executePhaseOperation(d, context, own, f.bundle, tool, f.cloud.target(), reader, acquire, runtime);
  assert.equal(ack.release_id, d.release_id); assert.equal(ack.phase, 'candidate'); assert.equal(ack.native_id, C);
  assert.equal(acquired, 1); assert.equal(f.cloud.writes().length, 1);
  await assert.rejects(executePhaseOperation(d, context, own, f.bundle, tool, f.cloud.target(), reader, acquire, runtime), /already issued/);
  assert.equal(acquired, 1); assert.equal(f.cloud.writes().length, 1);
}));
