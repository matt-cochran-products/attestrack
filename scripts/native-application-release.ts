/** Native byte writer, not release/acceptance/recovery authorization. No implicit target or CLI. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { completeNativeList, requireNativeJobs, validate, verifyStagingPr,
  type NativeArtifact, type NativeJob, type PullRequest, type Run } from '../.github/actions/retained-build/retained-build.ts';
import { digest, PUBLISHER_FILES, publisherIdentity, REPOSITORY, validateContent, validateOrigin, verifiedDocument, type Payload } from './application-artifacts.ts';
import { assetHash, requireTool, TOOL_PROFILE, type loadTool } from './native-release-tool.ts';

type ObjectValue = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[a-f0-9]{32}$/, NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const resourceId = (s: string) => UUID.test(s) || ID.test(s);
const object = (x: unknown): ObjectValue => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Invalid native object'); return x as ObjectValue; };
const string = (x: unknown): string => { if (typeof x !== 'string') throw new Error('Missing native string'); return x; };
const uuid = (x: unknown): string => { const s = string(x); if (!UUID.test(s)) throw new Error('Invalid native UUID'); return s; };
const array = (x: unknown): unknown[] => { if (!Array.isArray(x)) throw new Error('Invalid native list'); return x; };
const positive = (x: unknown): number => { if (!Number.isSafeInteger(x) || Number(x) <= 0) throw new Error('Invalid native integer'); return Number(x); };
const same = (a: unknown, b: unknown, reason: string) => { if (canonical(a) !== canonical(b)) throw new Error(reason); };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as ObjectValue)[k])).join(',') + '}';
  return JSON.stringify(value);
}
function closed(v: unknown, keys: string[]): ObjectValue {
  const o = object(v); same(Object.keys(o).sort(), keys.sort(), 'Nonclosed release input'); return o;
}
export interface ArtifactIdentity { artifact_id: number; producer_run: number; producer_attempt: number; archive_sha256: string; inventory_sha256: string; source_tree: string }
export interface GitHubRead { json<T>(path: string): T; bytes(path: string): Buffer }
/** Existing gh custody; this class is used only by a trusted admission job, not browser code. */
export class NativeGitHub implements GitHubRead {
  bytes(path: string): Buffer {
    if (path !== `repos/${REPOSITORY}` && !path.startsWith(`repos/${REPOSITORY}/`)) throw new Error('Foreign native GitHub read');
    return execFileSync('gh', ['api', path], { timeout: 30000, maxBuffer: 96 * 1024 * 1024 });
  }
  json<T>(path: string): T { return JSON.parse(this.bytes(path).toString()); }
}
export interface Bundle { readonly payload: Payload; readonly identity: ArtifactIdentity }
const admittedBundles = new WeakMap<Bundle, string>();
function originalBlob(reader: GitHubRead, sha: string, path: string): Buffer {
  const r = object(reader.json(`repos/${REPOSITORY}/contents/${path}?ref=${sha}`));
  if (r.type !== 'file' || r.path !== path || r.encoding !== 'base64' || r.submodule_git_url != null
      || !Number.isSafeInteger(r.size) || Number(r.size) < 0 || Number(r.size) > 2 * 1024 * 1024) throw new Error('Missing bounded original source blob');
  const encoded = string(r.content).replace(/\n/g, ''), bytes = Buffer.from(encoded, 'base64');
  if (encoded.length > 3 * 1024 * 1024 || bytes.toString('base64') !== encoded || bytes.length !== r.size
      || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== r.sha) throw new Error('Original native Git blob identity mismatch');
  return bytes;
}
function originalInputs(reader: GitHubRead, payload: Payload, identity: ArtifactIdentity): void {
  const policy = object(JSON.parse(readFileSync(new URL('../release/application-publishers.json', import.meta.url), 'utf8')));
  closed(policy, ['schema', 'implementations', 'legacy']);
  if (policy.schema !== 'attestrack.application-publishers/v1') throw new Error('Unreviewed publisher policy');
  const sourceSha = payload.producer.source_sha;
  const recipe = publisherIdentity(path => originalBlob(reader, sourceSha, path));
  const implementation = object(object(policy.implementations)[recipe.sha256]);
  closed(implementation, ['schema', 'files']);
  same(implementation.files, recipe.files, 'Unreviewed original publisher implementation');
  same(Object.keys(object(implementation.files)).sort(), [...PUBLISHER_FILES].sort(), 'Incomplete original publisher closure');
  const lock = originalBlob(reader, sourceSha, 'pnpm-lock.yaml'), template = originalBlob(reader, sourceSha, 'packages/deploy/src/worker-template.ts');
  if (digest(lock) !== payload.build.lock_sha256) throw new Error('Original native lock mismatch');
  if (payload.schema === 'attestrack.application-bytes/v2') {
    if (implementation.schema !== 2 || recipe.sha256 !== payload.build.publisher_sha256 || digest(template) !== payload.build.template_sha256) throw new Error('Original v2 source/template/recipe mismatch');
    // validateContent verified actual retained entry bytes, digest and inventory. The
    // reviewed publisher compiles exactly this buffer; no candidate code is evaluated here.
  } else {
    if (implementation.schema !== 1) throw new Error('Unsupported legacy publisher');
    const matches = array(policy.legacy).filter(raw => {
      const entry = closed(raw, ['artifact', 'source_sha', 'publisher_sha256', 'template_sha256', 'entry_sha256']);
      closed(entry.artifact, ['artifact_id', 'producer_run', 'producer_attempt', 'archive_sha256', 'inventory_sha256', 'source_tree']);
      return canonical(entry.artifact) === canonical(identity) && entry.source_sha === sourceSha
        && entry.publisher_sha256 === recipe.sha256 && entry.template_sha256 === digest(template) && entry.entry_sha256 === payload.build.entry_sha256;
    });
    if (matches.length !== 1) throw new Error('Historical generated entry requires explicit original proof or new qualification');
  }
}
/** Re-authenticate original native run/jobs/artifact/source2 before handing bytes to a writer. */
export function readOriginal(reader: GitHubRead, runId: number, artifactId: number, tree: string): Bundle {
  positive(runId); positive(artifactId); if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('Invalid expected complete tree');
  const p = `repos/${REPOSITORY}`; const repository = reader.json<{ id: number }>(p); positive(repository.id);
  const run = reader.json<Run>(`${p}/actions/runs/${runId}`);
  const list = <T extends { id: number }>(path: string, field: string): T[] => completeNativeList<T>(page => {
    const r = reader.json<ObjectValue>(`${path}?per_page=100&page=${page}`); return { total_count: r.total_count as number, items: r[field] as T[] };
  });
  const jobs = (r: Run, names: string[]) => requireNativeJobs(list<NativeJob>(`${p}/actions/runs/${r.id}/attempts/${positive(r.run_attempt)}/jobs`, 'jobs'), r, names);
  jobs(run, ['scope', 'staging-build']);
  const matches = list<NativeArtifact>(`${p}/actions/runs/${runId}/artifacts`, 'artifacts').filter(a => a.name === `attestrack-application-${run.run_attempt}`);
  if (matches.length !== 1 || matches[0].id !== artifactId) throw new Error('Missing or ambiguous original application artifact');
  const a = matches[0], bytes = reader.bytes(`${p}/actions/artifacts/${artifactId}/zip`);
  const payload = validateOrigin(verifiedDocument(a, run, repository.id, a.name, bytes, 'application.json'), run, repository.id, tree);
  if (reader.json<{ tree: { sha: string } }>(`${p}/git/commits/${payload.producer.source_sha}`).tree.sha !== tree) throw new Error('Original producer tree mismatch');
  const s = payload.source, sr = reader.json<Run>(`${p}/actions/runs/${s.run_id}`);
  validate(s, sr, REPOSITORY, 'ci.yml', tree);
  jobs(sr, ['resolve', 'checks / ci', 'checks / warehouse', 'checks / e2e / e2e', 'checks / Build gate', 'Build gate']);
  if (s.schema !== 2 || !s.pull_request || s.pull_request.base_repo_id !== repository.id) throw new Error('Recorded source2 provenance required');
  verifyStagingPr(s, sr, REPOSITORY, [reader.json<PullRequest>(`${p}/pulls/${s.pull_request.number}`)]);
  if (reader.json<{ tree: { sha: string } }>(`${p}/git/commits/${s.built_sha}`).tree.sha !== tree) throw new Error('Original source tree mismatch');
  const bundle: Bundle = { payload, identity: { artifact_id: a.id, producer_run: run.id, producer_attempt: run.run_attempt,
    archive_sha256: a.digest.slice('sha256:'.length), inventory_sha256: payload.inventory_sha256, source_tree: tree } };
  originalInputs(reader, payload, bundle.identity);
  admittedBundles.set(bundle, digest(canonical(bundle))); return bundle;
}
export interface Target {
  environment: 'staging' | 'production'; account_id: string;
  worker: { id: string; name: string; bindings: Binding[]; configuration_sha256: string };
  pages: { id: string; name: string; production_branch: string; configuration_sha256: string } | null;
}
export type Binding = { name: string; type: 'secret_text' } | { name: string; type: 'plain_text'; text: string }
  | { name: string; type: 'kv_namespace'; namespace_id: string } | { name: string; type: 'vpc_service'; service_id: string };
