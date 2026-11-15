/** Native infra-job proof + current public Git bytes; no age/signing/write role. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { completeNativeList, type NativeArtifact, type NativeJob, type Run } from '../.github/actions/retained-build/retained-build.ts';
import { digest, readSingleZip, REPOSITORY } from './application-artifacts.ts';
import { canonical } from './native-release-canonical.ts';
import type { AuthenticatedJournalReader, Executor, Frame } from './native-application-operation.ts';
import { execution } from './native-application-operation.ts';
import type { OriginalJobRuntime } from './native-application-job-fence.ts';
import type { GitHubRead } from './native-application-release.ts';
import { INFRA, INFRA_ID, projectionArtifactName, validateProjection, validateStoreBinding, verifyCurrentPublicHead, verifyCurrentPublicJournal, type JournalStoreBinding } from './native-journal-projection.ts';

export const ISSUER_PROFILE = 'release/application-journal-issuers.json';
export const ISSUER_WORKFLOW = '.github/workflows/platform-product-release.yml';
export interface IssuerBinding {
  store: JournalStoreBinding;
  issuer: { schema: 'attestrack.native-journal-issuer/v1'; repository: typeof INFRA; repository_id: number; workflow: typeof ISSUER_WORKFLOW;
    source_commit: string; workflow_blob: string; workflow_sha256: string; job_name: 'attestrack-native-journal' };
}
export interface ProjectionLocator { run_id: number; run_attempt: number; job_id: number; artifact_id: number; source_commit: string }
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
function closed(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || canonical(Object.keys(raw).sort()) !== canonical(keys.sort())) throw Error('Nonclosed journal issuer configuration');
  return raw as Record<string, unknown>;
}
function positive(raw: unknown): number { if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) throw Error('Invalid original journal issuer identity'); return raw; }
export function validateIssuerBinding(raw: unknown, environment: Frame['environment']): IssuerBinding {
  const b = closed(raw, ['store', 'issuer']), issuer = closed(b.issuer, ['schema', 'repository', 'repository_id', 'workflow', 'source_commit', 'workflow_blob', 'workflow_sha256', 'job_name']);
  validateStoreBinding(b.store, environment);
  if (issuer.schema !== 'attestrack.native-journal-issuer/v1' || issuer.repository !== INFRA || issuer.repository_id !== INFRA_ID || issuer.workflow !== ISSUER_WORKFLOW
      || typeof issuer.source_commit !== 'string' || !SHA.test(issuer.source_commit)
      || typeof issuer.workflow_blob !== 'string' || !SHA.test(issuer.workflow_blob)
      || typeof issuer.workflow_sha256 !== 'string' || !HASH.test(issuer.workflow_sha256)
      || issuer.job_name !== 'attestrack-native-journal') throw Error('Unreviewed infra journal issuer binding');
  return structuredClone(raw) as IssuerBinding;
}
export function selectIssuer(raw: unknown, environment: Frame['environment']): IssuerBinding {
  const p = closed(raw, ['schema', 'staging', 'production']);
  if (p.schema !== 'attestrack.native-journal-issuers/v1' || !['staging', 'production'].includes(environment) || p[environment] === null) throw Error('Native journal projection issuer is unconfigured');
  return validateIssuerBinding(p[environment], environment);
}
function locator(raw: unknown): ProjectionLocator {
  const p = closed(raw, ['run_id', 'run_attempt', 'job_id', 'artifact_id', 'source_commit']);
  for (const k of ['run_id', 'run_attempt', 'job_id', 'artifact_id']) positive(p[k]);
  if (typeof p.source_commit !== 'string' || !SHA.test(p.source_commit)) throw Error('Exact original journal source required');
  return structuredClone(raw) as ProjectionLocator;
}
/** Only fixed infra producer and selected existing public store endpoints. The
 * original app NativeGitHub allowlist is deliberately not broadened.
 */
