import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admit, main, PROFILE, runnerContext, selectProfile, WORKFLOW } from './application-release-scope.ts';
import { REPOSITORY } from './application-artifacts.ts';
import type { GitHubRead, Target } from './native-application-release.ts';
const context = { repository_id: 41, workflow_commit: 'a'.repeat(40), run_id: 200, run_attempt: 1 };
const http = { origin: 'https://fixture.example.invalid', site_id: 'fictional-site', policy_hash: 'a'.repeat(64) };
const native: Target = { environment: 'staging', account_id: 'a'.repeat(32),
  worker: { id: 'b'.repeat(32), name: 'fictional-worker', configuration_sha256: 'c'.repeat(64), bindings: [
    { name: 'SITE_ID', type: 'plain_text', text: http.site_id }, { name: 'ATTESTRACK_KV', type: 'kv_namespace', namespace_id: 'd'.repeat(32) }, { name: 'CONSENT_TOKEN_SECRET', type: 'secret_text' }] }, pages: null };
const profile = () => ({ schema: 'attestrack.application-release-targets/v1', staging: { native: structuredClone(native), http: { ...http } }, production: null });
const witness = () => ({ schema: 'attestrack.application-targets/v1', staging: { ...http } });
const environment = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: '41',
  GITHUB_SERVER_URL: 'https://github.com', GITHUB_API_URL: 'https://api.github.com', GITHUB_EVENT_NAME: 'workflow_run',
  GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_JOB: 'scope', GITHUB_SHA: context.workflow_commit,
  GITHUB_WORKFLOW_SHA: context.workflow_commit, GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '1' });

test('actual tracked defaults refuse staging and production before native API/credential custody', () => {
  const p = JSON.parse(readFileSync(new URL('../' + PROFILE, import.meta.url), 'utf8'));
  const w = JSON.parse(readFileSync(new URL('../release/application-targets.json', import.meta.url), 'utf8'));
  const reader: GitHubRead = { json() { assert.fail('unconfigured target reached native API'); }, bytes() { assert.fail('unconfigured target downloaded bytes'); } };
  for (const branch of ['staging', 'main']) assert.throws(() => admit(reader, context,
    { action: 'completed', repository: { id: 41, full_name: REPOSITORY }, workflow_run: { head_branch: branch } }, p, w), /unconfigured/);
});
test('closed reviewed native profile agrees with the existing HTTP site and environment', () => {
  assert.deepEqual(selectProfile(profile(), witness(), 'staging'), { native, http });
  const bad = profile(); bad.staging.native.worker.bindings[0] = { name: 'SITE_ID', type: 'plain_text', text: 'other-site' };
  assert.throws(() => selectProfile(bad, witness(), 'staging'), /site differ/);
  assert.throws(() => selectProfile(profile(), { ...witness(), staging: null }, 'staging'), /unconfigured/);
  assert.throws(() => selectProfile({ ...profile(), extra: true }, witness(), 'staging'), /Nonclosed/);
  assert.throws(() => selectProfile(profile(), { ...witness(), staging: { ...http, origin: 'https://other.invalid' } }, 'staging'), /binding differs/);
  const wrong = profile(); wrong.staging.native.environment = 'production';
  assert.throws(() => selectProfile(wrong, witness(), 'staging'), /environment/);
});
test('scope context is fixed protected main, original positive run IDs, and no CLI selectors', () => {
  assert.deepEqual(runnerContext(environment()), context);
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/dev' }, { GITHUB_REF_PROTECTED: 'false' },
    { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) }, { GITHUB_JOB: 'writer' }, { GITHUB_RUN_ATTEMPT: '1.5' }, { GITHUB_RUN_ID: '0' }, { GITHUB_REPOSITORY: 'foreign/repo' }]) {
    assert.throws(() => runnerContext({ ...environment(), ...patch }));
  }
  assert.throws(() => main({}, ['--run', 'anything']), /no selectors/);
});
test('scope workflow preserves publishers and grants only read authority with no environment/OPV install', () => {
  const workflow = readFileSync(new URL('../' + WORKFLOW, import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:/); assert.match(workflow, /workflows: \[Retained application artifacts, Native release tool bytes\]/);
  assert.match(workflow, /ref: \$\{\{ github.workflow_sha }}/);
  assert.doesNotMatch(workflow, /(?:environment:|secrets:|id-token:|deployments:|packages:|workflow_dispatch:|pnpm install)/);
  assert.match(workflow, /run: node scripts\/application-release-scope.ts/);
});