export function validateTarget(raw: unknown): Target {
  const t = closed(raw, ['environment', 'account_id', 'worker', 'pages']);
  const w = closed(t.worker, ['id', 'name', 'bindings', 'configuration_sha256']);
  if (!['staging', 'production'].includes(string(t.environment)) || !ID.test(string(t.account_id))
      || !resourceId(string(w.id)) || !NAME.test(string(w.name)) || !HASH.test(string(w.configuration_sha256))) throw new Error('Unconfigured or invalid existing Worker target');
  const bs = array(w.bindings); if (bs.length < 3 || bs.length > 100) throw new Error('Invalid reviewed bindings');
  const names = new Set<string>();
  for (const b of bs) {
    const o = object(b); const type = string(o.type); const n = string(o.name);
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(n) || names.has(n)) throw new Error('Invalid or duplicate binding'); names.add(n);
    const keys = type === 'secret_text' ? ['name', 'type'] : type === 'plain_text' ? ['name', 'type', 'text'] : type === 'kv_namespace' ? ['name', 'type', 'namespace_id'] : type === 'vpc_service' ? ['name', 'type', 'service_id'] : [];
    closed(o, keys);
    if (type === 'plain_text' && (n !== 'SITE_ID' || !/^[A-Za-z0-9_-]{1,128}$/.test(string(o.text)))) throw new Error('Unexpected runtime variable');
    if (type === 'kv_namespace' && (n !== 'ATTESTRACK_KV' || !ID.test(string(o.namespace_id)))) throw new Error('Unexpected KV binding');
    if (type === 'vpc_service' && (n !== 'CLICKHOUSE_PRIVATE' || !UUID.test(string(o.service_id)))) throw new Error('Unexpected private service');
  }
  for (const n of ['SITE_ID', 'ATTESTRACK_KV', 'CONSENT_TOKEN_SECRET']) if (!names.has(n)) throw new Error('Missing existing binding');
  for (const [n, type] of [['SITE_ID', 'plain_text'], ['ATTESTRACK_KV', 'kv_namespace'], ['CONSENT_TOKEN_SECRET', 'secret_text']]) {
    if (!bs.some(b => object(b).name === n && object(b).type === type)) throw new Error('Wrong required binding type');
  }
  if (t.pages !== null) {
    const pg = closed(t.pages, ['id', 'name', 'production_branch', 'configuration_sha256']);
    if (!UUID.test(string(pg.id)) || !NAME.test(string(pg.name)) || !/^[A-Za-z0-9/_-]{1,100}$/.test(string(pg.production_branch))
        || !HASH.test(string(pg.configuration_sha256))) throw new Error('Invalid existing Pages target');
  }
  return structuredClone(t) as unknown as Target;
}
export const targetIdentity = (t: Target): string => digest(canonical(validateTarget(t)));

