// Contract tests for the retained source-build wiring: .github/workflows/ci-checks.yml
// and its caller ci.yml. No YAML library is installed at the workspace root, so
// this reads only the bounded block YAML these files use (2-space mappings, block
// sequences, `key: value` scalars, `|` run blocks) and fails on anything else.
// Expressions are read from the workflows and evaluated with GitHub's operator
// semantics. The runner validator runs as written; the aggregate gate's Python body
// is extracted from its fixed heredoc wrapper and run directly (see gateBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const checksYaml = readFileSync(path('../.github/workflows/ci-checks.yml'), 'utf8');
const callerYaml = readFileSync(path('../.github/workflows/ci.yml'), 'utf8');
const validator = path('../.github/actions/validate-ci-runner/validate.py');

const RUNNER = "${{ vars.CI_RUNNER_MODE == 'blacksmith' && 'blacksmith-2vcpu-ubuntu-2404' || 'ubuntu-latest' }}";
const VALIDATOR_MODE = "${{ vars.CI_RUNNER_MODE || 'github' }}";
const VALIDATOR_LABEL = "${{ vars.CI_RUNNER_MODE == 'blacksmith' && 'blacksmith-2vcpu-ubuntu-2404' || 'github' }}";
const ELIGIBLE = "${{ (github.event_name == 'pull_request' && github.event.pull_request.draft == false"
  + " && (github.event.pull_request.base.ref == 'dev' || github.event.pull_request.base.ref == 'staging'))"
  + " || ((github.event_name == 'workflow_dispatch' || github.event_name == 'push')"
  + " && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/staging')) }}";
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';

// --- bounded block-YAML reader -------------------------------------------------

interface Entry { value: string; children: string[] }
type Mapping = Map<string, Entry>;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isComment = (line: string) => line.trimStart().startsWith('#');

function scalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("'")) {
    assert.ok(value.endsWith("'"), `unterminated scalar: ${value}`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  assert.ok(!value.startsWith('"'), `unsupported double-quoted scalar: ${value}`);
  return value.replace(/\s+#.*$/, '');
}

function mapping(lines: string[], indent: number): Mapping {
  const out: Mapping = new Map();
  let current: Entry | undefined;
  for (const line of lines) {
    if (line.trim() === '') { current?.children.push(line); continue; }
    if (isComment(line) && indentOf(line) <= indent) continue;
    // A block sequence may sit at its key's own indent (`steps:` / `- uses:`).
    if (indentOf(line) > indent || (indentOf(line) === indent && line.trimStart().startsWith('- '))) {
      assert.ok(current, `orphan line: ${line}`);
      current.children.push(line);
      continue;
    }
    assert.equal(indentOf(line), indent, `unexpected dedent: ${line}`);
    const match = /^\s*([\w-]+):(?:\s+(.*))?$/.exec(line);
    assert.ok(match, `unsupported YAML line: ${line}`);
    assert.ok(!out.has(match[1]), `duplicate key: ${match[1]}`);
    current = { value: match[2] ?? '', children: [] };
    out.set(match[1], current);
  }
  return out;
}

function childIndent(children: string[]): number {
  const first = children.find((line) => line.trim() !== '' && !isComment(line));
  assert.ok(first, 'empty block');
  return indentOf(first);
}

function get(map: Mapping, key: string): Entry {
  const entry = map.get(key);
  assert.ok(entry, `missing key: ${key}`);
  return entry;
}

const sub = (entry: Entry) => mapping(entry.children, childIndent(entry.children));
const value = (map: Mapping, key: string) => scalar(get(map, key).value);

function sequence(entry: Entry): string[][] {
  assert.equal(entry.value, '', 'expected a block sequence');
  const indent = childIndent(entry.children);
  const items: string[][] = [];
  for (const line of entry.children) {
    const last = items.at(-1);
    if (line.trim() === '') { last?.push(line); continue; }
    if (isComment(line) && indentOf(line) <= indent) continue;
    if (indentOf(line) === indent) {
      assert.ok(line.trimStart().startsWith('- '), `expected a list item: ${line}`);
      items.push([' '.repeat(indent + 2) + line.trimStart().slice(2)]);
    } else {
      assert.ok(indentOf(line) > indent && last, `orphan line: ${line}`);
      last.push(line);
    }
  }
  return items;
}

function blockScalar(entry: Entry): string {
  assert.equal(entry.value, '|', 'expected a literal block scalar');
  const lines = [...entry.children];
  while (lines.length && lines.at(-1)?.trim() === '') lines.pop();
  const first = lines.find((line) => line.trim() !== '');
  assert.ok(first, 'empty block scalar');
  const indent = indentOf(first);
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(indent))).join('\n') + '\n';
}

