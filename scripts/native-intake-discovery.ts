/** Bounded native discovery of a request's active queue owner; never latest-run
 * selection. The returned locator is only a hint to NativeIntakeReader, which
 * must authenticate source/job/archive/body and active ownership before use. */
import { execFileSync } from 'node:child_process';
import { completeNativeList, type NativeArtifact, type NativeJob, type Run } from '../.github/actions/retained-build/retained-build.ts';
import type { GitHubRead } from './native-application-release.ts';
import type { SessionContext } from './native-release-session.ts';
import { INFRA } from './native-journal-projection.ts';
import { ISSUER_WORKFLOW, validateIssuerBinding, type IssuerBinding, type ProjectionLocator } from './native-journal-projection-reader.ts';
const PREFIX = `repos/${INFRA}`;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
function runsPath(binding: IssuerBinding): string {
  return `${PREFIX}/actions/runs?event=deployment&branch=main&head_sha=${binding.issuer.source_commit}&status=in_progress`;
}
/** Only the configured infra active-run search and metadata discovered from it.
 * No artifact download, cross-repository path, method or caller host override. */
export class IntakeDiscoveryRead implements GitHubRead {
  private readonly prefix: string;
  private readonly source: string;
  private readonly runs = new Map<number, number>();
  constructor(binding: IssuerBinding, environment: SessionContext['environment']) {
    validateIssuerBinding(binding, environment); this.prefix = runsPath(binding); this.source = binding.issuer.source_commit;
  }
  bytes(): Buffer { throw Error('Discovery cannot download or execute an artifact'); }
  json<T>(path: string): T {
    const listing = path.startsWith(this.prefix + '&per_page=100&page=')
      && /^(?:[1-9]|10)$/.test(path.slice((this.prefix + '&per_page=100&page=').length));
    const metadata = [...this.runs].some(([run, attempt]) =>
      [`${PREFIX}/actions/runs/${run}/artifacts?per_page=100&page=`, `${PREFIX}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100&page=`]
        .some(prefix => path.startsWith(prefix) && /^(?:[1-9]|10)$/.test(path.slice(prefix.length))));
    if (!listing && !metadata) throw Error('Unapproved native intake discovery read');
    let value: unknown;
    try { value = JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', path], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }).toString()); }
    catch { throw Error('Native intake discovery metadata unavailable'); }
    if (listing && value && typeof value === 'object' && Array.isArray((value as { workflow_runs?: unknown }).workflow_runs)) {
      for (const run of (value as { workflow_runs: Run[] }).workflow_runs) if (eligible(run, this.source)) this.runs.set(run.id, run.run_attempt);
    }
    return value as T;
  }
}
function eligible(run: Run, source: string): boolean {
  return !!run && positive(run.id) && positive(run.run_attempt) && run.head_sha === source && run.head_branch === 'main'
    && run.head_repository?.full_name === INFRA && run.path === ISSUER_WORKFLOW && run.event === 'deployment'
    && run.status === 'in_progress' && run.conclusion === null;
}
function inventory<T extends { id: number }>(reader: GitHubRead, path: string, field: string): T[] {
  return completeNativeList<T>(page => {
    if (page > 10) throw Error('Native intake discovery inventory exceeds bound');
    const response = reader.json<Record<string, unknown>>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (typeof response.total_count !== 'number' || !Number.isSafeInteger(response.total_count) || response.total_count < 0 || response.total_count > 1000) throw Error('Native intake discovery inventory exceeds bound');
    return { total_count: response.total_count, items: response[field] as T[] };
  });
}
export function discoverNativeIntake(binding: IssuerBinding, context: SessionContext, reader: GitHubRead = new IntakeDiscoveryRead(binding, context.environment)): ProjectionLocator | null {
  validateIssuerBinding(binding, context.environment);
  if (!positive(context.deployment_id)) throw Error('Exact native deployment request required');
  const matches: ProjectionLocator[] = [];
  for (const run of inventory<Run>(reader, runsPath(binding), 'workflow_runs')) {
    if (!eligible(run, binding.issuer.source_commit)) continue;
    const artifacts = inventory<NativeArtifact>(reader, `${PREFIX}/actions/runs/${run.id}/artifacts`, 'artifacts');
    const named = artifacts.filter(a => a.name === `attestrack-native-intake-${context.deployment_id}-${run.run_attempt}`);
    if (named.length === 0) continue;
    if (named.length !== 1 || named[0].expired !== false || !positive(named[0].id)) throw Error('Ambiguous or unavailable native intake');
    const jobs = inventory<NativeJob>(reader, `${PREFIX}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs').filter(j => j.name === 'scope');
    if (jobs.length !== 1) throw Error('Ambiguous original intake scope job');
    const job = jobs[0];
    if (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha || !positive(job.id)) throw Error('Foreign intake scope job');
    if (job.status !== 'completed' || job.conclusion !== 'success') continue;
    matches.push({ run_id: run.id, run_attempt: run.run_attempt, job_id: job.id, artifact_id: named[0].id, source_commit: run.head_sha });
  }
  if (matches.length > 1) throw Error('Multiple active controllers claim the same request; no latest-run fallback');
  return matches[0] ?? null;
}