export class ProjectionGitHubRead implements GitHubRead {
  private readonly binding: IssuerBinding;
  private readonly original: ProjectionLocator;
  private readonly discovered = new Set<string>();
  constructor(binding: IssuerBinding, environment: Frame['environment'], original: ProjectionLocator) {
    this.binding = validateIssuerBinding(binding, environment); this.original = locator(original);
    if (this.original.source_commit !== this.binding.issuer.source_commit) throw Error('Original issuer source differs from reviewed source pin');
  }
  private allowed(path: string): boolean {
    const p = `repos/${INFRA}`, s = `repos/${this.binding.store.repository}`, r = this.original;
    const exact = [p, `${p}/branches/main`, `${p}/actions/runs/${r.run_id}`, `${p}/actions/runs/${r.run_id}/attempts/${r.run_attempt}`,
      `${p}/contents/${ISSUER_WORKFLOW}?ref=${r.source_commit}`, `${p}/actions/artifacts/${r.artifact_id}/zip`,
      s, `${s}/git/ref/heads/release-ledger`];
    if (exact.includes(path)) return true;
    if (this.discovered.has(path)) return true;
    return Array.from({ length: 10 }, (_, i) => i + 1).some(page => path === `${p}/actions/runs/${r.run_id}/attempts/${r.run_attempt}/jobs?per_page=100&page=${page}`
      || path === `${p}/actions/runs/${r.run_id}/artifacts?per_page=100&page=${page}`);
  }
  bytes(path: string): Buffer {
    if (!this.allowed(path)) throw Error('Unapproved public journal read path');
    return execFileSync('gh', ['api', '--hostname', 'github.com', path], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  }
  json<T>(path: string): T {
    const value = JSON.parse(this.bytes(path).toString()), s = `repos/${this.binding.store.repository}`;
    // Only follow objects discovered from the configured current branch; no
    // arbitrary store branch, commit or blob endpoint is initially authorized.
    if (path === `${s}/git/ref/heads/release-ledger` && value.ref === 'refs/heads/release-ledger' && value.object?.type === 'commit' && SHA.test(value.object.sha)) this.discovered.add(`${s}/git/commits/${value.object.sha}`);
    if (path.startsWith(`${s}/git/commits/`) && SHA.test(value.tree?.sha)) this.discovered.add(`${s}/git/trees/${value.tree.sha}`);
    if (path.startsWith(`${s}/git/trees/`) && value.truncated === false && Array.isArray(value.tree) && value.tree.length === 2) {
      for (const entry of value.tree) if (['ledger.age', 'ledger.age.sig'].includes(entry.path) && entry.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha)) this.discovered.add(`${s}/git/blobs/${entry.sha}`);
    }
    return value as T;
  }
}
function list<T extends { id: number }>(reader: GitHubRead, path: string, field: string): T[] {
  return completeNativeList<T>(page => {
    const r = reader.json<Record<string, unknown>>(`${path}?per_page=100&page=${page}`);
    return { total_count: r.total_count as number, items: r[field] as T[] };
  });
}
function verifySource(reader: GitHubRead, binding: IssuerBinding, original: ProjectionLocator): void {
  const value = reader.json<{ type: string; path: string; sha: string; size: number; encoding: string; content: string }>(`repos/${INFRA}/contents/${ISSUER_WORKFLOW}?ref=${original.source_commit}`);
  if (value.type !== 'file' || value.path !== ISSUER_WORKFLOW || value.sha !== binding.issuer.workflow_blob
      || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 1024 * 1024 || value.encoding !== 'base64'
      || typeof value.content !== 'string' || value.content.length > 2 * 1024 * 1024) throw Error('Original reviewed issuer workflow unavailable');
  const encoded = value.content.replace(/\n/g, ''), bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== value.size || bytes.toString('base64') !== encoded
      || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== value.sha
      || digest(bytes) !== binding.issuer.workflow_sha256) throw Error('Original sole-publisher workflow bytes differ');
}
function originalJob(reader: GitHubRead, binding: IssuerBinding, original: ProjectionLocator): { run: Run; job: NativeJob } {
  const p = `repos/${INFRA}`, issuer = binding.issuer;
  const repository = reader.json<{ full_name: string; id: number; fork: boolean; private: boolean; default_branch: string }>(p);
  const branch = reader.json<{ name: string; protected: boolean }>(`${p}/branches/main`);
  if (repository.full_name !== INFRA || repository.id !== INFRA_ID || repository.fork !== false || repository.private !== true || repository.default_branch !== 'main'
      || branch.name !== 'main' || branch.protected !== true) throw Error('Protected original infra issuer repository differs');
  const latest = reader.json<Run>(`${p}/actions/runs/${original.run_id}`), run = reader.json<Run>(`${p}/actions/runs/${original.run_id}/attempts/${original.run_attempt}`);
  for (const r of [latest, run]) {
    if (r.id !== original.run_id || r.run_attempt !== original.run_attempt || r.head_sha !== original.source_commit || r.head_branch !== 'main'
        || r.head_repository?.full_name !== INFRA || r.path !== issuer.workflow || r.event !== 'deployment'
        || !['in_progress', 'completed'].includes(r.status) || (r.status === 'in_progress' && r.conclusion !== null)
        || (r.status === 'completed' && r.conclusion !== 'success')) throw Error('Original journal issuer run/source differs, failed or was rerun');
  }
  if (latest.status !== run.status || latest.conclusion !== run.conclusion) throw Error('Journal issuer latest/attempt lifecycle disagrees');
  const jobs = list<NativeJob>(reader, `${p}/actions/runs/${original.run_id}/attempts/${original.run_attempt}/jobs`, 'jobs');
  const matches = jobs.filter(j => j.name === issuer.job_name), scope = jobs.filter(j => j.name === 'scope');
  const bound = (j: NativeJob) => j.run_id === original.run_id && j.run_attempt === original.run_attempt && j.head_sha === original.source_commit && j.status === 'completed' && j.conclusion === 'success';
  if (matches.length !== 1 || matches[0].id !== original.job_id || !bound(matches[0]) || scope.length !== 1 || !bound(scope[0])) throw Error('Original journal issuer/scope job unsuccessful or ambiguous');
  return { run, job: matches[0] };
}
function lifecycle({ run, job }: { run: Run; job: NativeJob }): unknown {
  return { run: { id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha, status: run.status, conclusion: run.conclusion },
    job: { id: job.id, run_id: job.run_id, run_attempt: job.run_attempt, head_sha: job.head_sha, name: job.name, status: job.status, conclusion: job.conclusion } };
}
export class NativeJournalProjectionReader implements AuthenticatedJournalReader {
  private readonly binding: IssuerBinding;
  private readonly original: ProjectionLocator;
  private readonly environment: Frame['environment'];
  private readonly reader: GitHubRead;
  constructor(binding: IssuerBinding, environment: Frame['environment'], original: ProjectionLocator, reader?: GitHubRead) {
    this.binding = validateIssuerBinding(binding, environment); this.original = locator(original);
    if (this.original.source_commit !== this.binding.issuer.source_commit) throw Error('Original issuer source differs from reviewed source pin');
    this.environment = environment;
    this.reader = reader ?? new ProjectionGitHubRead(this.binding, environment, this.original);
  }
  async readCurrent(context: { repository: typeof REPOSITORY; environment: Frame['environment']; operation_id: string }): Promise<Frame> {
    if (context.environment !== this.environment || context.repository !== REPOSITORY) throw Error('Projection read context differs');
    const reader = this.reader, original = this.original, p = `repos/${INFRA}`;
    const before = originalJob(reader, this.binding, original);
    // This whole-source pin is the reviewed sole-publisher contract. GitHub's
    // artifact API identifies a run, NOT its producer job. Never synthesize one.
    verifySource(reader, this.binding, original);
    const artifacts = list<NativeArtifact>(reader, `${p}/actions/runs/${original.run_id}/artifacts`, 'artifacts');
    const matches = artifacts.filter(a => a.id === original.artifact_id);
    if (matches.length !== 1) throw Error('Original journal projection artifact missing or ambiguous');
    const artifact = matches[0], w = artifact.workflow_run;
    if (artifact.expired || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > 1024 * 1024
        || !w || w.id !== original.run_id || w.repository_id !== INFRA_ID || w.head_repository_id !== INFRA_ID
        || w.head_sha !== original.source_commit || w.head_branch !== 'main') throw Error('Projection archive native origin differs');
    const bytes = reader.bytes(`${p}/actions/artifacts/${original.artifact_id}/zip`);
    if (bytes.length !== artifact.size_in_bytes || artifact.digest !== `sha256:${digest(bytes)}`) throw Error('Projection native archive digest differs');
    const projection = validateProjection(readSingleZip(bytes, 'projection.json'), context, this.binding.store);
    const expected = projectionArtifactName(projection.frame);
    if (artifact.name !== expected || artifacts.filter(a => a.name === expected).length !== 1) throw Error('Original sole-publisher projection name differs');
    verifyCurrentPublicJournal(reader, projection);
    if (canonical(lifecycle(originalJob(reader, this.binding, original))) !== canonical(lifecycle(before))) throw Error('Original journal issuer changed during projection verification');
    verifyCurrentPublicHead(reader, projection);
    return structuredClone(projection.frame);
  }
}
/** Fixed source-owned configuration, null until an actual reviewed issuer and
 * genesis exist. No caller-supplied issuer/store selector or plaintext fallback.
 */
