import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkerEntry } from '../packages/deploy/src/worker-template.ts';
import { digest, fileBytes, inventory, publisherIdentity, REPOSITORY, type Payload } from './application-artifacts.ts';
import { inspect } from './application-witness.ts';
import { canonical, Cloudflare, NativeGitHub, NativeWriter, pagesConfiguration, readOriginal, targetIdentity, validateTarget, workerConfiguration,
  type Bundle, type GitHubRead, type Journal, type NativeHTTP, type Target } from './native-application-release.ts';
import { loadTool } from './native-release-tool.ts';
import { upstreamTool } from './native-release-tool.test.ts';
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const W = id(1), P = id(2), C = id(3), DP = id(4), DC = id(5), PG = id(6), PP = id(7), PC = id(8);
const source = 'a'.repeat(40), tree = 'b'.repeat(40);
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
  latest = P; active = P; deployment = DP; pages = PP; failPages = false; corruptModule = false;
  worker: Record<string, unknown> = { id: W, name: 'fictional-worker', logpush: false, observability: {}, tags: [], tail_consumers: [], subdomain: {}, references: {} };
  bindings = [{ name: 'ATTESTRACK_KV', type: 'kv_namespace', namespace_id: 'c'.repeat(32) }, { name: 'CONSENT_TOKEN_SECRET', type: 'secret_text' }, { name: 'SITE_ID', type: 'plain_text', text: 'fictional-site' }];
  project: Record<string, unknown> = { id: PG, name: 'fictional-portal', production_branch: 'main', source: null, build_config: {}, deployment_configs: { production: {}, preview: {} }, domains: [] };
  versions = new Map([[P, { id: P, number: 1, main_module: 'index.js', compatibility_date: '2024-12-01', compatibility_flags: [], bindings: this.bindings,
    modules: [{ name: 'index.js', content_type: 'application/javascript+module', content_base64: Buffer.from('previous').toString('base64') }] }]]);
  before: ((path: string, init: RequestInit) => void) | null = null;
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
      if (init.method === 'POST') { this.active = C; this.deployment = DC; return { id: DC }; }
      return { deployments: [{ id: this.deployment, versions: [{ version_id: this.active, percentage: 100 }] }] };
    }
    if (path.endsWith('/pages/projects/fictional-portal')) return { ...structuredClone(this.project), canonical_deployment: { id: this.pages } };
    if (path.endsWith('/upload-token')) return { jwt: 'fictional-assets-token' };
    if (path.startsWith('/pages/assets/')) { assert.equal(jwt, 'fictional-assets-token'); return {}; }
    if (path.endsWith('/fictional-portal/deployments') && init.method === 'POST') {
      if (this.failPages) throw new Error('Fictional Pages ambiguous dispatch');
      assert.ok(init.body instanceof FormData); assert.equal(init.body.get('commit_hash'), source);
      this.pages = PC; return { id: PC };
    }
    if (path.includes('/fictional-portal/deployments/')) return { id: path.split('/').at(-1), project_id: PG, project_name: 'fictional-portal', environment: 'production', is_skipped: false,
      latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { branch: 'main', commit_hash: source } } };
    throw new Error(`Unrecognized fictional native endpoint ${path}`);
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
  const previous = await writer.observe(); const result = await writer.deploy(bundle, previous, tool, { async append(r) { records.push(r); } });
  assert.equal(result.after!.worker.version_id, C); assert.equal(result.after!.pages!.deployment_id, PC);
  assert.deepEqual(result.artifact, bundle.identity); assert.equal(result.target_sha256, targetIdentity(cloud.target()));
  assert.equal(result.operations.length, 4); assert.ok(result.operations.every(o => o.state === 'confirmed'));
  const upload = JSON.parse(cloud.writes()[0].init.body as string);
  assert.equal(upload.modules[0].content_base64, bundle.payload.files.find(f => f.path === 'worker/index.js')!.base64);
  assert.equal(cloud.writes()[1].path.endsWith('/deployments'), true);
  const assets = cloud.writes().filter(c => c.path === '/pages/assets/upload').flatMap(c => JSON.parse(c.init.body as string));
  for (const asset of assets) assert.ok(bundle.payload.files.some(f => f.path.startsWith('portal/') && f.base64 === asset.value));
  assert.ok(records.some(r => r.operations.at(-1)?.name === 'worker-switch' && r.operations.at(-1)?.state === 'unknown'));
  assert.equal(JSON.stringify(result).includes('fictional-assets-token'), false);
  assert.equal(JSON.stringify(result).includes('accepted'), false);
}));
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
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { async append() {} })); assert.equal(cloud.writes().length, 0);
}));
test('unadmitted or mutated application bytes and invalid Pages controls cannot reach provider writes', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe();
  const bundle = nativeInput().bundle();
  await assert.rejects(() => writer.deploy(structuredClone(bundle) as Bundle, p, tool, { async append() {} }), /admission/);
  bundle.payload.files[0].base64 = '';
  await assert.rejects(() => writer.deploy(bundle, p, tool, { async append() {} }), /drifted/);
  const raw = input(); raw.files.push(fileBytes('portal/_worker.js', Buffer.from('forbidden function'))); raw.files.sort((a, b) => a.path.localeCompare(b.path)); raw.inventory_sha256 = inventory(raw.files);
  await assert.rejects(() => writer.deploy(nativeInput(raw).bundle(), p, tool, { async append() {} }), /control file/);
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
    await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { async append() {} }));
    assert.equal(cloud.writes().filter(c => c.path.endsWith('/deployments')).length, 0); assert.equal(cloud.active, P);
  }
}));
test('Worker success/Pages unknown preserves partial journal; no hidden automatic rollback/replay', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe(); cloud.failPages = true;
  const records: Journal[] = [];
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { async append(r) { records.push(r); } }), /ambiguous/);
  assert.equal(cloud.active, C); const last = records.at(-1)!;
  assert.equal(last.operations.at(-1)!.name, 'pages-deploy'); assert.equal(last.operations.at(-1)!.state, 'unknown');
  assert.equal(last.after!.worker.version_id, C); assert.equal(cloud.writes().filter(c => c.path.endsWith('/fictional-portal/deployments')).length, 1);
  // Replaying the stale predecessor cannot overwrite the confirmed Worker or a newer revision.
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { async append() {} }), /predecessor changed/);
}));
test('journal durability failure before dispatch prevents mutation; fixed target rejects unsupported topology', async () => withRuntime(async tool => {
  const cloud = new FictionalCloudflare(), writer = new NativeWriter(cloud.target(), cloud), p = await writer.observe(); let writes = 0;
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, tool, { async append() { if (++writes === 2) throw new Error('durability failed'); } }), /durability/);
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
  await assert.rejects(() => writer.deploy(nativeInput().bundle(), p, { hash: () => Buffer.alloc(32), assertUnchanged() {} }, { async append() {} }), /Pinned uploader/);
  assert.equal(cloud.writes().length, 0);
  const t = cloud.target(); t.worker.bindings = t.worker.bindings.map(b => b.name === 'ATTESTRACK_KV' ? { name: b.name, type: 'secret_text' } : b);
  assert.throws(() => validateTarget(t), /required binding type/);
});
test('actual native GitHub CLI reader accepts its exact repository root and rejects foreign reads before child dispatch', () => {
  const d = mkdtempSync(join(tmpdir(), 'attestrack-native-gh-'));
  try {
    writeFileSync(join(d, 'gh'), `#!${process.execPath}\nif(process.argv[2]!=='api'||process.argv[3]!==${JSON.stringify(`repos/${REPOSITORY}`)})throw Error('wrong native path');process.stdout.write('{"id":41}');\n`, { mode: 0o755 });
    const source = new URL('./native-application-release.ts', import.meta.url).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import {NativeGitHub} from ${JSON.stringify(source)};console.log(JSON.stringify(new NativeGitHub().json(${JSON.stringify(`repos/${REPOSITORY}`)})))`],
      { env: { PATH: d }, timeout: 10000 });
    assert.equal(JSON.parse(output.toString()).id, 41);
    assert.throws(() => new NativeGitHub().json('repos/foreign/attestrack'), /Foreign/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
