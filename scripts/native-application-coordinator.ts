/** Journal-role decisions for ONE native operation. No execution grant, CLI or credentials.
 * The supplied store must authenticate current encrypted bytes, retain ancestry,
 * and atomically CAS the environment slot. No in-memory production adapter exists.
 */
import { completeNativeList, type NativeArtifact, type NativeJob, type Run } from '../.github/actions/retained-build/retained-build.ts';
import { digest, readSingleZip, REPOSITORY } from './application-artifacts.ts';
import { WORKFLOW, type PlannedRequest } from './application-release-scope.ts';
import { canonical, type GitHubRead, type Journal } from './native-application-release.ts';
import { claimOperation, prepareOperation, recordAcknowledgement, unknownOperation,
  type Acknowledgement, type Executor, type Frame } from './native-application-operation.ts';

export type OriginalRun = Omit<Executor, 'job_id'>;
export interface CoordinatorRecord {
  schema: 'attestrack.native-operation-coordinator/v1';
  original_run: OriginalRun;
  prepared: Frame;
  current: Frame;
}
export interface Slot { head: string; record: unknown | null }
export interface CoordinatorStore {
  /** Must read the current authenticated environment slot, never a cached head. */
  read(environment: Frame['environment']): Promise<Slot>;
  /** Atomically compares the whole store head AND this environment's slot.
   * false means a CAS conflict; thrown errors have an UNKNOWN commit outcome.
   * No lease expiry, deletion, replacement, or provider operation is permitted.
   */
  compareAndSwap(environment: Frame['environment'], expected: Slot, next: CoordinatorRecord): Promise<boolean>;
}
export interface Decision {
  kind: 'waiting-original-job' | 'claimed-awaiting-original-job' | 'read-only-reconciliation' | 'acknowledged';
  record: CoordinatorRecord;
}
const PREFIX = `repos/${REPOSITORY}`;
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function closed(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !equal(Object.keys(raw).sort(), keys.sort())) throw Error('Nonclosed coordinator record');
  return raw as Record<string, unknown>;
}
function original(raw: unknown): OriginalRun {
  const r = closed(raw, ['repository_id', 'workflow_commit', 'run_id', 'run_attempt']);
  for (const k of ['repository_id', 'run_id', 'run_attempt']) if (!Number.isSafeInteger(r[k]) || Number(r[k]) < 1) throw Error('Invalid original run identity');
  if (typeof r.workflow_commit !== 'string' || !/^[a-f0-9]{40}$/.test(r.workflow_commit)) throw Error('Invalid original workflow source');
  return structuredClone(r) as unknown as OriginalRun;
}
/** Consumes an already independently admitted plan, NOT caller authorization.
 * Both producer wakeups must coalesce upstream before selecting this original run.
 */