export function configuredProjectionReader(environment: Frame['environment'], original: ProjectionLocator): NativeJournalProjectionReader {
  const raw = JSON.parse(readFileSync(new URL('../' + ISSUER_PROFILE, import.meta.url), 'utf8'));
  return new NativeJournalProjectionReader(selectIssuer(raw, environment), environment, original);
}
/** Concrete consumption path for the future waiting provider job. Only public
 * reads happen before the original-job fence issues its opaque capability.
 */
export async function projectedExecution(context: { environment: Frame['environment']; operation_id: string }, own: Executor, original: ProjectionLocator, runtime?: OriginalJobRuntime) {
  return consumeProjection(configuredProjectionReader(context.environment, original), context, own, runtime);
}
export async function consumeProjection(reader: NativeJournalProjectionReader, context: { environment: Frame['environment']; operation_id: string }, own: Executor, runtime?: OriginalJobRuntime) {
  if (!(reader instanceof NativeJournalProjectionReader)) throw Error('Native journal projection verifier required');
  const cap = await execution(reader, context, own, runtime);
  // Do not expose a capability if the Git head or issuer changes while native
  // fence verification/fsync is in progress. A refusal retains the job marker.
  await reader.readCurrent({ repository: REPOSITORY, ...context });
  return cap;
}
