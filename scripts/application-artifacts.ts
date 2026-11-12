/** Retained application bytes only. This module has no provider/deploy/acceptance authority. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { completeNativeList, requireNativeJobs, validate, verifyNativeArchive, verifyStagingPr,
  type Evidence, type NativeArtifact, type NativeJob, type PullRequest, type Run } from '../.github/actions/retained-build/retained-build.ts';
import { buildWorkerEntry } from '../packages/deploy/src/worker-template.ts';

export const REPOSITORY = 'matt-cochran-products/attestrack';
export const WORKFLOW = 'application-artifacts.yml';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 64 * 1024 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI_JOBS = ['resolve', 'checks / ci', 'checks / warehouse', 'checks / e2e / e2e', 'checks / Build gate', 'Build gate'];
export interface FileBytes { path: string; size: number; sha256: string; base64: string }
export interface Payload {
  schema: 'attestrack.application-bytes/v1'; repository: string; repository_id: number;
  producer: { run_id: number; run_attempt: number; source_sha: string; tree: string; workflow: string };
  source: Evidence;
  build: { node: string; pnpm: string; esbuild: string; lock_sha256: string; entry_sha256: string; compatibility_date: string };
  files: FileBytes[]; inventory_sha256: string;
}
export const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
function closed(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== keys.sort().join()) throw new Error('Non-closed artifact document');
}
function positive(v: unknown): boolean { return Number.isSafeInteger(v) && Number(v) > 0; }
export function safePath(path: string): void {
  if (path.length > 512 || path.split('/').length > 32 || !/^(worker|portal|schema)\/[A-Za-z0-9_.\/-]+$/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')
      || /(^|\/)(\.env(?:\..*)?|secrets?\..*|.*\.(pem|key)|id_rsa)$/i.test(path)) throw new Error('Unsafe artifact path');
  if (path.startsWith('worker/') && path !== 'worker/index.js') throw new Error('Unexpected Worker module');
  if (path.startsWith('schema/') && path !== 'schema/clickhouse.sql') throw new Error('Unexpected schema file');
}
export function inventory(files: FileBytes[]): string {
  return digest(JSON.stringify(files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))));
}
export function fileBytes(path: string, bytes: Buffer): FileBytes {
  safePath(path); return { path, size: bytes.length, sha256: digest(bytes), base64: bytes.toString('base64') };
}
export function validateContent(raw: unknown): Payload {
  closed(raw, ['schema', 'repository', 'repository_id', 'producer', 'source', 'build', 'files', 'inventory_sha256']);
  closed(raw.producer, ['run_id', 'run_attempt', 'source_sha', 'tree', 'workflow']);
  closed(raw.build, ['node', 'pnpm', 'esbuild', 'lock_sha256', 'entry_sha256', 'compatibility_date']);
  const p = raw as unknown as Payload;
  closed(p.source, ['schema', 'repository', 'workflow', 'run_id', 'run_attempt', 'head_sha', 'built_sha', 'tree', 'pull_request']);
  if (p.source.schema !== 2 || p.source.repository !== REPOSITORY || p.source.workflow !== 'ci.yml'
      || !positive(p.source.run_id) || !positive(p.source.run_attempt) || !SHA.test(p.source.head_sha)
      || !SHA.test(p.source.built_sha) || p.source.tree !== p.producer.tree || !p.source.pull_request) throw new Error('Invalid recorded source proof');
  closed(p.source.pull_request, ['number', 'base_ref', 'base_repo_id', 'head_ref', 'head_repo_id', 'head_sha']);
  if (p.schema !== 'attestrack.application-bytes/v1' || p.repository !== REPOSITORY || !positive(p.repository_id)
      || !positive(p.producer.run_id) || !positive(p.producer.run_attempt) || !SHA.test(p.producer.source_sha)
      || !SHA.test(p.producer.tree) || p.producer.workflow !== WORKFLOW
      || !HASH.test(p.build.lock_sha256) || !HASH.test(p.build.entry_sha256) || p.build.compatibility_date !== '2024-12-01'
      || !/^v\d+\.\d+\.\d+$/.test(p.build.node) || p.build.pnpm !== '9.0.0' || !/^\d+\.\d+\.\d+$/.test(p.build.esbuild)
      || !Array.isArray(p.files) || p.files.length < 3 || p.files.length > 10000) throw new Error('Untrusted application origin or build identity');
  let total = 0; let previous = '';
  for (const f of p.files) {
    closed(f, ['path', 'size', 'sha256', 'base64']);
    if (typeof f.path !== 'string' || f.path <= previous || typeof f.base64 !== 'string' || !HASH.test(f.sha256)
        || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMIT || f.base64.length > LIMIT * 1.4) throw new Error('Invalid or duplicate inventory');
    safePath(f.path); previous = f.path;
    const bytes = Buffer.from(f.base64, 'base64'); total += bytes.length;
    if (bytes.toString('base64') !== f.base64 || bytes.length !== f.size || digest(bytes) !== f.sha256 || total > LIMIT) throw new Error('Artifact file digest or size mismatch');
  }
  for (const path of ['worker/index.js', 'portal/index.html', 'schema/clickhouse.sql']) if (!p.files.some(f => f.path === path)) throw new Error('Missing required artifact file');
  if (inventory(p.files) !== p.inventory_sha256) throw new Error('Complete inventory mismatch');
  const html = Buffer.from(p.files.find(f => f.path === 'portal/index.html')!.base64, 'base64').toString('utf8');
  if ((html.match(/name="attestrack-portal-api"/g) ?? []).length !== 1
      || !html.includes('<meta name="attestrack-portal-api" content="same-origin" />')) throw new Error('Missing neutral runtime configuration');
  return p;
}
export function validatePayload(raw: unknown, run: Run, repositoryId: number, tree: string): Payload {
  const p = validateContent(raw);
  if (p.repository_id !== repositoryId || !positive(repositoryId) || !positive(run.id) || !positive(run.run_attempt)
      || run.path !== `.github/workflows/${WORKFLOW}` || run.event !== 'push' || run.head_branch !== 'staging'
      || run.head_repository?.full_name !== REPOSITORY || run.status !== 'completed' || run.conclusion !== 'success'
      || !SHA.test(tree) || p.producer.tree !== tree || p.producer.source_sha !== run.head_sha
      || p.producer.run_id !== run.id || p.producer.run_attempt !== run.run_attempt
      || p.build.lock_sha256 !== digest(readFileSync(join(ROOT, 'pnpm-lock.yaml')))
      || p.build.entry_sha256 !== digest(buildWorkerEntry())) throw new Error('Untrusted staged origin or source inputs');
  return p;
}
/** Only called AFTER native artifact/digest verification. No files extracted from an untrusted ZIP. */
export function readSingleZip(bytes: Buffer, name: string): unknown {
  const script = `import sys,io,zipfile,json,stat\nb=sys.stdin.buffer.read(${96 * 1024 * 1024 + 1})\nassert len(b)<=${96 * 1024 * 1024}\nz=zipfile.ZipFile(io.BytesIO(b)); a=z.infolist()\nassert len(a)==1 and a[0].filename==sys.argv[1] and not a[0].is_dir()\nassert not stat.S_ISLNK(a[0].external_attr>>16)\nassert a[0].file_size<=${96 * 1024 * 1024} and a[0].compress_size<=${96 * 1024 * 1024}\nx=z.read(a[0])\ndef unique(p):\n d=dict(p); assert len(d)==len(p); return d\njson.loads(x,object_pairs_hook=unique); sys.stdout.buffer.write(x)\n`;
  return JSON.parse(execFileSync('python3', ['-c', script, name], { input: bytes, maxBuffer: 96 * 1024 * 1024, timeout: 30000 }).toString());
}
export function materialize(payload: Payload, destination: string): void {
  if (existsSync(destination)) throw new Error('Materialization destination must be fresh');
  mkdirSync(destination, { recursive: true });
  for (const f of payload.files) {
    safePath(f.path);
    const path = join(destination, f.path); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(f.base64, 'base64'), { flag: 'wx' });
  }
}
export function verifiedDocument(a: NativeArtifact, r: Run, repositoryId: number, name: string, bytes: Buffer, inner: string): unknown {
  verifyNativeArchive(a, r, repositoryId, name, bytes);
  return readSingleZip(bytes, inner);
}
function command(args: string[]): Buffer {
  return execFileSync(args[0], args.slice(1), { maxBuffer: 96 * 1024 * 1024, timeout: 30000 });
}
const api = <T>(path: string): T => JSON.parse(command(['gh', 'api', path]).toString());
function list<T extends { id: number }>(path: string, field: string): T[] {
  return completeNativeList<T>(page => {
    const r = api<Record<string, unknown>>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    return { total_count: r.total_count as number, items: r[field] as T[] };
  });
}
const prefix = `repos/${REPOSITORY}`;
function jobs(run: Run, names: string[]): void {
  requireNativeJobs(list<NativeJob>(`${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'), run, names);
}
function archive(run: Run, repositoryId: number, name: string, inner: string): { value: unknown; artifact: NativeArtifact } {
  const found = list<NativeArtifact>(`${prefix}/actions/runs/${run.id}/artifacts`, 'artifacts').filter(a => a.name === name);
  if (found.length !== 1) throw new Error('Required original artifact is missing or ambiguous');
  const a = found[0];
  const bytes = command(['gh', 'api', `${prefix}/actions/artifacts/${a.id}/zip`]);
  return { value: verifiedDocument(a, run, repositoryId, name, bytes, inner), artifact: a };
}
function checkSource(e: Evidence, repositoryId: number, tree: string): void {
  if (!e || !positive(e.run_id) || !positive(e.run_attempt)) throw new Error('Invalid source run identity');
  const r = api<Run>(`${prefix}/actions/runs/${e.run_id}`);
  validate(e, r, REPOSITORY, 'ci.yml', tree); jobs(r, CI_JOBS);
  if (e.schema !== 2 || !e.pull_request || !positive(e.pull_request.number) || e.pull_request.base_repo_id !== repositoryId) throw new Error('Application bytes require recorded staging PR source provenance');
  verifyStagingPr(e, r, REPOSITORY, [api<PullRequest>(`${prefix}/pulls/${e.pull_request.number}`)]);
  const commit = api<{ tree: { sha: string } }>(`${prefix}/git/commits/${e.built_sha}`);
  if (commit.tree.sha !== tree) throw new Error('Source proof built tree mismatch');
}
interface Scope { branch: string; sha: string; tree: string; repositoryId: number; runId: number; attempt: number }
function scope(): Scope {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_EVENT_NAME !== 'push'
      || !['refs/heads/staging', 'refs/heads/main'].includes(process.env.GITHUB_REF ?? '')) throw new Error('Only protected staging/main push artifact operations');
  const branch = process.env.GITHUB_REF!.slice(11); const sha = process.env.GITHUB_SHA!;
  if (!SHA.test(sha) || command(['git', '-C', ROOT, 'rev-parse', 'HEAD']).toString().trim() !== sha
      || command(['git', '-C', ROOT, 'status', '--porcelain']).length) throw new Error('Source checkout is not exact and clean');
  const repo = api<{ id: number }>(prefix); const b = api<{ protected: boolean; commit: { sha: string } }>(`${prefix}/branches/${branch}`);
  if (b.protected !== true || b.commit.sha !== sha || !positive(repo.id) || repo.id !== Number(process.env.GITHUB_REPOSITORY_ID)) throw new Error('Protected source moved or repository mismatch');
  const commit = api<{ tree: { sha: string } }>(`${prefix}/git/commits/${sha}`);
  const runId = Number(process.env.GITHUB_RUN_ID); const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const r = api<Run>(`${prefix}/actions/runs/${runId}`);
  if (!positive(runId) || !positive(attempt) || r.run_attempt !== attempt || r.head_sha !== sha || r.head_branch !== branch
      || r.event !== 'push' || r.path !== `.github/workflows/${WORKFLOW}` || r.head_repository.full_name !== REPOSITORY) throw new Error('Current original workflow mismatch');
  return { branch, sha, tree: commit.tree.sha, repositoryId: repo.id, runId, attempt };
}
function source(s: Scope): Evidence {
  const runs = list<Run>(`${prefix}/actions/workflows/ci.yml/runs`, 'workflow_runs');
  for (const r of runs) {
    if (r.status !== 'completed' || r.conclusion !== 'success' || r.event !== 'pull_request' || r.head_repository?.full_name !== REPOSITORY) continue;
    // Source schemas remain source proof, never application payload authority.
    const a = list<NativeArtifact>(`${prefix}/actions/runs/${r.id}/artifacts`, 'artifacts').filter(a => a.name === `retained-build-ci.yml-${r.run_attempt}`);
    if (a.length === 0) continue;
    const raw = archive(r, s.repositoryId, `retained-build-ci.yml-${r.run_attempt}`, 'build-result.json').value as Evidence;
    if (raw.tree !== s.tree) continue;
    checkSource(raw, s.repositoryId, s.tree); return raw;
  }
  throw new Error('No original full source proof for the complete tree');
}
function buildEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, CI: 'true', LANG: 'C.UTF-8' };
}
export function collect(dir: string, prefix: string): FileBytes[] {
  const files: FileBytes[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name); const rel = `${prefix}/${name}`; safePath(rel);
    const st = lstatSync(path);
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error('Non-regular build output');
    if (st.isDirectory()) files.push(...collect(path, rel));
    else { if (st.size > LIMIT) throw new Error('Oversize build output'); files.push(fileBytes(rel, readFileSync(path))); }
  }
  return files;
}
export async function main(): Promise<void> {
  const mode = process.argv[2]; const s = scope();
  if (mode === 'scope') return;
  const out = join(process.env.RUNNER_TEMP!, 'attestrack-application');
  if (mode === 'build' && s.branch === 'staging') {
    if (command(['git', '-C', ROOT, 'rev-parse', 'HEAD']).toString().trim() !== s.sha
        || command(['git', '-C', ROOT, 'status', '--porcelain']).length) throw new Error('Checkout must be exact and clean before build');
    const e = source(s); const tmp = mkdtempSync(join(process.env.RUNNER_TEMP!, 'attestrack-build-'));
    const env = buildEnvironment(join(tmp, 'home')); mkdirSync(env.HOME!, { recursive: true });
    const build = (args: string[]) => execFileSync(args[0], args.slice(1), { cwd: ROOT, env, stdio: 'inherit' });
    const pnpm = execFileSync('pnpm', ['--version'], { cwd: ROOT, env }).toString().trim();
    if (pnpm !== '9.0.0') throw new Error('Frozen package-manager identity mismatch');
    build(['pnpm', 'install', '--frozen-lockfile']); build(['pnpm', 'build']);
    const esbuild = await import('esbuild');
    const entry = buildWorkerEntry(); const entryFile = join(tmp, 'worker.ts'); writeFileSync(entryFile, entry);
    const result = await esbuild.build({ entryPoints: [entryFile], bundle: true, write: false, format: 'esm', platform: 'browser',
      conditions: ['workerd', 'worker', 'import'], absWorkingDir: ROOT, logLevel: 'silent',
      alias: Object.fromEntries(['host-cloudflare-worker', 'worker-core', 'strategies'].map(n => [`@attestrack/${n}`, join(ROOT, 'packages', n, 'dist/index.js')])) });
    if (result.outputFiles.length !== 1 || result.outputFiles[0].contents.length > LIMIT) throw new Error('Unexpected bundled Worker output');
    const files = [fileBytes('worker/index.js', Buffer.from(result.outputFiles[0].contents)), ...collect(join(ROOT, 'packages/portal-community/dist'), 'portal'),
      fileBytes('schema/clickhouse.sql', readFileSync(join(ROOT, 'packages/schema/warehouse/clickhouse.sql')))];
    const html = files.find(f => f.path === 'portal/index.html')!;
    const text = Buffer.from(html.base64, 'base64').toString();
    if (!text.includes('</head>') || text.includes('attestrack-portal-api')) throw new Error('Unexpected portal runtime configuration');
    Object.assign(html, fileBytes(html.path, Buffer.from(text.replace('</head>', '<meta name="attestrack-portal-api" content="same-origin" />\n</head>'))));
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const p: Payload = { schema: 'attestrack.application-bytes/v1', repository: REPOSITORY, repository_id: s.repositoryId,
      producer: { run_id: s.runId, run_attempt: s.attempt, source_sha: s.sha, tree: s.tree, workflow: WORKFLOW }, source: e,
      build: { node: process.version, pnpm, esbuild: esbuild.version, lock_sha256: digest(readFileSync(join(ROOT, 'pnpm-lock.yaml'))), entry_sha256: digest(entry), compatibility_date: '2024-12-01' },
      files, inventory_sha256: inventory(files) };
    validateContent(p); // Byte integrity only; producer completion is checked natively by the later reader.
    scope(); if (existsSync(out)) throw new Error('Artifact output already exists'); mkdirSync(out);
    writeFileSync(join(out, 'application.json'), JSON.stringify(p) + '\n'); return;
  }
  if (mode === 'materialize' && s.branch === 'main') {
    const runs = list<Run>(`${prefix}/actions/workflows/${WORKFLOW}/runs`, 'workflow_runs');
    for (const r of runs) {
      if (r.id === s.runId || r.event !== 'push' || r.head_branch !== 'staging' || r.status !== 'completed'
          || r.conclusion !== 'success' || r.head_repository?.full_name !== REPOSITORY) continue;
      const commit = api<{ tree: { sha: string } }>(`${prefix}/git/commits/${r.head_sha}`);
      if (commit.tree.sha !== s.tree) continue;
      jobs(r, ['scope', 'staging-build']);
      const a = archive(r, s.repositoryId, `attestrack-application-${r.run_attempt}`, 'application.json');
      const p = validatePayload(a.value, r, s.repositoryId, s.tree); checkSource(p.source, s.repositoryId, s.tree);
      scope(); materialize(p, out);
    writeFileSync(join(out, 'original-artifact.json'), JSON.stringify({ schema: 'attestrack.artifact-materialization/v1', repository: REPOSITORY, artifact_id: a.artifact.id,
        producer_run: r.id, producer_attempt: r.run_attempt, archive_sha256: a.artifact.digest, inventory_sha256: p.inventory_sha256 }) + '\n'); return;
    }
    throw new Error('No exact original staged bytes; main never rebuilds');
  }
  throw new Error('Artifact operation is not allowed for this branch');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