export function coordinatorIntent(plan: PlannedRequest, journal: Journal): CoordinatorRecord {
  if (plan.schema !== 'attestrack.application-source-admission/v1' || plan.kind !== 'planned' || plan.repository !== REPOSITORY
      || !['staging', 'main'].includes(plan.branch) || plan.repository_id !== plan.context.repository_id
      || !equal(plan.artifact, journal.artifact) || plan.source_tree !== journal.artifact.source_tree || plan.targets.native_sha256 !== journal.target_sha256
      || plan.tool.profile_sha256 !== journal.tool_profile_sha256) throw Error('Admitted source/target/tool differs from prepared operation');
  const prepared = prepareOperation(journal, plan.branch === 'staging' ? 'staging' : 'production');
  return { schema: 'attestrack.native-operation-coordinator/v1', original_run: original(plan.context), prepared, current: structuredClone(prepared) };
}
function validated(raw: unknown): CoordinatorRecord {
  const r = closed(raw, ['schema', 'original_run', 'prepared', 'current']);
  if (r.schema !== 'attestrack.native-operation-coordinator/v1') throw Error('Invalid coordinator schema');
  const run = original(r.original_run), p = r.prepared as Frame;
  if (!p || !equal(p, prepareOperation(p.journal, p.environment))) throw Error('Invalid original prepared frame');
  const current = r.current as Frame;
  if (!current) throw Error('Missing current operation frame');
  let expected = p;
  if (current.state !== 'prepared') {
    if (!current.executor || !equal(originalRun(current.executor), run)) throw Error('Replacement executor refused');
    expected = claimOperation(p, current.executor);
    if (current.state === 'unknown') expected = unknownOperation(expected);
    else if (current.state === 'acknowledged') expected = recordAcknowledgement(expected, current.acknowledgement!);
    else if (current.state !== 'execution-claimed') throw Error('Invalid coordinator state');
  }
  if (!equal(current, expected)) throw Error('Current frame differs from original intent');
  return structuredClone(raw) as CoordinatorRecord;
}
function originalRun(e: Executor): OriginalRun {
  return { repository_id: e.repository_id, workflow_commit: e.workflow_commit, run_id: e.run_id, run_attempt: e.run_attempt };
}
function readSlot(raw: Slot): Slot {
  if (!raw || !/^[a-f0-9]{40}$/.test(raw.head)) throw Error('Authenticated Git store head required');
  return { head: raw.head, record: raw.record === null ? null : validated(raw.record) };
}
function sameIntent(a: CoordinatorRecord, b: CoordinatorRecord): boolean {
  return equal(a.prepared, b.prepared) && equal(a.original_run, b.original_run);
}
function list<T extends { id: number }>(reader: GitHubRead, path: string, field: string): T[] {
  return completeNativeList<T>(page => {
    const r = reader.json<Record<string, unknown>>(`${path}?per_page=100&page=${page}`);
    return { total_count: r.total_count as number, items: r[field] as T[] };
  });
}
/** Fixed future workflow names; the current scope-only workflow cannot satisfy these. */
export function operationJobName(record: CoordinatorRecord): string { return `native-${record.prepared.journal.operations.at(-1)!.name}`; }
export function acknowledgementName(record: CoordinatorRecord, jobId: number): string {
  return `attestrack-operation-${record.prepared.journal.operation_id}-${record.prepared.journal.operations.at(-1)!.name}-${jobId}-${record.original_run.run_attempt}`;
}
function nativeJob(reader: GitHubRead, record: CoordinatorRecord): { run: Run; job: NativeJob | null } {
  const own = record.original_run;
  const repo = reader.json<{ id: number; full_name: string; fork: boolean; default_branch: string }>(PREFIX);
  if (repo.id !== own.repository_id || repo.full_name !== REPOSITORY || repo.fork !== false || repo.default_branch !== 'main') throw Error('Native executor repository differs');
  const latest = reader.json<Run>(`${PREFIX}/actions/runs/${own.run_id}`);
  const run = reader.json<Run>(`${PREFIX}/actions/runs/${own.run_id}/attempts/${own.run_attempt}`);
  for (const r of [latest, run]) {
    if (r.id !== own.run_id || r.run_attempt !== own.run_attempt || r.head_sha !== own.workflow_commit || r.head_branch !== 'main'
        || r.head_repository?.full_name !== REPOSITORY || r.path !== WORKFLOW || r.event !== 'workflow_run'
        || !['in_progress', 'completed'].includes(r.status)
        || (r.status === 'in_progress' && r.conclusion !== null)) throw Error('Original native executor run differs or was rerun');
  }
  const jobs = list<NativeJob>(reader, `${PREFIX}/actions/runs/${own.run_id}/attempts/${own.run_attempt}/jobs`, 'jobs');
  const scope = jobs.filter(j => j.name === 'scope');
  const bound = (j: NativeJob) => j.run_id === own.run_id && j.run_attempt === own.run_attempt && j.head_sha === own.workflow_commit;
  if (scope.length !== 1 || !bound(scope[0]) || scope[0].status !== 'completed' || scope[0].conclusion !== 'success') throw Error('Original source scope job not successful');
  const matching = jobs.filter(j => j.name === operationJobName(record));
  if (matching.length > 1 || (matching.length === 1 && !bound(matching[0]))) throw Error('Ambiguous or foreign original operation job');
  const job = matching[0] ?? null;
  if (job && (!['queued', 'waiting', 'in_progress', 'completed'].includes(job.status) || (job.status !== 'completed' && job.conclusion !== null))) throw Error('Invalid native job state');
  if (record.current.executor && (!job || job.id !== record.current.executor.job_id)) throw Error('Claimed original job missing or replaced; reconcile without replay');
  return { run, job };
}
/** Deliberately verifies successful JOB, not a fabricated successful whole run.
 * Future fixed workflow must be the sole publisher of this job-bound ACK name.
 */
