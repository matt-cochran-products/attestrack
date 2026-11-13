/** Credential-free source admission ONLY. No provider, environment, writer or fixture. */
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { completeNativeList, requireNativeJobs, type NativeArtifact, type NativeJob, type Run } from '../.github/actions/retained-build/retained-build.ts';
import { digest, REPOSITORY, verifiedDocument } from './application-artifacts.ts';
import { targetIdentity as httpIdentity, type Target as HttpTarget } from './application-witness.ts';
import { canonical, NativeGitHub, readOriginal, targetIdentity, validateTarget, type ArtifactIdentity, type GitHubRead, type Target } from './native-application-release.ts';
import { TOOL_PROFILE, verifyTool } from './native-release-tool.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[a-f0-9]{40}$/;
export const WORKFLOW = '.github/workflows/application-release.yml';
export const PROFILE = 'release/application-release-targets.json';
const APPLICATION = '.github/workflows/application-artifacts.yml', TOOL = '.github/workflows/native-release-tool.yml';
type ObjectValue = Record<string, unknown>;
function object(raw: unknown): ObjectValue { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid source admission object'); return raw as ObjectValue; }
function closed(raw: unknown, fields: string[]): ObjectValue { const o = object(raw); if (Object.keys(o).sort().join() !== fields.sort().join()) throw new Error('Nonclosed source admission object'); return o; }
function integer(raw: unknown): number { if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) throw new Error('Invalid native source identity'); return raw; }
function sha(raw: unknown): string { if (typeof raw !== 'string' || !SHA.test(raw)) throw new Error('Invalid source commit'); return raw; }
function decimal(raw: unknown): number { if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) throw new Error('Invalid runner identity'); return integer(Number(raw)); }
function same(a: unknown, b: unknown): void { if (canonical(a) !== canonical(b)) throw new Error('Source admission binding differs'); }
export interface Context { repository_id: number; workflow_commit: string; run_id: number; run_attempt: number }
export interface Profile { native: Target; http: HttpTarget }
export function selectProfile(raw: unknown, witness: unknown, branch: 'staging' | 'main'): Profile {
  const p = closed(raw, ['schema', 'staging', 'production']);
  if (p.schema !== 'attestrack.application-release-targets/v1') throw new Error('Unreviewed native release profile');
  const value = p[branch === 'staging' ? 'staging' : 'production'];
  const original = closed(witness, ['schema', 'staging']);
  if (original.schema !== 'attestrack.application-targets/v1' || value === null
      || (branch === 'staging' && original.staging === null)) throw new Error('Existing release target is unconfigured');
  const row = closed(value, ['native', 'http']);
  const native = validateTarget(row.native), http = row.http as HttpTarget;
  httpIdentity(http);
  if (native.environment !== (branch === 'staging' ? 'staging' : 'production')) throw new Error('Wrong reviewed target environment');
  if (branch === 'staging') same(http, original.staging);
  const site = native.worker.bindings.find(b => b.name === 'SITE_ID');
  if (!site || site.type !== 'plain_text' || site.text !== http.site_id) throw new Error('Native and HTTP site differ');
  return { native, http: structuredClone(http) };
}
export function runnerContext(env: NodeJS.ProcessEnv): Context {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_SERVER_URL !== 'https://github.com'
      || env.GITHUB_API_URL !== 'https://api.github.com' || env.GITHUB_EVENT_NAME !== 'workflow_run'
      || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_JOB !== 'scope'
      || env.GITHUB_HEAD_REF || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/${WORKFLOW}@refs/heads/main`
      || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA) throw new Error('Protected main source scope required');
  return { repository_id: decimal(env.GITHUB_REPOSITORY_ID), workflow_commit: sha(env.GITHUB_SHA),
    run_id: decimal(env.GITHUB_RUN_ID), run_attempt: decimal(env.GITHUB_RUN_ATTEMPT) };
}
function list<T extends { id: number }>(reader: GitHubRead, path: string, field: string): T[] {
  return completeNativeList<T>(page => {
    const row = object(reader.json(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
    return { total_count: row.total_count as number, items: row[field] as T[] };
  });
}
function attempt(reader: GitHubRead, id: number, number: number): Run {
  const run = reader.json<Run>(`repos/${REPOSITORY}/actions/runs/${integer(id)}/attempts/${integer(number)}`);
  if (run.id !== id || run.run_attempt !== number || run.head_repository?.full_name !== REPOSITORY) throw new Error('Native original attempt differs');
  return run;
}
function jobs(reader: GitHubRead, run: Run, names: string[]): void {
  requireNativeJobs(list<NativeJob>(reader, `repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'), run, names);
}
function archived(reader: GitHubRead, run: Run, repositoryId: number, name: string, member: string): { value: unknown; metadata: NativeArtifact } {
  const matches = list<NativeArtifact>(reader, `repos/${REPOSITORY}/actions/runs/${run.id}/artifacts`, 'artifacts').filter(a => a.name === name);
  if (matches.length !== 1) throw new Error('Missing or ambiguous original source artifact');
  const a = matches[0];
  return { value: verifiedDocument(a, run, repositoryId, name, reader.bytes(`repos/${REPOSITORY}/actions/artifacts/${a.id}/zip`), member), metadata: a };
}
function producer(reader: GitHubRead, run: Run, branch: string, source: string, path: string): Run {
  integer(run.id); integer(run.run_attempt);
  const original = attempt(reader, run.id, run.run_attempt);
  if (original.event !== 'push' || original.path !== path || original.head_branch !== branch || original.head_sha !== source
      || original.status !== 'completed' || original.conclusion !== 'success') throw new Error('Original protected source producer is not successful');
  return original;
}
function candidates(reader: GitHubRead, path: string, branch: string, source: string): Run[] {
  return list<Run>(reader, `repos/${REPOSITORY}/actions/workflows/${path.split('/').at(-1)}/runs?branch=${branch}&head_sha=${source}&event=push`, 'workflow_runs')
    .filter(r => r.status === 'completed' && r.conclusion === 'success' && r.head_sha === source && r.head_branch === branch)
    .sort((a, b) => b.id - a.id);
}
interface Commit { sha: string; tree: { sha: string }; parents: { sha: string }[] }
function commit(reader: GitHubRead, id: string): Commit {
  const c = reader.json<Commit>(`repos/${REPOSITORY}/git/commits/${sha(id)}`);
  if (c.sha !== id || !Array.isArray(c.parents)) throw new Error('Native commit identity differs');
  sha(c.tree?.sha); c.parents.forEach(p => sha(p.sha)); return c;
}
/** Authenticate the actual normal promotion, not a source-event hint or same-tree claim. */
function promotion(reader: GitHubRead, branch: 'staging' | 'main', current: Commit, repositoryId: number): number {
  if (current.parents.length !== 2) throw new Error('Normal merge-commit promotion required');
  if (commit(reader, current.parents[1].sha).tree.sha !== current.tree.sha) throw new Error('Promotion changed the complete source tree');
  const prefix = `repos/${REPOSITORY}`;
  // commits/SHA/pulls can report only the PR that introduced a commit to the
  // default branch after source bootstrap. Inspect closed promotions explicitly.
  const associated: ObjectValue[] = []; let complete = false;
  for (let page = 1; page <= 10; page++) {
    const rows = reader.json<unknown[]>(`${prefix}/pulls?state=closed&base=${branch}&per_page=100&page=${page}`);
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('Incomplete native promotion listing');
    associated.push(...rows.map(object));
    if (new Set(associated.map(p => integer(p.id))).size !== associated.length) throw new Error('Duplicate native promotion');
    if (rows.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('Native promotion lookup exceeds bound');
  const matches = associated.filter(p => p.merge_commit_sha === current.sha && object(p.base).ref === branch);
  if (matches.length !== 1) throw new Error('Exact native promotion pull request missing');
  const pr = object(reader.json(`${prefix}/pulls/${integer(matches[0].number)}`));
  const base = object(pr.base), head = object(pr.head), baseRepo = object(base.repo), headRepo = object(head.repo);
  if (pr.merged !== true || pr.state !== 'closed' || pr.merge_commit_sha !== current.sha || base.ref !== branch
      || head.ref !== (branch === 'staging' ? 'dev' : 'staging') || head.sha !== current.parents[1].sha
      || baseRepo.id !== repositoryId || headRepo.id !== repositoryId || baseRepo.full_name !== REPOSITORY || headRepo.full_name !== REPOSITORY) throw new Error('Native promotion source or repository differs');
  return integer(pr.number);
}
export interface PlannedRequest {
  schema: 'attestrack.application-source-admission/v1'; kind: 'planned'; repository: string; repository_id: number;
  context: Context; branch: 'staging' | 'main'; source_commit: string; source_tree: string; promotion_pr: number;
  artifact: ArtifactIdentity; materialization: { run_id: number; run_attempt: number; artifact_id: number; archive_sha256: string } | null;
  tool: { run_id: number; run_attempt: number; artifact_id: number; archive_sha256: string; profile_sha256: string };
  targets: { profile_sha256: string; native_sha256: string; http_sha256: string };
}
/** Every returned hash binds observations/bytes only; it grants no native writer authority. */
export function admit(reader: GitHubRead, context: Context, event: unknown, profile: unknown, witness: unknown): PlannedRequest {
  const e = object(event), eventRepo = object(e.repository), triggerHint = object(e.workflow_run);
  if (e.action !== 'completed' || eventRepo.full_name !== REPOSITORY || eventRepo.id !== context.repository_id) throw new Error('Wrong completion source event');
  const branch = triggerHint.head_branch;
  if (branch !== 'staging' && branch !== 'main') throw new Error('Unprotected triggering branch');
  const selected = selectProfile(profile, witness, branch);
  const source = sha(triggerHint.head_sha), p = `repos/${REPOSITORY}`;
  const repo = object(reader.json(p));
  if (repo.id !== context.repository_id || repo.full_name !== REPOSITORY || repo.fork !== false || repo.default_branch !== 'main') throw new Error('Native repository identity differs');
  const main = object(reader.json(`${p}/branches/main`)), desired = object(reader.json(`${p}/branches/${branch}`));
  if (main.protected !== true || object(main.commit).sha !== context.workflow_commit || desired.protected !== true
      || object(desired.commit).sha !== source) throw new Error('Protected source moved');
  const own = attempt(reader, context.run_id, context.run_attempt);
  if (own.event !== 'workflow_run' || own.path !== WORKFLOW || own.head_sha !== context.workflow_commit || own.head_branch !== 'main'
      || own.status !== 'in_progress' || own.conclusion !== null) throw new Error('Actual protected scope run differs');
  const ownJobs = list<NativeJob>(reader, `${p}/actions/runs/${own.id}/attempts/${own.run_attempt}/jobs`, 'jobs').filter(j => j.name === 'scope');
  if (ownJobs.length !== 1 || ownJobs[0].run_id !== own.id || ownJobs[0].run_attempt !== own.run_attempt || ownJobs[0].head_sha !== own.head_sha
      || ownJobs[0].status !== 'in_progress' || ownJobs[0].conclusion !== null) throw new Error('Actual active scope job differs');
  const trigger = attempt(reader, integer(triggerHint.id), integer(triggerHint.run_attempt));
  if (![APPLICATION, TOOL].includes(trigger.path)) throw new Error('Unrelated source producer');
  producer(reader, trigger, branch, source, trigger.path);
  const current = commit(reader, source), promotionPr = promotion(reader, branch, current, context.repository_id);
  const appRun = trigger.path === APPLICATION ? trigger : candidates(reader, APPLICATION, branch, source)[0];
  const toolRun = trigger.path === TOOL ? trigger : candidates(reader, TOOL, branch, source)[0];
  if (!appRun || !toolRun) throw new Error('Original peer producer is not yet successful');
  const application = producer(reader, appRun, branch, source, APPLICATION), toolProducer = producer(reader, toolRun, branch, source, TOOL);
  jobs(reader, application, ['scope', branch === 'staging' ? 'staging-build' : 'main-materialize']); jobs(reader, toolProducer, ['tool-package']);
  const toolArchive = archived(reader, toolProducer, context.repository_id, `native-release-tool-${toolProducer.run_attempt}`, 'native-release-tool.json');
  verifyTool(toolArchive.value);
  let originalRun = application.id, originalAttempt = application.run_attempt, artifactId: number;
  let materialization: PlannedRequest['materialization'] = null;
  let materializationClaim: ObjectValue | null = null;
  if (branch === 'main') {
    const a = archived(reader, application, context.repository_id, `application-materialization-${application.run_attempt}`, 'original-artifact.json');
    const value = closed(a.value, ['schema', 'repository', 'artifact_id', 'producer_run', 'producer_attempt', 'archive_sha256', 'inventory_sha256']);
    if (value.schema !== 'attestrack.artifact-materialization/v1' || value.repository !== REPOSITORY) throw new Error('Wrong same-artifact materialization');
    materializationClaim = value;
    originalRun = integer(value.producer_run); originalAttempt = integer(value.producer_attempt); artifactId = integer(value.artifact_id);
    materialization = { run_id: application.id, run_attempt: application.run_attempt, artifact_id: a.metadata.id, archive_sha256: a.metadata.digest.slice(7) };
    const original = attempt(reader, originalRun, originalAttempt);
    const relation = object(reader.json(`${p}/compare/${sha(original.head_sha)}...${source}`));
    if ((typeof relation.status !== 'string' || !['ahead', 'identical'].includes(relation.status)) || object(relation.merge_base_commit).sha !== original.head_sha) throw new Error('Original staged producer is outside promoted ancestry');
  } else {
    const matches = list<NativeArtifact>(reader, `${p}/actions/runs/${application.id}/artifacts`, 'artifacts').filter(a => a.name === `attestrack-application-${application.run_attempt}`);
    if (matches.length !== 1) throw new Error('Original staged application artifact missing'); artifactId = matches[0].id;
  }
  // Existing admission uses /runs/ID; pin that one lookup to the REAL original
  // native attempt endpoint. Never substitute metadata from a later run attempt.
  const originalReader: GitHubRead = { bytes: path => reader.bytes(path), json<T>(path: string): T {
    return path === `${p}/actions/runs/${originalRun}` ? attempt(reader, originalRun, originalAttempt) as T : reader.json<T>(path);
  } };
  const bundle = readOriginal(originalReader, originalRun, artifactId, current.tree.sha);
  if (materializationClaim !== null) {
    const v = materializationClaim;
    if (v.archive_sha256 !== `sha256:${bundle.identity.archive_sha256}` || v.inventory_sha256 !== bundle.identity.inventory_sha256) throw new Error('Materialization differs from original verified bytes');
  }
  const request: PlannedRequest = { schema: 'attestrack.application-source-admission/v1', kind: 'planned', repository: REPOSITORY,
    repository_id: context.repository_id, context, branch, source_commit: source, source_tree: current.tree.sha, promotion_pr: promotionPr,
    artifact: bundle.identity, materialization, tool: { run_id: toolProducer.id, run_attempt: toolProducer.run_attempt,
      artifact_id: toolArchive.metadata.id, archive_sha256: toolArchive.metadata.digest.slice(7), profile_sha256: TOOL_PROFILE },
    targets: { profile_sha256: digest(canonical(profile)), native_sha256: targetIdentity(selected.native), http_sha256: httpIdentity(selected.http) } };
  // Native branch bookend: no output is authority for a head that advanced during admission.
  const view = (b: unknown) => { const value = object(b); return { protected: value.protected, sha: object(value.commit).sha }; };
  same(view(reader.json(`${p}/branches/main`)), view(main)); same(view(reader.json(`${p}/branches/${branch}`)), view(desired));
  return request;
}
function regular(path: string, limit: number): Buffer {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > limit) throw new Error('Invalid fixed scope file');
  return readFileSync(path);
}
function under(root: string, path: string): string {
  if (!isAbsolute(root) || !isAbsolute(path) || !relative(root, path) || relative(root, path).startsWith('..')) throw new Error('Scope path is outside runner scratch');
  return path;
}
export function main(env: NodeJS.ProcessEnv = process.env, args: string[] = process.argv.slice(2)): void {
  if (args.length) throw new Error('Source scope accepts no selectors or commands');
  const context = runnerContext(env), run = (args: string[]) => execFileSync('/usr/bin/git', ['-C', ROOT, ...args], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }).toString().trim();
  if (run(['rev-parse', 'HEAD']) !== context.workflow_commit || run(['status', '--porcelain'])) throw new Error('Scope checkout is not exact and clean');
  const temporary = env.RUNNER_TEMP ?? '', eventPath = under(temporary, env.GITHUB_EVENT_PATH ?? '');
  const event = JSON.parse(regular(eventPath, 2 * 1024 * 1024).toString());
  const profile = JSON.parse(regular(resolve(ROOT, PROFILE), 65536).toString());
  const witness = JSON.parse(regular(resolve(ROOT, 'release/application-targets.json'), 65536).toString());
  const request = admit(new NativeGitHub(), context, event, profile, witness);
  if (run(['rev-parse', 'HEAD']) !== context.workflow_commit || run(['status', '--porcelain'])) throw new Error('Scope source changed');
  const directory = resolve(temporary, 'attestrack-release-scope'); mkdirSync(directory, { mode: 0o700 });
  const file = resolve(directory, 'application-release-request.json'); writeFileSync(file, canonical(request)+'\n', { flag: 'wx', mode: 0o600 });
  const output = under(temporary, env.GITHUB_OUTPUT ?? ''); regular(output, 1024 * 1024);
  appendFileSync(output, `request-file=${file}\nrequest-sha256=${digest(canonical(request))}\nsource-admission-artifact=application-source-admission-${context.run_id}-${context.run_attempt}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch { console.error('Application source admission refused; no environment or writer allocated.'); process.exitCode = 1; }
}