const jobsOf = (yaml: string) => sub(get(mapping(yaml.split('\n'), 0), 'jobs'));
const stepsOf = (job: Mapping) => sequence(get(job, 'steps')).map((item) => mapping(item, indentOf(item[0])));
const withOf = (step: Mapping) => Object.fromEntries([...sub(get(step, 'with'))].map(([k, e]) => [k, scalar(e.value)]));

const checksJobs = jobsOf(checksYaml);
const callerJobs = jobsOf(callerYaml);
const job = (name: string) => sub(get(checksJobs, name));
const callerJob = (name: string) => sub(get(callerJobs, name));

// --- GitHub expression evaluator (operators: ! == != && || and parentheses) ---

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

function truthy(v: Value): boolean {
  return !(v === false || v === null || v === '' || v === 0 || Number.isNaN(v));
}

function toNumber(v: Value): number {
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v);
  return Number.NaN;
}

// GitHub compares strings case-insensitively and coerces mismatched types to numbers.
function looseEquals(left: Value, right: Value): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase();
  if (typeof left === typeof right && typeof left !== 'number') return left === right;
  return toNumber(left) === toNumber(right);
}

function evaluate(expression: string, context: { [key: string]: Value }): Value {
  const inner = /^\$\{\{([\s\S]*)\}\}$/.exec(expression);
  assert.ok(inner, `not a single expression: ${expression}`);
  const tokens: string[] = [];
  const pattern = /\s*(?:('(?:[^']|'')*')|(==|!=|&&|\|\||[!()])|([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*))\s*/y;
  while (pattern.lastIndex < inner[1].length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(inner[1]);
    if (!match) throw new Error(`unsupported expression syntax: ${inner[1].slice(start)}`);
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const primary = (): Value => {
    const token = next();
    if (token === undefined) throw new Error('unexpected end of expression');
    if (token === '(') {
      const result = or();
      if (next() !== ')') throw new Error('expected )');
      return result;
    }
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === '(') throw new Error(`function call outside the evaluated subset: ${token}`);
      return token.split('.').reduce<Value>((current, key) => (current !== null && typeof current === 'object'
        && !Array.isArray(current) && key in current ? current[key] : null), context);
    }
    throw new Error(`unexpected token: ${token}`);
  };
  const unary = (): Value => {
    if (peek() === '!') { next(); return !truthy(unary()); }
    return primary();
  };
  const equality = (): Value => {
    let left = unary();
    while (peek() === '==' || peek() === '!=') {
      const op = next();
      const right = unary();
      left = op === '==' ? looseEquals(left, right) : !looseEquals(left, right);
    }
    return left;
  };
  const and = (): Value => {
    let left = equality();
    while (peek() === '&&') { next(); const right = equality(); left = truthy(left) ? right : left; }
    return left;
  };
  function or(): Value {
    let left = and();
    while (peek() === '||') { next(); const right = and(); left = truthy(left) ? left : right; }
    return left;
  }
  const result = or();
  if (position !== tokens.length) throw new Error(`trailing tokens: ${tokens.slice(position).join(' ')}`);
  return result;
}

