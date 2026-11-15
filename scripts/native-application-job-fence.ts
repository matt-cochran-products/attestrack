/** One trusted original Linux job's process fence, not provider exactly-once.
 * No cleanup/reset API, credentials, writable journal adapter or hosted caller.
 */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { completeNativeList, type NativeJob, type Run } from '../.github/actions/retained-build/retained-build.ts';
import { digest, REPOSITORY } from './application-artifacts.ts';
import { canonical } from './native-release-canonical.ts';
import type { GitHubRead } from './native-application-release.ts';
import type { Executor, Frame } from './native-application-operation.ts';

const WORKFLOW = '.github/workflows/application-release.yml';
const PREFIX = `repos/${REPOSITORY}`;
export const JOB_FENCE_DIRECTORY = 'attestrack-native-execution';
export const JOB_FENCE_FILE = 'claim.json';
/** Only trusted workflow assembly supplies these dependencies. Tests supply
 * fictional native metadata and isolated real temporary directories. Runtime
 * defaults use actual process.env and the existing read-only native GH adapter.
 */
export interface OriginalJobRuntime { github: GitHubRead; env: Readonly<NodeJS.ProcessEnv> }
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function decimal(value: string | undefined): number {
  if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('Invalid original job environment identity');
  return Number(value);
}
function environment(frame: Frame, env: Readonly<NodeJS.ProcessEnv>): { owner: Executor; temporary: string; name: string } {
  const owner = frame.executor, name = `native-${frame.journal.operations.at(-1)!.name}`;
  if (frame.state !== 'execution-claimed' || !owner || frame.repository !== REPOSITORY
      || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY
      || env.GITHUB_SERVER_URL !== 'https://github.com' || env.GITHUB_API_URL !== 'https://api.github.com'
      || env.GITHUB_EVENT_NAME !== 'workflow_run' || env.GITHUB_REF !== 'refs/heads/main'
      || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_HEAD_REF || env.GITHUB_JOB !== name
      || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/${WORKFLOW}@refs/heads/main`
      || env.GITHUB_SHA !== owner.workflow_commit || env.GITHUB_WORKFLOW_SHA !== owner.workflow_commit
      || env.RUNNER_OS !== 'Linux' || !['github-hosted', 'self-hosted'].includes(env.RUNNER_ENVIRONMENT ?? '')
      || process.platform !== 'linux' || typeof process.getuid !== 'function'
      || decimal(env.GITHUB_REPOSITORY_ID) !== owner.repository_id || decimal(env.GITHUB_RUN_ID) !== owner.run_id
      || decimal(env.GITHUB_RUN_ATTEMPT) !== owner.run_attempt) throw Error('Actual trusted original native job environment required');
  const temporary = env.RUNNER_TEMP ?? '';
  if (!isAbsolute(temporary) || resolve(temporary) !== temporary || dirname(temporary) === temporary) throw Error('Fixed absolute RUNNER_TEMP required');
  return { owner, temporary, name };
}
/** Select semantic identity/lifecycle only; progress timestamps/steps may vary. */
function native(reader: GitHubRead, owner: Executor, name: string): unknown {
  const repo = reader.json<{ id: number; full_name: string; fork: boolean; default_branch: string }>(PREFIX);
  if (repo.id !== owner.repository_id || repo.full_name !== REPOSITORY || repo.fork !== false || repo.default_branch !== 'main') throw Error('Original executor repository differs');
  const latest = reader.json<Run>(`${PREFIX}/actions/runs/${owner.run_id}`);
  const run = reader.json<Run>(`${PREFIX}/actions/runs/${owner.run_id}/attempts/${owner.run_attempt}`);
  for (const r of [latest, run]) {
    if (r.id !== owner.run_id || r.run_attempt !== owner.run_attempt || r.head_sha !== owner.workflow_commit
        || r.head_branch !== 'main' || r.head_repository?.full_name !== REPOSITORY || r.path !== WORKFLOW
        || r.event !== 'workflow_run' || r.status !== 'in_progress' || r.conclusion !== null) throw Error('Original executor run no longer active or was rerun');
  }
  const jobs = completeNativeList<NativeJob>(page => {
    const value = reader.json<{ total_count: number; jobs: NativeJob[] }>(`${PREFIX}/actions/runs/${owner.run_id}/attempts/${owner.run_attempt}/jobs?per_page=100&page=${page}`);
    return { total_count: value.total_count, items: value.jobs };
  });
  const scope = jobs.filter(j => j.name === 'scope'), matches = jobs.filter(j => j.name === name);
  const bound = (job: NativeJob) => job.run_id === owner.run_id && job.run_attempt === owner.run_attempt && job.head_sha === owner.workflow_commit;
  if (scope.length !== 1 || !bound(scope[0]) || scope[0].status !== 'completed' || scope[0].conclusion !== 'success'
      || matches.length !== 1 || !bound(matches[0]) || matches[0].id !== owner.job_id
      || matches[0].status !== 'in_progress' || matches[0].conclusion !== null) throw Error('Actual original active executor or successful scope differs');
  const job = matches[0];
  return { run: { id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha, status: run.status, conclusion: run.conclusion },
    job: { id: job.id, run_id: job.run_id, run_attempt: job.run_attempt, head_sha: job.head_sha, name: job.name, status: job.status, conclusion: job.conclusion } };
}
/** Called only after the current authenticated frame is validated and BEFORE an
 * Execution capability can be issued or provider material can be read. Any
 * existing directory (including a torn empty one), file or symlink refuses.
 */
export function reserveOriginalJob(frame: Frame, runtime: OriginalJobRuntime): void {
  const { owner, temporary, name } = environment(frame, runtime.env);
  const before = native(runtime.github, owner, name);
  const uid = process.getuid!();
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY || !constants.O_EXCL) throw Error('Required Linux exclusive no-follow fence primitives unavailable');
  // Pin the trusted job directory before using /proc/self/fd-relative paths.
  // This avoids re-resolving writable path components when creating the fence.
  for (let path = temporary; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Symlinked or non-directory RUNNER_TEMP ancestry refused');
    if (path === dirname(path)) break;
  }
  const root = openSync(temporary, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let directory: number | undefined, file: number | undefined;
  try {
    const stat = fstatSync(root), current = lstatSync(temporary);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o022) !== 0 || stat.dev !== current.dev || stat.ino !== current.ino) throw Error('RUNNER_TEMP ownership, permissions or identity differs');
    const directoryPath = `/proc/self/fd/${root}/${JOB_FENCE_DIRECTORY}`;
    // mkdir is also create-only: an interrupted attempt before file creation
    // cannot return to a fresh state. Never remove this directory on errors.
    mkdirSync(directoryPath, { mode: 0o700 });
    fsyncSync(root);
    directory = openSync(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const directoryStat = fstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.uid !== uid || (directoryStat.mode & 0o777) !== 0o700) throw Error('Original job fence directory differs');
    file = openSync(`/proc/self/fd/${directory}/${JOB_FENCE_FILE}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const fileStat = fstatSync(file);
    if (!fileStat.isFile() || fileStat.nlink !== 1 || fileStat.uid !== uid || (fileStat.mode & 0o777) !== 0o600) throw Error('Original job fence file differs');
    const bytes = canonical({ schema: 'attestrack.native-job-consumption/v1', repository: REPOSITORY,
      environment: frame.environment, operation_id: frame.journal.operation_id, executor: owner, frame_sha256: digest(canonical(frame)) }) + '\n';
    writeFileSync(file, bytes, 'utf8');
    fsyncSync(file); fsyncSync(directory); fsyncSync(root);
    if (!same(native(runtime.github, owner, name), before)) throw Error('Original executor changed while consuming job fence');
  } finally {
    // Close descriptors only. Retain the marker on all success/error paths.
    try { if (file !== undefined) closeSync(file); }
    finally { try { if (directory !== undefined) closeSync(directory); } finally { closeSync(root); } }
  }
}