export interface NativeHTTP { request(path: string, init?: RequestInit, assetToken?: string): Promise<unknown> }
/** Future OPV child supplies token via run-only custody; never forwarded to hosted probes. */
export class Cloudflare implements NativeHTTP {
  #token: string;
  #deadline = AbortSignal.timeout(10 * 60 * 1000);
  constructor(token: string) { if (!token || /[\r\n]/.test(token)) throw new Error('Missing provider credential'); this.#token = token; }
  async request(path: string, init: RequestInit = {}, assetToken?: string): Promise<unknown> {
    if (!/^\/(accounts\/[a-f0-9]{32}\/(workers|pages)\/|pages\/assets\/)/.test(path) || path.includes('..')) throw new Error('Forbidden provider endpoint');
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, redirect: 'error',
      headers: { ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${assetToken ?? this.#token}` }, signal: AbortSignal.any([this.#deadline, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw new Error(`Native Cloudflare HTTP ${response.status}`);
    const reader = response.body!.getReader(); const parts: Buffer[] = []; let size = 0;
    for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 96 * 1024 * 1024) { await reader.cancel(); throw new Error('Native response too large'); } parts.push(Buffer.from(r.value)); }
    const r = object(JSON.parse(Buffer.concat(parts).toString()));
    if (r.success !== true || !Array.isArray(r.errors) || r.errors.length) throw new Error('Native Cloudflare request refused');
    return r.result;
  }
}
export interface Snapshot {
  worker: { deployment_id: string; version_id: string; latest_version_id: string; configuration_sha256: string; version_configuration_sha256: string; module_sha256: string };
  pages: { deployment_id: string; configuration_sha256: string } | null;
}
function bindings(raw: unknown): Binding[] {
  return array(raw).map(b => {
    const o = object(b), type = string(o.type), name = string(o.name);
    if (type === 'secret_text') { if ('text' in o || 'value' in o) throw new Error('Unexpected secret readback'); return { type, name }; }
    if (type === 'plain_text') return { type, name, text: string(o.text) };
    if (type === 'kv_namespace') return { type, name, namespace_id: string(o.namespace_id) };
    if (type === 'vpc_service') return { type, name, service_id: string(o.service_id) };
    throw new Error('Unsupported existing binding');
  }).sort((a, b) => a.name.localeCompare(b.name));
}
const sortedBindings = (b: Binding[]) => [...b].sort((a, b) => a.name.localeCompare(b.name));
function moduleHash(v: ObjectValue): string {
  const modules = array(v.modules); if (modules.length !== 1) throw new Error('Unsupported existing module topology');
  const m = object(modules[0]); const bytes = Buffer.from(string(m.content_base64), 'base64');
  if (v.main_module !== 'index.js' || m.name !== 'index.js' || m.content_type !== 'application/javascript+module'
      || bytes.toString('base64') !== m.content_base64) throw new Error('Invalid native module readback');
  return digest(bytes);
}
function runtime(v: ObjectValue): ObjectValue {
  if (v.compatibility_date !== '2024-12-01' || array(v.compatibility_flags).length) throw new Error('Unsupported Worker runtime settings');
  for (const k of ['assets', 'containers', 'migrations', 'migration_tag']) if (v[k] != null && (typeof v[k] !== 'object' || Object.keys(v[k] as object).length)) throw new Error('Unsupported Worker state/assets topology');
  if (v.exports != null) {
    const e = object(v.exports); same(Object.keys(e), ['default'], 'Unsupported Worker exports');
    same(e.default, { type: 'worker' }, 'Unsupported Worker export settings');
  }
  const r: ObjectValue = { compatibility_date: v.compatibility_date, compatibility_flags: v.compatibility_flags };
  for (const k of ['limits', 'placement', 'usage_model']) if (v[k] != null) r[k] = v[k];
  return r;
}
/** Public configuration only; never journal raw provider replies or runtime secret values. */
export function workerConfiguration(worker: ObjectValue): string {
  const keys = ['logpush', 'observability', 'tags', 'tail_consumers', 'subdomain', 'references'];
  for (const k of keys) if (!(k in worker)) throw new Error('Incomplete native Worker configuration');
  return digest(canonical(Object.fromEntries(keys.map(k => [k, worker[k]]))));
}
export function pagesConfiguration(project: ObjectValue): string {
  // Direct Upload only. No inherited Git build commands or Pages Functions.
  if (project.source != null || !project.deployment_configs || !project.build_config) throw new Error('Unsupported existing Pages topology');
  const c = object(project.build_config);
  if (c.build_command || c.destination_dir || c.root_dir || c.web_analytics_tag || c.web_analytics_token) throw new Error('Pages build/analytics configuration requires separate review');
  const dc = object(project.deployment_configs);
  // No secret/config writes: portal is static. Refuse a project with Functions/runtime bindings.
  for (const env of ['production', 'preview']) {
    const e = object(dc[env]);
    for (const [k, v] of Object.entries(e)) if (k !== 'compatibility_date' && k !== 'compatibility_flags' && v != null
        && (!(typeof v === 'object') || Object.keys(v).length)) throw new Error('Unsupported Pages runtime configuration');
  }
  return digest(canonical({ production_branch: project.production_branch, build_config: c, deployment_configs: dc, domains: project.domains }));
}
export class NativeWriter {
  #http: NativeHTTP; #target: Target;
  get target(): Target { return structuredClone(this.#target); }
  constructor(target: Target, http: NativeHTTP) { this.#target = validateTarget(target); this.#http = http; }
  #worker = () => `/accounts/${this.target.account_id}/workers/workers/${this.target.worker.id}`;
  #script = () => `/accounts/${this.target.account_id}/workers/scripts/${this.target.worker.name}`;
  #pages = () => `/accounts/${this.target.account_id}/pages/projects/${this.target.pages!.name}`;
  async #version(id: string): Promise<ObjectValue> {
    const v = object(await this.#http.request(`${this.#worker()}/versions/${uuid(id)}?include=modules`));
    if (uuid(v.id) !== id || !Number.isSafeInteger(v.number)) throw new Error('Native version identity mismatch');
    same(bindings(v.bindings), sortedBindings(this.target.worker.bindings), 'Existing runtime binding drift');
    runtime(v);
    return v;
  }
  async #project(): Promise<ObjectValue> {
    const p = object(await this.#http.request(this.#pages())); const t = this.target.pages!;
    if (uuid(p.id) !== t.id || p.name !== t.name || p.production_branch !== t.production_branch
        || pagesConfiguration(p) !== t.configuration_sha256) throw new Error('Existing Pages identity/config drift');
    return p;
  }
  async observe(): Promise<Snapshot> {
    const worker = object(await this.#http.request(this.#worker()));
    if (worker.id !== this.target.worker.id || worker.name !== this.target.worker.name
        || workerConfiguration(worker) !== this.target.worker.configuration_sha256) throw new Error('Existing Worker identity/config drift or unsupported legacy Worker');
    const deployment = object(array(object(await this.#http.request(`${this.#script()}/deployments`)).deployments)[0]);
    const versions = array(deployment.versions); if (versions.length !== 1) throw new Error('Mixed Worker traffic is unsupported');
    const active = object(versions[0]); if (active.percentage !== 100) throw new Error('Nonexclusive active Worker version');
    const version = await this.#version(uuid(active.version_id));
    const latest = array(object(await this.#http.request(`${this.#script()}/versions?per_page=1&page=1`)).items);
    if (latest.length !== 1) throw new Error('Missing latest native Worker version');
    const latestId = uuid(object(latest[0]).id);
    // Refuse abandoned/unreviewed uploads rather than let implicit latest secrets enter the release.
    if (latestId !== active.version_id) throw new Error('Active/latest Worker version disagreement');
    let pages: Snapshot['pages'] = null;
    if (this.target.pages) {
      const project = await this.#project(), current = object(project.canonical_deployment);
      const p = await this.#pagesDeployment(uuid(current.id));
      pages = { deployment_id: uuid(p.id), configuration_sha256: this.target.pages.configuration_sha256 };
    }
    return { worker: { deployment_id: uuid(deployment.id), version_id: uuid(version.id), latest_version_id: latestId,
      configuration_sha256: this.target.worker.configuration_sha256, version_configuration_sha256: digest(canonical(runtime(version))), module_sha256: moduleHash(version) }, pages };
  }
  async #pagesDeployment(id: string): Promise<ObjectValue> {
    const p = object(await this.#http.request(`${this.#pages()}/deployments/${uuid(id)}`)); const t = this.target.pages!;
    if (p.id !== id || p.project_id !== t.id || p.project_name !== t.name || p.environment !== 'production'
        || p.is_skipped !== false || object(p.latest_stage).name !== 'deploy' || object(p.latest_stage).status !== 'success'
        || object(object(p.deployment_trigger).metadata).branch !== t.production_branch) throw new Error('Pages is not a successful canonical production deployment');
    return p;
  }
  async #unchanged(expected: Snapshot): Promise<void> { same(await this.observe(), expected, 'Native predecessor changed'); }
  /** No retry or automatic rollback after an unknown write. Caller must retain journal durably. */
  async deploy(bundle: Bundle, expectedPredecessor: Snapshot, tool: ReturnType<typeof loadTool>, journal: JournalSink): Promise<Journal> {
    if (!admittedBundles.has(bundle) || admittedBundles.get(bundle) !== digest(canonical(bundle))) throw new Error('Original native artifact admission required or admitted bytes drifted');
    const predecessor = structuredClone(expectedPredecessor);
    const raw = validateContent(structuredClone(bundle.payload));
    // Detect mutation of admitted bytes/identity before dispatch; no materialized directory can replace them.
    same(bundle.identity, { artifact_id: bundle.identity.artifact_id, producer_run: raw.producer.run_id, producer_attempt: raw.producer.run_attempt,
      archive_sha256: bundle.identity.archive_sha256, inventory_sha256: raw.inventory_sha256, source_tree: raw.producer.tree }, 'Admitted artifact drift');
    requireTool(tool);
    // Complete deterministic preflight before ANY mutation, including unsupported static controls.
    const manifest: Record<string, string> = {}, assets: { key: string; value: string; metadata: { contentType: string }; base64: true }[] = [];
    if (this.target.pages) for (const f of raw.files.filter(f => f.path.startsWith('portal/'))) {
      const path = f.path.slice(7), type = contentType(path), key = assetHash(tool, path, Buffer.from(f.base64, 'base64'));
      manifest[`/${path}`] = key; assets.push({ key, value: f.base64, metadata: { contentType: type }, base64: true });
    }
    const r: Journal = { schema: 'attestrack.native-write-journal/v1', artifact: structuredClone(bundle.identity), target_sha256: targetIdentity(this.target), tool_profile_sha256: TOOL_PROFILE,
      predecessor: structuredClone(predecessor), operations: [], after: null };
    const save = async () => { await journal.append(structuredClone(r)); };
    await this.#unchanged(predecessor); await save();
    const operation = async <T>(name: Operation['name'], action: () => Promise<T>, identity: (r: T) => string): Promise<T> => {
      const op: Operation = { name, state: 'unknown', native_id: null }; r.operations.push(op);
      // Write-ahead unknown record must be durable BEFORE dispatch. Crashes cannot turn it into a safe retry.
      await save(); const result = await action(); op.native_id = identity(result); op.state = 'confirmed'; await save(); return result;
    };
    const workerFile = raw.files.find(f => f.path === 'worker/index.js')!;
    const priorVersion = await this.#version(predecessor.worker.version_id);
    if (digest(canonical(runtime(priorVersion))) !== predecessor.worker.version_configuration_sha256) throw new Error('Predecessor runtime settings changed');
    const uploaded = object(await operation('worker-upload', () => this.#http.request(`${this.#worker()}/versions?deploy=false`, { method: 'POST', body: JSON.stringify({
      main_module: 'index.js', ...runtime(priorVersion),
      bindings: this.target.worker.bindings.map(b => b.type === 'secret_text' ? { name: b.name, type: 'inherit', version_id: predecessor.worker.version_id } : b),
      modules: [{ name: 'index.js', content_type: 'application/javascript+module', content_base64: workerFile.base64 }],
    }) }), x => uuid(object(x).id)));
    const versionId = uuid(uploaded.id), native = await this.#version(versionId);
    if (moduleHash(native) !== workerFile.sha256) throw new Error('Uploaded native module differs from retained bytes');
    same(runtime(native), runtime(priorVersion), 'Uploaded runtime settings differ from predecessor');
    // Upload itself changes latest but must NOT change active traffic/config/pages.
    const ready = await this.#observeAfterUpload(versionId, predecessor);
    const switched = object(await operation('worker-switch', () => this.#http.request(`${this.#script()}/deployments`, { method: 'POST', body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }] }) }), x => uuid(object(x).id)));
    const active = await this.observe();
    if (active.worker.deployment_id !== switched.id || active.worker.version_id !== versionId || active.worker.module_sha256 !== workerFile.sha256) throw new Error('Worker serving readback mismatch');
    same(active.pages, ready.pages, 'Pages changed during Worker switch');
    r.after = active; await save();
    if (this.target.pages) {
      // A short-lived native token is for asset API only; not persisted in output or passed to browser.
      const jwt = string(object(await this.#http.request(`${this.#pages()}/upload-token`)).jwt);
      if (!jwt || /[\r\n]/.test(jwt)) throw new Error('Missing native Pages upload token');
      await operation('pages-assets', async () => {
        for (const a of assets) await this.#http.request('/pages/assets/upload', { method: 'POST', body: JSON.stringify([a]) }, jwt);
        await this.#http.request('/pages/assets/upsert-hashes', { method: 'POST', body: JSON.stringify({ hashes: [...new Set(Object.values(manifest))] }) }, jwt);
        return 'uploaded';
      }, () => digest(canonical(manifest)));
      await this.#unchanged(active); tool.assertUnchanged();
      const form = new FormData(); form.set('manifest', JSON.stringify(manifest)); form.set('branch', this.target.pages.production_branch);
      form.set('commit_hash', raw.producer.source_sha); form.set('commit_dirty', 'false');
      const result = object(await operation('pages-deploy', () => this.#http.request(`${this.#pages()}/deployments`, { method: 'POST', body: form }), x => uuid(object(x).id)));
      const id = uuid(result.id); let successful = false;
      for (let i = 0; i < 20; i++) {
        const p = object(await this.#http.request(`${this.#pages()}/deployments/${id}`)); const status = object(p.latest_stage).status;
        if (status === 'failure' || status === 'canceled') throw new Error('Native Pages deployment failed');
        if (status === 'success' && object(p.latest_stage).name === 'deploy') {
          await this.#pagesDeployment(id);
          if (object(object(p.deployment_trigger).metadata).commit_hash !== raw.producer.source_sha) throw new Error('Pages deployment source metadata drift');
          successful = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!successful) throw new Error('Native Pages completion unknown');
      const final = await this.observe();
      if (final.pages?.deployment_id !== id) throw new Error('Pages canonical serving identity mismatch');
      same(final.worker, active.worker, 'Worker changed during Pages deployment');
      r.after = final; await save();
    }
    tool.assertUnchanged(); return r;
  }
  async #observeAfterUpload(id: string, before: Snapshot): Promise<Snapshot> {
    // Temporarily observe active independently of latest, then require latest EXACT uploaded version.
    const d = object(array(object(await this.#http.request(`${this.#script()}/deployments`)).deployments)[0]);
    same(d.versions, [{ version_id: before.worker.version_id, percentage: 100 }], 'Active traffic changed during upload');
    if (uuid(d.id) !== before.worker.deployment_id) throw new Error('Newer Worker deployment appeared');
    const w = object(await this.#http.request(this.#worker()));
    if (w.id !== this.target.worker.id || w.name !== this.target.worker.name || workerConfiguration(w) !== before.worker.configuration_sha256) throw new Error('Worker settings changed during upload');
    const latest = array(object(await this.#http.request(`${this.#script()}/versions?per_page=1&page=1`)).items);
    if (latest.length !== 1 || object(latest[0]).id !== id) throw new Error('Newer Worker upload appeared');
    const prior = await this.#version(before.worker.version_id);
    if (digest(canonical(runtime(prior))) !== before.worker.version_configuration_sha256) throw new Error('Predecessor settings drift');
    if (this.target.pages) { const p = await this.#project(); if (object(p.canonical_deployment).id !== before.pages?.deployment_id) throw new Error('Pages predecessor moved'); }
    return before;
  }
}
function contentType(path: string): string {
  // Static portal only, no server/control files or latent Pages Functions activation.
  if (path.split('/').some(p => p.startsWith('.')) || /(^|\/)(_worker|_routes|_headers|_redirects|functions)([./]|$)/.test(path)) throw new Error('Unsupported Pages control file');
  const types: Record<string, string> = { html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain' };
  const ext = path.split('.').at(-1)!; if (!types[ext]) throw new Error('Unsupported static portal type'); return types[ext];
}
export interface Operation { name: 'worker-upload' | 'worker-switch' | 'pages-assets' | 'pages-deploy'; state: 'unknown' | 'confirmed'; native_id: string | null }
export interface Journal { schema: 'attestrack.native-write-journal/v1'; artifact: ArtifactIdentity; target_sha256: string; tool_profile_sha256: string; predecessor: Snapshot; operations: Operation[]; after: Snapshot | null }
export interface JournalSink { append(record: Journal): Promise<void> }