function nativeAcknowledgement(reader: GitHubRead, record: CoordinatorRecord, run: Run, job: NativeJob): Acknowledgement | null {
  if (job.status !== 'completed' || job.conclusion !== 'success') return null;
  const name = acknowledgementName(record, job.id);
  const matches = list<NativeArtifact>(reader, `${PREFIX}/actions/runs/${run.id}/artifacts`, 'artifacts').filter(a => a.name === name);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw Error('Ambiguous original acknowledgement');
  const a = matches[0], w = a.workflow_run;
  if (a.expired || !Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes < 1 || a.size_in_bytes > 1024 * 1024
      || !w || w.id !== run.id || w.repository_id !== record.original_run.repository_id || w.head_repository_id !== record.original_run.repository_id
      || w.head_branch !== run.head_branch || w.head_sha !== run.head_sha) throw Error('Foreign or unavailable acknowledgement artifact');
  const bytes = reader.bytes(`${PREFIX}/actions/artifacts/${a.id}/zip`);
  if (bytes.length !== a.size_in_bytes || a.digest !== `sha256:${digest(bytes)}`) throw Error('Acknowledgement native archive digest differs');
  return readSingleZip(bytes, 'acknowledgement.json') as Acknowledgement;
}
function decision(record: CoordinatorRecord): Decision {
  const kind = record.current.state === 'prepared' ? 'waiting-original-job' : record.current.state === 'execution-claimed'
    ? 'claimed-awaiting-original-job' : record.current.state === 'unknown' ? 'read-only-reconciliation' : 'acknowledged';
  return { kind, record: structuredClone(record) };
}
/** API timestamps, URLs and step progress are not executor identity or lifecycle.
 * nativeJob separately revalidates repository, source, scope and complete lists.
 */
function executorState({ run, job }: { run: Run; job: NativeJob | null }): unknown {
  return {
    run: { id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha, status: run.status, conclusion: run.conclusion },
    job: job === null ? null : { id: job.id, run_id: job.run_id, run_attempt: job.run_attempt, head_sha: job.head_sha,
      name: job.name, status: job.status, conclusion: job.conclusion },
  };
}
/** A durable claim is NOT an execution capability. This class cannot dispatch or
 * release the environment slot. Unknown outcomes admit only original ACK/readback.
 */
export class NativeOperationCoordinator {
  private readonly store: CoordinatorStore;
  private readonly github: GitHubRead;
  constructor(store: CoordinatorStore, github: GitHubRead) { this.store = store; this.github = github; }
  async reconcile(rawIntent: CoordinatorRecord): Promise<Decision> {
    const intent = validated(rawIntent);
    if (intent.current.state !== 'prepared') throw Error('Original prepared intent required');
    const environment = intent.prepared.environment;
    for (let retry = 0; retry < 4; retry++) {
      const slot = readSlot(await this.store.read(environment));
      const current = slot.record === null ? intent : validated(slot.record);
      if (!sameIntent(current, intent)) throw Error('Environment occupied by another intent; no replacement or lease stealing');
      if (slot.record === null) {
        await this.persist(environment, slot, intent);
        continue;
      }
      if (current.current.state === 'acknowledged') return decision(current);
      const { run, job } = nativeJob(this.github, current);
      let next: CoordinatorRecord = structuredClone(current);
      if (current.current.state === 'prepared') {
        if (!job || job.status === 'queued' || job.status === 'waiting') {
          if (run.status === 'completed') throw Error('Original run ended without a claimable job');
          return decision(current);
        }
        if (job.status !== 'in_progress' || run.status !== 'in_progress') throw Error('Original executor ended before claim; no replay');
        next.current = claimOperation(current.prepared, { ...current.original_run, job_id: job.id });
      } else {
        if (!job) throw Error('Original claimed executor unavailable');
        if (job.status !== 'completed' && run.status !== 'completed') return decision(current);
        const ack = nativeAcknowledgement(this.github, current, run, job);
        if (ack) {
          next.current = recordAcknowledgement(claimOperation(current.prepared, current.current.executor!), ack);
        } else if (current.current.state === 'execution-claimed') next.current = unknownOperation(current.current);
        else return decision(current);
      }
      // Detect identity/lifecycle changes, not harmless API metadata progress.
      const bookend = nativeJob(this.github, current);
      if (!equal(executorState(bookend), executorState({ run, job }))) throw Error('Native executor changed during reconciliation');
      if (await this.persist(environment, slot, next)) return decision(next);
    }
    throw Error('Coordinator CAS contention; no provider dispatch');
  }
  private async persist(environment: Frame['environment'], slot: Slot, next: CoordinatorRecord): Promise<boolean> {
    try { return await this.store.compareAndSwap(environment, slot, structuredClone(next)); }
    catch {
      // A lost Git push ACK is not a failed write. Reopen authenticated CURRENT
      // bytes; only this exact transition (or a later reconcile call) can settle it.
      const observed = readSlot(await this.store.read(environment));
      if (observed.record !== null && equal(observed.record, next)) return true;
      throw Error('Journal write outcome unresolved; reopen current state, never dispatch or reissue provider effects');
    }
  }
}