const interpolate = (v: Value) => (v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// --- fixtures -------------------------------------------------------------------

const repository = 'matt-cochran/attestrack';
const prEvent = (base: string, draft: boolean, headRepo = repository, headRef = 'feature'): Value => ({
  pull_request: { draft, base: { ref: base }, head: { ref: headRef, repo: { full_name: headRepo } } } });
const github = (eventName: string | undefined, ref: string | null, event: Value = {}) => ({
  github: eventName === undefined ? { ref, event } : { event_name: eventName, ref, event } });

const eligibility: [string, { [key: string]: Value }, boolean][] = [
  ['non-draft PR into dev', github('pull_request', 'refs/pull/1/merge', prEvent('dev', false)), true],
  ['non-draft PR into staging', github('pull_request', 'refs/pull/2/merge', prEvent('staging', false, repository, 'dev')), true],
  ['non-draft fork PR into dev', github('pull_request', 'refs/pull/3/merge', prEvent('dev', false, 'fork/attestrack')), true],
  ['dispatch on dev', github('workflow_dispatch', 'refs/heads/dev'), true],
  ['dispatch on staging', github('workflow_dispatch', 'refs/heads/staging'), true],
  ['push to dev', github('push', 'refs/heads/dev'), true],
  ['push to staging', github('push', 'refs/heads/staging'), true],
  ['draft PR into dev', github('pull_request', 'refs/pull/4/merge', prEvent('dev', true)), false],
  ['draft PR into staging', github('pull_request', 'refs/pull/5/merge', prEvent('staging', true)), false],
  ['promotion PR staging into main', github('pull_request', 'refs/pull/6/merge', prEvent('main', false, repository, 'staging')), false],
  ['fork PR into main', github('pull_request', 'refs/pull/7/merge', prEvent('main', false, 'fork/attestrack')), false],
  ['draft fork PR into main', github('pull_request', 'refs/pull/8/merge', prEvent('main', true, 'fork/attestrack')), false],
  ['PR into a feature branch', github('pull_request', 'refs/pull/9/merge', prEvent('feature/x', false)), false],
  ['PR into main with a dev-looking ref', github('pull_request', 'refs/heads/dev', prEvent('main', false)), false],
  ['PR event without a pull_request payload', github('pull_request', 'refs/heads/dev'), false],
  ['dispatch on main', github('workflow_dispatch', 'refs/heads/main'), false],
  ['dispatch on main with a dev PR-shaped payload', github('workflow_dispatch', 'refs/heads/main', prEvent('dev', false)), false],
  ['dispatch on a feature branch', github('workflow_dispatch', 'refs/heads/feature/x'), false],
  ['dispatch on a dev-prefixed branch', github('workflow_dispatch', 'refs/heads/development'), false],
  ['dispatch on a staging sub-branch', github('workflow_dispatch', 'refs/heads/staging/x'), false],
  ['dispatch on a tag', github('workflow_dispatch', 'refs/tags/dev'), false],
  ['push to main', github('push', 'refs/heads/main'), false],
  ['push of a tag', github('push', 'refs/tags/v1.0.0'), false],
  ['push without a ref', github('push', null), false],
  ['pull_request_target into dev', github('pull_request_target', 'refs/heads/dev', prEvent('dev', false)), false],
  ['workflow_call event name on dev', github('workflow_call', 'refs/heads/dev'), false],
  ['schedule on dev', github('schedule', 'refs/heads/dev'), false],
  ['merge_group on staging', github('merge_group', 'refs/heads/staging'), false],
  ['empty event name on dev', github('', 'refs/heads/dev'), false],
  ['missing event name on dev', github(undefined, 'refs/heads/dev'), false],
];

// The gate step is a fixed `python3 - <<'PY'` heredoc wrapper around a Python body.
// Only that exact wrapper is accepted; the body is extracted verbatim and run with
// `python3 -c`, so the production Python logic runs the same on Linux and Windows
// (where `bash` may resolve to WSL, which does not forward the job env). The Bash
// wrapper itself is not executed here; actionlint covers the YAML and shell syntax.
const gateScript = blockScalar(get(stepsOf(job('build-gate'))[2], 'run'));
const GATE_OPEN = "python3 - <<'PY'\n";
const GATE_CLOSE = '\nPY\n';
function gateBody(script: string): string {
  assert.ok(script.startsWith(GATE_OPEN), `gate wrapper changed: expected to start with ${JSON.stringify(GATE_OPEN)}`);
  assert.ok(script.endsWith(GATE_CLOSE), `gate wrapper changed: expected to end with ${JSON.stringify(GATE_CLOSE)}`);
  const body = script.slice(GATE_OPEN.length, -GATE_CLOSE.length);
  assert.ok(body.trim() !== '', 'gate wrapper has an empty Python body');
  assert.ok(!body.split('\n').includes('PY'), 'gate wrapper changed: heredoc terminator inside the body');
  return body;
}
const gatePython = gateBody(gateScript);
function runGate(env: { [key: string]: string }, label = ''): number | null {
  // SYSTEMROOT is required by Python on Windows; it is absent on Linux.
  const platform = process.env.SYSTEMROOT === undefined ? {} : { SYSTEMROOT: process.env.SYSTEMROOT };
  const result = spawnSync('python3', ['-c', gatePython],
    { env: { PATH: process.env.PATH ?? '', ...platform, ...env }, encoding: 'utf8' });
  assert.equal(result.error, undefined, `${label}: ${String(result.error)}`);
  // A valid eligible input must pass; surface the gate's own output when it does not.
  if (result.status !== 0 && env.BUILD_ELIGIBLE === 'true' && env.BUILD_RESULTS === needs('success', 'success')) {
    assert.fail(`${label}: valid gate input exited ${String(result.status)}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result.status;
}
type JobState = 'success' | 'failure' | 'cancelled' | 'skipped' | 'missing' | 'neutral' | 'null-result' | 'no-result' | 'SUCCESS';
const states: JobState[] = ['success', 'failure', 'cancelled', 'skipped', 'missing', 'neutral', 'null-result', 'no-result', 'SUCCESS'];
function needs(ci: JobState, warehouse: JobState): string {
  const results: { [key: string]: Value } = {};
  for (const [name, state] of [['ci', ci], ['warehouse', warehouse]] as const) {
    if (state === 'missing') continue;
    results[name] = state === 'no-result' ? { outputs: {} }
      : { result: state === 'null-result' ? null : state, outputs: {} };
  }
  return JSON.stringify(results);
}

// --- tests ------------------------------------------------------------------------

test('every concrete job uses the standard runner selector shared with ci.yml', () => {
  assert.deepEqual([...checksJobs.keys()], ['ci', 'warehouse', 'build-gate']);
  for (const name of checksJobs.keys()) assert.equal(value(job(name), 'runs-on'), RUNNER, name);
  assert.equal(value(callerJob('resolve'), 'runs-on'), RUNNER);
  assert.equal(value(callerJob('build-gate'), 'runs-on'), RUNNER);
  const cases: [Value, string][] = [['blacksmith', 'blacksmith-2vcpu-ubuntu-2404'], ['github', 'ubuntu-latest'],
    [null, 'ubuntu-latest'], ['', 'ubuntu-latest'], ['auto', 'ubuntu-latest']];
  for (const [mode, label] of cases) {
    assert.equal(evaluate(RUNNER, { vars: mode === null ? {} : { CI_RUNNER_MODE: mode } }), label, String(mode));
  }
});

test('every concrete job runs the local runner validator right after checkout, before any command', () => {
  const wrapper = withOf(stepsOf(callerJob('resolve'))[1]);
  assert.equal(wrapper['runner-mode'], VALIDATOR_MODE);
  assert.equal(wrapper['runner-label'], VALIDATOR_LABEL);
  for (const name of checksJobs.keys()) {
    const [checkout, validate] = stepsOf(job(name));
    assert.equal(value(checkout, 'uses'), CHECKOUT, name);
    assert.ok(!checkout.has('run'), name);
    assert.equal(value(validate, 'uses'), './.github/actions/validate-ci-runner', name);
    assert.deepEqual([...validate.keys()], ['uses', 'with'], name);
    assert.deepEqual(withOf(validate), { mode: wrapper['runner-mode'], 'runner-label': wrapper['runner-label'] }, name);
  }
  // The aggregate checks out only to reach the validator: no credentials kept.
  assert.deepEqual(withOf(stepsOf(job('build-gate'))[0]), { 'persist-credentials': 'false' });
});

test('runner validator accepts the selected mode and label and refuses unsupported modes', () => {
  for (const [mode, ok] of [['blacksmith', true], ['github', true], [null, true], ['', true], ['auto', false], ['Blacksmith', false]] as const) {
    const vars = { vars: mode === null ? {} : { CI_RUNNER_MODE: mode } };
    const result = spawnSync('python3', [validator], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '',
      CI_RUNNER_MODE: interpolate(evaluate(VALIDATOR_MODE, vars)), CI_RUNNER_LABEL: interpolate(evaluate(VALIDATOR_LABEL, vars)) } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, ok ? 0 : 1, `${String(mode)}: ${result.stderr}`);
  }
});

test('source jobs and the aggregate use the exact eligibility expression', () => {
  assert.equal(value(job('ci'), 'if'), ELIGIBLE);
  assert.equal(value(job('warehouse'), 'if'), ELIGIBLE);
  assert.equal(value(sub(get(job('build-gate'), 'env')), 'BUILD_ELIGIBLE'), ELIGIBLE);
});

test('eligibility truth table: non-draft PRs into dev/staging, dispatch/push on dev/staging only', () => {
  for (const [label, context, expected] of eligibility) {
    assert.equal(truthy(evaluate(ELIGIBLE, context)), expected, label);
  }
});

test('aggregate always evaluates, needs exactly ci and warehouse, and keeps its timeout', () => {
  const gate = job('build-gate');
  assert.equal(value(gate, 'name'), 'Build gate');
  assert.equal(value(gate, 'if'), '${{ always() }}');
  assert.deepEqual(sequence(get(gate, 'needs')).map((item) => scalar(item[0])), ['ci', 'warehouse']);
  assert.equal(value(gate, 'timeout-minutes'), '5');
  const env = sub(get(gate, 'env'));
  assert.deepEqual([...env.keys()], ['BUILD_RESULTS', 'BUILD_ELIGIBLE']);
  assert.equal(value(env, 'BUILD_RESULTS'), '${{ toJSON(needs) }}');
  assert.equal(stepsOf(gate).length, 3);
});

test('aggregate gate step keeps the exact python3 heredoc wrapper', () => {
  assert.equal(GATE_OPEN + gatePython + GATE_CLOSE, gateScript);
  const changed = [
    gateScript.replace("python3 - <<'PY'", 'python3 - <<PY'),
    gateScript.replace("python3 - <<'PY'", "set -x\npython3 - <<'PY'"),
    gateScript.replace(/\nPY\n$/, '\nEOF\n'),
    gateScript + 'echo done\n',
    "python3 - <<'PY'\n\nPY\n",
  ];
  for (const script of changed) assert.throws(() => gateBody(script), /gate wrapper/, JSON.stringify(script.slice(0, 40)));
});

test('aggregate gate passes only for ci and warehouse success in an eligible context', () => {
  for (const ci of states) {
    for (const warehouse of states) {
      const expected = ci === 'success' && warehouse === 'success' ? 0 : 1;
      assert.equal(runGate({ BUILD_RESULTS: needs(ci, warehouse), BUILD_ELIGIBLE: 'true' }, `${ci}/${warehouse}`), expected, `${ci}/${warehouse}`);
    }
  }
});

test('aggregate gate rejects ineligible contexts and malformed or unexpected results', () => {
  const ok = needs('success', 'success');
  for (const eligible of ['false', '', 'True', '1']) {
    assert.equal(runGate({ BUILD_RESULTS: ok, BUILD_ELIGIBLE: eligible }, `eligible=${eligible}`), 1, `eligible=${eligible}`);
  }
  assert.equal(runGate({ BUILD_RESULTS: ok }), 1, 'eligibility unset');
  assert.equal(runGate({ BUILD_ELIGIBLE: 'true' }), 1, 'results unset');
  const extra = JSON.stringify({ ...JSON.parse(ok), other: { result: 'success', outputs: {} } });
  for (const results of [extra, '{}', '[]', 'null', '"success"', '{"ci":"success","warehouse":"success"}', 'not json']) {
    assert.equal(runGate({ BUILD_RESULTS: results, BUILD_ELIGIBLE: 'true' }), 1, results);
  }
});

test('eligibility evaluated from the workflow feeds the gate end to end', () => {
  const env = sub(get(job('build-gate'), 'env'));
  for (const [label, context, expected] of eligibility) {
    const eligible = interpolate(evaluate(value(env, 'BUILD_ELIGIBLE'), context));
    assert.equal(runGate({ BUILD_RESULTS: needs('success', 'success'), BUILD_ELIGIBLE: eligible }, label), expected ? 0 : 1, label);
  }
});

test('retained tests run exactly once, in the source ci job', () => {
  const command = 'node --test scripts/retained-build.test.ts scripts/retained-workflow.test.ts';
  assert.equal((checksYaml + callerYaml).split('node --test').length - 1, 1);
  const runs = (name: string) => stepsOf(job(name)).filter((s) => s.has('run')).map((s) => value(s, 'run'));
  assert.equal(runs('ci').filter((run) => run === command).length, 1);
  assert.ok(!runs('warehouse').some((run) => run.includes('node --test')));
});

test('original commands, action pins, services and env are preserved', () => {
  const describe = (name: string) => stepsOf(job(name)).map((s) => (s.has('uses') ? value(s, 'uses') : value(s, 'run')));
  const setup = [CHECKOUT, './.github/actions/validate-ci-runner', 'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', 'pnpm install --frozen-lockfile'];
  assert.deepEqual(describe('ci'), [...setup, 'node --test scripts/retained-build.test.ts scripts/retained-workflow.test.ts',
    'pnpm audit-gate', 'pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm test:workers', 'pnpm coverage',
    'pnpm route-contract-check', 'pnpm build', 'pnpm size-check', 'pnpm boundary-check', 'pnpm egress-check']);
  assert.deepEqual(describe('warehouse'), [...setup, 'pnpm build', 'pnpm test:warehouse']);
  for (const name of ['ci', 'warehouse']) {
    assert.deepEqual(withOf(stepsOf(job(name))[3]), { 'node-version': '24', cache: 'pnpm' }, name);
  }
  const clickhouse = sub(get(sub(get(job('warehouse'), 'services')), 'clickhouse'));
  assert.equal(value(clickhouse, 'image'), 'clickhouse/clickhouse-server:24.3.18.7');
  assert.deepEqual(Object.fromEntries([...sub(get(clickhouse, 'env'))].map(([k, e]) => [k, scalar(e.value)])),
    { CLICKHOUSE_USER: 'attestrack', CLICKHOUSE_PASSWORD: 'attestrack-test' });
  assert.deepEqual(sequence(get(clickhouse, 'ports')).map((item) => scalar(item[0])), ['8123:8123']);
  const warehouseTest = stepsOf(job('warehouse')).at(-1);
  assert.ok(warehouseTest);
  assert.deepEqual(Object.fromEntries([...sub(get(warehouseTest, 'env'))].map(([k, e]) => [k, scalar(e.value)])), {
    CLICKHOUSE_TEST_HTTP_URL: 'http://localhost:8123', CLICKHOUSE_TEST_USER: 'attestrack', CLICKHOUSE_TEST_PASSWORD: 'attestrack-test' });
});

test('caller passes no secrets to the source workflow, which references none', () => {
  const checks = callerJob('checks');
  assert.deepEqual([...checks.keys()], ['needs', 'if', 'uses']);
  assert.equal(value(checks, 'needs'), 'resolve');
  assert.equal(value(checks, 'if'), "needs.resolve.outputs.build-required == 'true'");
  assert.equal(value(checks, 'uses'), './.github/workflows/ci-checks.yml');
  assert.doesNotMatch(checksYaml, /\$\{\{[^}]*\bsecrets\b/);
  assert.doesNotMatch(checksYaml, /^\s*secrets\s*:/m);
  assert.deepEqual([...sub(get(mapping(checksYaml.split('\n'), 0), 'on')).keys()], ['workflow_call']);
});
